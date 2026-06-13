// storage/mod.rs — SQLite storage manager
// Manages: config.db, metrics.db, logs.db, queue.db
// All databases use WAL mode + NORMAL synchronous for durability with performance.

use anyhow::Result;
use rusqlite::{Connection, params};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;
use chrono::Utc;
use serde_json;
use tracing::{info, warn};

#[derive(Clone)]
pub struct StorageManager {
    pub dir:     PathBuf,
    metrics_db:  Arc<Mutex<Connection>>,
    logs_db:     Arc<Mutex<Connection>>,
    queue_db:    Arc<Mutex<Connection>>,
    config_db:   Arc<Mutex<Connection>>,
}

impl StorageManager {
    pub async fn new(dir: &str) -> Result<Self> {
        let dir = PathBuf::from(dir);
        tokio::fs::create_dir_all(&dir).await?;

        let sm = Self {
            dir:        dir.clone(),
            metrics_db: Arc::new(Mutex::new(Self::open_db(&dir.join("metrics.db"))?)),
            logs_db:    Arc::new(Mutex::new(Self::open_db(&dir.join("logs.db"))?)),
            queue_db:   Arc::new(Mutex::new(Self::open_db(&dir.join("queue.db"))?)),
            config_db:  Arc::new(Mutex::new(Self::open_db(&dir.join("config.db"))?)),
        };
        sm.init_schema().await?;
        info!("Storage manager initialised at {:?}", dir);
        Ok(sm)
    }

