// engines/queue.rs — Queue Engine
// Manages outbound message queue with offline buffering.
// Message states: Pending → Processing → Sent | Failed → DeadLetter
// Deduplication by message_id. Checksum validation on dequeue.

use anyhow::Result;
use chrono::Utc;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::engines::logging::LogEngine;
use crate::storage::StorageManager;

const MAX_RETRIES: u32 = 5;
const MAX_DEAD_LETTER: usize = 10_000;
const BATCH_SIZE: usize = 100;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum MessageState {
    Pending,
    Processing,
    Sent,
    Failed,
    DeadLetter,
}

impl MessageState {
    pub fn as_str(&self) -> &'static str {
        match self {
            MessageState::Pending => "Pending",
            MessageState::Processing => "Processing",
            MessageState::Sent => "Sent",
            MessageState::Failed => "Failed",
            MessageState::DeadLetter => "DeadLetter",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueMessage {
    pub id: i64,
    pub message_id: String,
    pub payload: Vec<u8>,
    pub msg_type: String,
    pub state: String,
    pub retries: u32,
    pub created_at: String,
    pub checksum: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueStatus {
    pub pending: i64,
    pub processing: i64,
    pub sent: i64,
    pub failed: i64,
    pub dead_letter: i64,
    pub paused: bool,
}

#[derive(Clone)]
pub struct QueueEngine {
    storage: StorageManager,
    paused: Arc<RwLock<bool>>,
    log_engine: Option<Arc<LogEngine>>,
}

impl QueueEngine {
    pub async fn new(storage: StorageManager) -> Result<Self> {
        Ok(Self {
            storage,
            paused: Arc::new(RwLock::new(false)),
            log_engine: None,
        })
    }

    pub fn set_log_engine(&mut self, log_engine: LogEngine) {
        self.log_engine = Some(Arc::new(log_engine));
    }

    pub fn storage(&self) -> StorageManager {
        self.storage.clone()
    }

    // ─── Enqueue ──────────────────────────────────────────────────────────────

    pub async fn enqueue(&self, payload: Vec<u8>, msg_type: &str) -> Result<String> {
        let message_id = Uuid::new_v4().to_string();
        let checksum = Self::compute_checksum(&payload);
        let now = Utc::now().to_rfc3339();

        let db = self.storage.queue_db();
        let db = db.lock().await;
        db.execute(
            "INSERT OR IGNORE INTO queue (message_id, payload, msg_type, state, retries, created_at, updated_at, checksum)
             VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, ?7)",
            params![
                message_id,
                payload,
                msg_type,
                MessageState::Pending.as_str(),
                now,
                now,
                checksum,
            ],
        )?;

        Ok(message_id)
    }

    // ─── Dequeue ──────────────────────────────────────────────────────────────

    pub async fn dequeue_batch(&self, limit: usize) -> Result<Vec<QueueMessage>> {
        if *self.paused.read().await {
            return Ok(vec![]);
        }

        let db = self.storage.queue_db();
        let db = db.lock().await;
        let limit = limit.min(BATCH_SIZE);

        let mut stmt = db.prepare(
            "SELECT id, message_id, payload, msg_type, state, retries, created_at, checksum
             FROM queue WHERE state = 'Pending' ORDER BY created_at ASC LIMIT ?1",
        )?;

        let messages: Vec<QueueMessage> = stmt
            .query_map(params![limit as i64], |row| {
                Ok(QueueMessage {
                    id: row.get(0)?,
                    message_id: row.get(1)?,
                    payload: row.get(2)?,
                    msg_type: row.get(3)?,
                    state: row.get(4)?,
                    retries: row.get::<_, i64>(5)? as u32,
                    created_at: row.get(6)?,
                    checksum: row.get(7)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        // Validate checksums — move corrupted to dead letter
        let mut valid = Vec::new();
        for msg in messages {
            let expected = Self::compute_checksum(&msg.payload);
            if expected != msg.checksum {
                warn!(
                    "Checksum mismatch for message {}: moving to dead letter",
                    msg.message_id
                );
                self.move_to_dead_letter_locked(
                    &db,
                    msg.id,
                    &msg.message_id,
                    &msg.payload,
                    &msg.msg_type,
                    "checksum_mismatch",
                )?;
            } else {
                // Mark as Processing
                db.execute(
                    "UPDATE queue SET state = 'Processing', updated_at = ?1 WHERE id = ?2",
                    params![Utc::now().to_rfc3339(), msg.id],
                )?;
                valid.push(msg);
            }
        }

        Ok(valid)
    }

    // ─── Acknowledge ──────────────────────────────────────────────────────────

    pub async fn ack(&self, id: i64) -> Result<()> {
        let db = self.storage.queue_db();
        let db = db.lock().await;
        let now = Utc::now().to_rfc3339();
        db.execute(
            "UPDATE queue SET state = 'Sent', updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        Ok(())
    }

    pub async fn nack(&self, id: i64, message_id: &str) -> Result<()> {
        let db = self.storage.queue_db();
        let db = db.lock().await;
        let now = Utc::now().to_rfc3339();

        // Increment retry count
        db.execute(
            "UPDATE queue SET state = 'Failed', retries = retries + 1, updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;

        // Check if we've exceeded max retries
        let (retries, payload, msg_type): (i64, Vec<u8>, String) = db.query_row(
            "SELECT retries, payload, msg_type FROM queue WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;

        if retries as u32 >= MAX_RETRIES {
            warn!(
                "Message {} exceeded max retries, moving to dead letter",
                message_id
            );
            self.move_to_dead_letter_locked(
                &db,
                id,
                message_id,
                &payload,
                &msg_type,
                "max_retries_exceeded",
            )?;
            drop(db);
            if let Some(ref log) = self.log_engine {
                let _ = log
                    .warn(
                        "queue_engine",
                        &format!(
                            "Message moved to dead letter after {} retries: id={} type={}",
                            MAX_RETRIES, message_id, msg_type,
                        ),
                    )
                    .await;
            }
        } else {
            // Re-queue as Pending
            db.execute(
                "UPDATE queue SET state = 'Pending', updated_at = ?1 WHERE id = ?2",
                params![now, id],
            )?;
            drop(db);
            if let Some(ref log) = self.log_engine {
                let _ = log
                    .warn(
                        "queue_engine",
                        &format!(
                            "Message send failed, retrying (attempt {}/{}): id={}",
                            retries + 1,
                            MAX_RETRIES,
                            message_id,
                        ),
                    )
                    .await;
            }
        }
        Ok(())
    }

    // ─── Dead Letter ──────────────────────────────────────────────────────────

    fn move_to_dead_letter_locked(
        &self,
        db: &rusqlite::Connection,
        queue_id: i64,
        message_id: &str,
        payload: &[u8],
        msg_type: &str,
        reason: &str,
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();

        // Check dead letter overflow — archive oldest if at limit
        let count: i64 = db.query_row("SELECT COUNT(*) FROM dead_letter", [], |r| r.get(0))?;
        if count as usize >= MAX_DEAD_LETTER {
            db.execute(
                "DELETE FROM dead_letter WHERE id = (SELECT MIN(id) FROM dead_letter)",
                [],
            )?;
        }

        db.execute(
            "INSERT INTO dead_letter (message_id, payload, msg_type, reason, archived_at) VALUES (?1,?2,?3,?4,?5)",
            params![message_id, payload, msg_type, reason, now],
        )?;
        db.execute("DELETE FROM queue WHERE id = ?1", params![queue_id])?;
        Ok(())
    }

    // ─── Control ──────────────────────────────────────────────────────────────

    pub async fn pause(&self) {
        *self.paused.write().await = true;
        info!("Queue paused");
    }

    pub async fn resume(&self) {
        *self.paused.write().await = false;
        info!("Queue resumed");
    }

    pub async fn clear(&self) -> Result<()> {
        let db = self.storage.queue_db();
        let db = db.lock().await;
        db.execute("DELETE FROM queue", [])?;
        info!("Queue cleared");
        Ok(())
    }

    pub async fn retry_failed(&self) -> Result<usize> {
        let db = self.storage.queue_db();
        let db = db.lock().await;
        let now = Utc::now().to_rfc3339();
        let n = db.execute(
            "UPDATE queue SET state = 'Pending', updated_at = ?1 WHERE state = 'Failed'",
            params![now],
        )? as usize;
        drop(db);
        info!("Retrying {} failed messages", n);
        if n > 0 {
            if let Some(ref log) = self.log_engine {
                let _ = log
                    .info(
                        "queue_engine",
                        &format!("Recovered connection, replaying {} queued messages", n,),
                    )
                    .await;
            }
        }
        Ok(n)
    }

    pub async fn flush(&self) -> Result<()> {
        // Mark all Processing as Pending so they can be retried on next run
        let db = self.storage.queue_db();
        let db = db.lock().await;
        let now = Utc::now().to_rfc3339();
        db.execute(
            "UPDATE queue SET state = 'Pending', updated_at = ?1 WHERE state = 'Processing'",
            params![now],
        )?;
        Ok(())
    }

    pub async fn status(&self) -> Result<QueueStatus> {
        let db = self.storage.queue_db();
        let db = db.lock().await;

        let count_state = |state: &str| -> Result<i64> {
            Ok(db.query_row(
                "SELECT COUNT(*) FROM queue WHERE state = ?1",
                params![state],
                |r| r.get(0),
            )?)
        };

        Ok(QueueStatus {
            pending: count_state("Pending")?,
            processing: count_state("Processing")?,
            sent: count_state("Sent")?,
            failed: count_state("Failed")?,
            dead_letter: db.query_row("SELECT COUNT(*) FROM dead_letter", [], |r| r.get(0))?,
            paused: *self.paused.read().await,
        })
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    fn compute_checksum(payload: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(payload);
        hex::encode(hasher.finalize())
    }

    /// Prune sent messages older than `hours`
    pub async fn prune_sent(&self, hours: i64) -> Result<usize> {
        let db = self.storage.queue_db();
        let db = db.lock().await;
        let cutoff = (Utc::now() - chrono::Duration::hours(hours)).to_rfc3339();
        let n = db.execute(
            "DELETE FROM queue WHERE state = 'Sent' AND created_at < ?1",
            params![cutoff],
        )? as usize;
        Ok(n)
    }
}