    fn open_db(path: &Path) -> Result<Connection> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA foreign_keys=ON;
             PRAGMA cache_size=-8000;"
        )?;
        Ok(conn)
    }

    async fn init_schema(&self) -> Result<()> {
        // ── Metrics ───────────────────────────────────────────────────────────
        {
            let db = self.metrics_db.lock().await;
            db.execute_batch(r#"
                CREATE TABLE IF NOT EXISTS metrics (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    agent_id        TEXT    NOT NULL,
                    metric_type     TEXT    NOT NULL,
                    resolution      TEXT    NOT NULL DEFAULT 'raw',
                    timestamp       TEXT    NOT NULL,
                    data            TEXT    NOT NULL,
                    schema_version  TEXT    NOT NULL DEFAULT '1.0',
                    sequence_number INTEGER,
                    synced          INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_metrics_agent_type_ts
                    ON metrics(agent_id, metric_type, timestamp);
                CREATE INDEX IF NOT EXISTS idx_metrics_synced
                    ON metrics(synced, timestamp);
            "#)?;
        }

        // ── Logs ──────────────────────────────────────────────────────────────
        {
            let db = self.logs_db.lock().await;
            db.execute_batch(r#"
                CREATE TABLE IF NOT EXISTS logs (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    log_id          TEXT NOT NULL UNIQUE,
                    agent_id        TEXT NOT NULL,
                    hostname        TEXT NOT NULL DEFAULT '',
                    source          TEXT NOT NULL,
                    severity        TEXT NOT NULL,
                    message         TEXT NOT NULL,
                    timestamp       TEXT NOT NULL,
                    execution_id    TEXT,
                    namespace       TEXT,
                    event_type      TEXT,
                    tags            TEXT NOT NULL DEFAULT '[]',
                    schema_version  INTEGER NOT NULL DEFAULT 1,
                    sequence_number INTEGER NOT NULL DEFAULT 0,
                    extra           TEXT NOT NULL DEFAULT '{}',
                    synced          INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_logs_agent_severity_ts
                    ON logs(agent_id, severity, timestamp);
                CREATE INDEX IF NOT EXISTS idx_logs_synced
                    ON logs(synced, timestamp);
                CREATE TABLE IF NOT EXISTS audit_logs (
                    id        INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    action    TEXT NOT NULL,
                    resource  TEXT NOT NULL,
                    details   TEXT NOT NULL DEFAULT '{}'
                );
            "#)?;

            // Migration: add new columns to existing logs tables (safe no-op if present)
            let add_column = |col: &str, def: &str| -> Result<()> {
                let sql = format!("ALTER TABLE logs ADD COLUMN {} {}", col, def);
                let _ = db.execute_batch(&sql);
                Ok(())
            };
            let _ = add_column("log_id", "TEXT");
            let _ = add_column("hostname", "TEXT NOT NULL DEFAULT ''");
            let _ = add_column("execution_id", "TEXT");
            let _ = add_column("namespace", "TEXT");
            let _ = add_column("event_type", "TEXT");
            let _ = add_column("tags", "TEXT NOT NULL DEFAULT '[]'");

            // Create indexes for new columns — must run AFTER migration
            let create_idx = |sql: &str| -> Result<()> {
                let _ = db.execute_batch(sql);
                Ok(())
            };
            let _ = create_idx("CREATE INDEX IF NOT EXISTS idx_logs_log_id ON logs(log_id)");
            let _ = create_idx("CREATE INDEX IF NOT EXISTS idx_logs_execution ON logs(execution_id) WHERE execution_id IS NOT NULL");
        }

        // ── Queue ─────────────────────────────────────────────────────────────
        {
            let db = self.queue_db.lock().await;
            db.execute_batch(r#"
                CREATE TABLE IF NOT EXISTS queue (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    message_id  TEXT    NOT NULL UNIQUE,
                    payload     BLOB    NOT NULL,
                    msg_type    TEXT    NOT NULL,
                    state       TEXT    NOT NULL DEFAULT 'Pending',
                    retries     INTEGER NOT NULL DEFAULT 0,
                    created_at  TEXT    NOT NULL,
                    updated_at  TEXT    NOT NULL,
                    checksum    TEXT    NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_queue_state ON queue(state, created_at);
                CREATE TABLE IF NOT EXISTS dead_letter (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    message_id  TEXT NOT NULL,
                    payload     BLOB NOT NULL,
                    msg_type    TEXT NOT NULL,
                    reason      TEXT NOT NULL,
                    archived_at TEXT NOT NULL
                );
            "#)?;
        }

        // ── Config ────────────────────────────────────────────────────────────
        {
            let db = self.config_db.lock().await;
            db.execute_batch(r#"
                CREATE TABLE IF NOT EXISTS config (
                    key        TEXT PRIMARY KEY,
                    value      TEXT NOT NULL,
                    encrypted  INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS agent_identity (
                    id         INTEGER PRIMARY KEY CHECK (id = 1),
                    agent_id   TEXT NOT NULL,
                    hostname   TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS encryption_keys (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    key_data   BLOB NOT NULL,
                    created_at TEXT NOT NULL,
                    active     INTEGER NOT NULL DEFAULT 1
                );
            "#)?;
        }

        Ok(())
    }

    // ── Metrics ───────────────────────────────────────────────────────────────

    pub async fn store_metric(&self, agent_id: &str, metric_type: &str, data: &str) -> Result<()> {
        let db = self.metrics_db.lock().await;
        let ts = Utc::now().to_rfc3339();
        db.execute(
            "INSERT INTO metrics (agent_id, metric_type, timestamp, data) VALUES (?1,?2,?3,?4)",
            params![agent_id, metric_type, ts, data],
        )?;
        Ok(())
    }

    pub async fn get_unsynced_metrics(&self, limit: usize) -> Result<Vec<MetricRow>> {
        let db = self.metrics_db.lock().await;
        let mut stmt = db.prepare(
            "SELECT id, agent_id, metric_type, resolution, timestamp, data, schema_version, sequence_number
             FROM metrics WHERE synced = 0 ORDER BY timestamp ASC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit as i64], |r| {
            Ok(MetricRow {
                id:              r.get(0)?,
                agent_id:        r.get(1)?,
                metric_type:     r.get(2)?,
                resolution:      r.get(3)?,
                timestamp:       r.get(4)?,
                data:            r.get(5)?,
                schema_version:  r.get(6)?,
                sequence_number: r.get(7)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub async fn mark_metrics_synced(&self, ids: &[i64]) -> Result<()> {
        if ids.is_empty() { return Ok(()); }
        let db = self.metrics_db.lock().await;
        for id in ids {
            db.execute("UPDATE metrics SET synced = 1 WHERE id = ?1", params![id])?;
        }
        Ok(())
    }

    pub async fn prune_metrics(&self, raw_hours: i64, rollup_1m_days: i64, rollup_1h_days: i64) -> Result<usize> {
        let db  = self.metrics_db.lock().await;
        let now = Utc::now();
        let raw_cutoff  = (now - chrono::Duration::hours(raw_hours)).to_rfc3339();
        let min_cutoff  = (now - chrono::Duration::days(rollup_1m_days)).to_rfc3339();
        let hr_cutoff   = (now - chrono::Duration::days(rollup_1h_days)).to_rfc3339();
        let mut n = 0usize;
        n += db.execute("DELETE FROM metrics WHERE resolution='raw'   AND timestamp < ?1", params![raw_cutoff])? as usize;
        n += db.execute("DELETE FROM metrics WHERE resolution='1min'  AND timestamp < ?1", params![min_cutoff])? as usize;
        n += db.execute("DELETE FROM metrics WHERE resolution='1hour' AND timestamp < ?1", params![hr_cutoff])? as usize;
        Ok(n)
    }

    // ── Logs ──────────────────────────────────────────────────────────────────

    pub async fn store_log(&self, agent_id: &str, source: &str, severity: &str, message: &str, extra: &str) -> Result<()> {
        let db = self.logs_db.lock().await;
        let ts = Utc::now().to_rfc3339();
        db.execute(
            "INSERT INTO logs (log_id, agent_id, hostname, source, severity, message, timestamp, extra) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![uuid::Uuid::new_v4().to_string(), agent_id, "", source, severity, message, ts, extra],
        )?;
        Ok(())
    }

    pub async fn store_log_entry(&self, entry: &crate::engines::logging::LogEntry) -> Result<()> {
        let db = self.logs_db.lock().await;
        let tags_json = serde_json::to_string(&entry.tags).unwrap_or_else(|_| "[]".to_string());
        db.execute(
            "INSERT INTO logs (log_id, agent_id, hostname, source, severity, message, timestamp, execution_id, namespace, event_type, tags, schema_version, sequence_number)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
            params![
                entry.log_id,
                entry.agent_id,
                entry.hostname,
                entry.source,
                entry.severity,
                entry.message,
                entry.timestamp,
                entry.execution_id,
                entry.namespace,
                entry.event_type,
                tags_json,
                entry.schema_version,
                entry.sequence_number,
            ],
        )?;
        Ok(())
    }

    pub async fn get_unsynced_logs(&self, limit: usize) -> Result<Vec<LogRow>> {
        let db = self.logs_db.lock().await;
        let mut stmt = db.prepare(
            "SELECT id, log_id, agent_id, hostname, source, severity, message, timestamp, execution_id, namespace, event_type, tags, schema_version, sequence_number, extra
             FROM logs WHERE synced = 0 ORDER BY timestamp ASC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit as i64], |r| {
            Ok(LogRow {
                id:              r.get(0)?,
                log_id:          r.get(1)?,
                agent_id:        r.get(2)?,
                hostname:        r.get(3)?,
                source:          r.get(4)?,
                severity:        r.get(5)?,
                message:         r.get(6)?,
                timestamp:       r.get(7)?,
                execution_id:    r.get(8)?,
                namespace:       r.get(9)?,
                event_type:      r.get(10)?,
                tags:            r.get(11)?,
                schema_version:  r.get::<_, Option<i64>>(12)?.map(|v| v as u32).unwrap_or(0),
                sequence_number: r.get::<_, Option<i64>>(13)?.map(|v| v as u64).unwrap_or(0),
                extra:           r.get(14)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub async fn mark_logs_synced(&self, ids: &[i64]) -> Result<()> {
        if ids.is_empty() { return Ok(()); }
        let db = self.logs_db.lock().await;
        for id in ids {
            db.execute("UPDATE logs SET synced = 1 WHERE id = ?1", params![id])?;
        }
        Ok(())
    }

    pub async fn print_recent_logs(&self, n: usize) -> Result<()> {
        let db = self.logs_db.lock().await;
        let mut stmt = db.prepare(
            "SELECT timestamp, severity, source, message FROM logs ORDER BY timestamp DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![n as i64], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?))
        })?;
        for row in rows {
            let (ts, sev, src, msg) = row?;
            println!("[{ts}] [{sev}] ({src}) {msg}");
        }
        Ok(())
    }

    pub async fn clear_logs(&self) -> Result<()> {
        let db = self.logs_db.lock().await;
        db.execute("DELETE FROM logs", [])?;
        Ok(())
    }

    pub async fn search_logs(&self, query: &str, limit: usize) -> Result<Vec<LogRow>> {
        let db = self.logs_db.lock().await;
        let pattern = format!("%{}%", query.replace('%', "\\%").replace('_', "\\_"));
        let mut stmt = db.prepare(
            "SELECT id, log_id, agent_id, hostname, source, severity, message, timestamp, execution_id, namespace, event_type, tags, schema_version, sequence_number, extra
             FROM logs WHERE message LIKE ?1 ESCAPE '\\' OR source LIKE ?1 ESCAPE '\\'
             ORDER BY timestamp DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![pattern, limit as i64], |r| {
            Ok(LogRow {
                id:              r.get(0)?,
                log_id:          r.get(1)?,
                agent_id:        r.get(2)?,
                hostname:        r.get(3)?,
                source:          r.get(4)?,
                severity:        r.get(5)?,
                message:         r.get(6)?,
                timestamp:       r.get(7)?,
                execution_id:    r.get(8)?,
                namespace:       r.get(9)?,
                event_type:      r.get(10)?,
                tags:            r.get(11)?,
                schema_version:  r.get::<_, Option<i64>>(12)?.map(|v| v as u32).unwrap_or(0),
                sequence_number: r.get::<_, Option<i64>>(13)?.map(|v| v as u64).unwrap_or(0),
                extra:           r.get(14)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub async fn delete_logs_by_severity(&self, severity: &str) -> Result<usize> {
        let db = self.logs_db.lock().await;
        let n = db.execute("DELETE FROM logs WHERE severity = ?1", params![severity])?;
        Ok(n as usize)
    }

    // ── Audit ─────────────────────────────────────────────────────────────────

    pub async fn write_audit(&self, action: &str, resource: &str, details: &str) -> Result<()> {
        let db = self.logs_db.lock().await;
        let ts = Utc::now().to_rfc3339();
        db.execute(
            "INSERT INTO audit_logs (timestamp, action, resource, details) VALUES (?1,?2,?3,?4)",
            params![ts, action, resource, details],
        )?;
        Ok(())
    }

    pub async fn print_audit_logs(&self, n: usize) -> Result<()> {
        let db = self.logs_db.lock().await;
        let mut stmt = db.prepare(
            "SELECT timestamp, action, resource, details FROM audit_logs ORDER BY timestamp DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![n as i64], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?))
        })?;
        for row in rows {
            let (ts, action, resource, details) = row?;
            println!("[{ts}] {action} | {resource} | {details}");
        }
        Ok(())
    }

    // ── Queue (accessed by QueueEngine) ───────────────────────────────────────

    pub fn queue_db(&self) -> Arc<Mutex<Connection>> {
        self.queue_db.clone()
    }

    // ── Config ────────────────────────────────────────────────────────────────

    pub async fn get_config(&self, key: &str) -> Result<Option<String>> {
        let db = self.config_db.lock().await;
        match db.query_row("SELECT value FROM config WHERE key = ?1", params![key], |r| r.get(0)) {
            Ok(v)  => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub async fn set_config(&self, key: &str, value: &str) -> Result<()> {
        let db = self.config_db.lock().await;
        let ts = Utc::now().to_rfc3339();
        db.execute(
            "INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?1,?2,?3)",
            params![key, value, ts],
        )?;
        Ok(())
    }

    pub async fn get_agent_identity(&self) -> Result<Option<(String, String)>> {
        let db = self.config_db.lock().await;
        match db.query_row(
            "SELECT agent_id, hostname FROM agent_identity WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ) {
            Ok(v)  => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub async fn store_agent_identity(&self, agent_id: &str, hostname: &str) -> Result<()> {
        let db = self.config_db.lock().await;
        let ts = Utc::now().to_rfc3339();
        db.execute(
            "INSERT OR IGNORE INTO agent_identity (id, agent_id, hostname, created_at) VALUES (1,?1,?2,?3)",
            params![agent_id, hostname, ts],
        )?;
        Ok(())
    }

    pub async fn get_active_encryption_key(&self) -> Result<Option<Vec<u8>>> {
        let db = self.config_db.lock().await;
        match db.query_row(
            "SELECT key_data FROM encryption_keys WHERE active = 1 ORDER BY id DESC LIMIT 1",
            [],
            |r| r.get::<_, Vec<u8>>(0),
        ) {
            Ok(v)  => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub async fn store_encryption_key(&self, key_data: &[u8]) -> Result<()> {
        let db = self.config_db.lock().await;
        let ts = Utc::now().to_rfc3339();
        db.execute("UPDATE encryption_keys SET active = 0", [])?;
        db.execute(
            "INSERT INTO encryption_keys (key_data, created_at, active) VALUES (?1,?2,1)",
            params![key_data, ts],
        )?;
        Ok(())
    }

    // ── Maintenance ───────────────────────────────────────────────────────────

    pub async fn vacuum(&self) -> Result<()> {
        for db in [&self.metrics_db, &self.logs_db, &self.queue_db, &self.config_db] {
            db.lock().await.execute_batch("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;")?;
        }
        Ok(())
    }

    pub async fn verify(&self) -> Result<()> {
        for db in [&self.metrics_db, &self.logs_db, &self.queue_db, &self.config_db] {
            let locked = db.lock().await;
            let ok: String = locked.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
            if ok != "ok" {
                return Err(anyhow::anyhow!("Integrity check failed: {ok}"));
            }
        }
        Ok(())
    }

    pub async fn backup(&self, dest: &str) -> Result<()> {
        // Copy the metrics database file as a simple backup
        let src_path = self.dir.join("metrics.db");
        tokio::fs::copy(&src_path, dest).await?;
        info!("Backup written to {dest}");
        Ok(())
    }

    pub async fn restore(&self, _src: &str) -> Result<()> {
        warn!("Restore: stop the agent, copy backup over metrics.db, then restart.");
        Ok(())
    }

    pub async fn print_status(&self) -> Result<()> {
        let metrics_count: i64 = {
            let db = self.metrics_db.lock().await;
            db.query_row("SELECT COUNT(*) FROM metrics", [], |r| r.get(0))?
        };
        let logs_count: i64 = {
            let db = self.logs_db.lock().await;
            db.query_row("SELECT COUNT(*) FROM logs", [], |r| r.get(0))?
        };
        let queue_count: i64 = {
            let db = self.queue_db.lock().await;
            db.query_row("SELECT COUNT(*) FROM queue", [], |r| r.get(0))?
        };
        println!("Storage:");
        println!("  dir        : {:?}", self.dir);
        println!("  metrics.db : {} records", metrics_count);
        println!("  logs.db    : {} records", logs_count);
        println!("  queue.db   : {} records", queue_count);
        Ok(())
    }
}

// ── Row types ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct MetricRow {
    pub id:              i64,
    pub agent_id:        String,
    pub metric_type:     String,
    pub resolution:      String,
    pub timestamp:       String,
    pub data:            String,
    pub schema_version:  String,
    pub sequence_number: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct LogRow {
    pub id:              i64,
    pub log_id:          String,
    pub agent_id:        String,
    pub hostname:        String,
    pub source:          String,
    pub severity:        String,
    pub message:         String,
    pub timestamp:       String,
    pub execution_id:    Option<String>,
    pub namespace:       Option<String>,
    pub event_type:      Option<String>,
    pub tags:            String,
    pub schema_version:  u32,
    pub sequence_number: u64,
    pub extra:           String,
}