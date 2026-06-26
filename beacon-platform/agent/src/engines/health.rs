// engines/health.rs — Health Engine
// Tracks agent-level and per-collector health state.
// Status is readable via TUI, REST API, and streamed via control channel.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::engines::logging::LogEngine;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum AgentStatus {
    Booting,
    Initializing,
    Online,
    Degraded,
    OfflineBuffering,
    Recovering,
    Failed,
    ShuttingDown,
}

impl std::fmt::Display for AgentStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AgentStatus::Booting => write!(f, "BOOTING"),
            AgentStatus::Initializing => write!(f, "INITIALIZING"),
            AgentStatus::Online => write!(f, "ONLINE"),
            AgentStatus::Degraded => write!(f, "DEGRADED"),
            AgentStatus::OfflineBuffering => write!(f, "OFFLINE_BUFFERING"),
            AgentStatus::Recovering => write!(f, "RECOVERING"),
            AgentStatus::Failed => write!(f, "FAILED"),
            AgentStatus::ShuttingDown => write!(f, "SHUTTING_DOWN"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum CollectorStatus {
    Healthy,
    Degraded,
    Failed,
    Disabled,
}

impl std::fmt::Display for CollectorStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CollectorStatus::Healthy => write!(f, "Healthy"),
            CollectorStatus::Degraded => write!(f, "Degraded"),
            CollectorStatus::Failed => write!(f, "Failed"),
            CollectorStatus::Disabled => write!(f, "Disabled"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectorHealthRecord {
    pub name: String,
    pub status: CollectorStatus,
    pub last_run: Option<DateTime<Utc>>,
    pub last_success: Option<DateTime<Utc>>,
    pub last_failure: Option<DateTime<Utc>>,
    pub failure_count: u32,
    pub error_message: Option<String>,
}

impl CollectorHealthRecord {
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
            status: CollectorStatus::Healthy,
            last_run: None,
            last_success: None,
            last_failure: None,
            failure_count: 0,
            error_message: None,
        }
    }

    pub fn record_success(&mut self) {
        let now = Utc::now();
        self.last_run = Some(now);
        self.last_success = Some(now);
        self.status = CollectorStatus::Healthy;
        self.error_message = None;
        // Reset failure count after consecutive successes
        if self.failure_count > 0 {
            self.failure_count = self.failure_count.saturating_sub(1);
        }
    }

    pub fn record_failure(&mut self, error: &str) {
        let now = Utc::now();
        self.last_run = Some(now);
        self.last_failure = Some(now);
        self.failure_count += 1;
        self.error_message = Some(error.to_string());
        // Escalate status based on failure count
        self.status = if self.failure_count >= 5 {
            CollectorStatus::Failed
        } else {
            CollectorStatus::Degraded
        };
    }

    pub fn set_disabled(&mut self) {
        self.status = CollectorStatus::Disabled;
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthSnapshot {
    pub agent_status: AgentStatus,
    pub collectors: HashMap<String, CollectorHealthRecord>,
    pub snapshot_at: DateTime<Utc>,
    pub uptime_secs: u64,
}

#[derive(Clone)]
pub struct HealthEngine {
    status: Arc<RwLock<AgentStatus>>,
    collectors: Arc<RwLock<HashMap<String, CollectorHealthRecord>>>,
    started_at: DateTime<Utc>,
    log_engine: Option<LogEngine>,
}

impl HealthEngine {
    pub fn new() -> Self {
        Self {
            status: Arc::new(RwLock::new(AgentStatus::Booting)),
            collectors: Arc::new(RwLock::new(HashMap::new())),
            started_at: Utc::now(),
            log_engine: None,
        }
    }

    pub fn set_log_engine(&mut self, log_engine: LogEngine) {
        self.log_engine = Some(log_engine);
    }

    fn log_status_change(&self, _from: &AgentStatus, to: &AgentStatus) {
        if let Some(ref log) = self.log_engine {
            let log = log.clone();
            let to_s = to.to_string();
            let severity = match to {
                AgentStatus::Failed | AgentStatus::Degraded => "Warning",
                _ => "Info",
            };
            tokio::spawn(async move {
                let _ = log
                    .log(
                        log.new_entry(
                            severity,
                            "health_engine",
                            &format!("System state changed to {}", to_s,),
                        )
                        .with_tags(&["health", "state"]),
                    )
                    .await;
            });
        }
    }

    pub fn set_status(&self, status: AgentStatus) {
        let status_clone = self.status.clone();
        let old_status = self.status.clone();
        let log = self.log_engine.clone();
        tokio::spawn(async move {
            let old = old_status.read().await.clone();
            *status_clone.write().await = status.clone();
            if let Some(ref l) = log {
                let old_s = old.to_string();
                let new_s = status.to_string();
                if old_s != new_s {
                    let severity = match &status {
                        AgentStatus::Failed | AgentStatus::Degraded => "Warning",
                        _ => "Info",
                    };
                    let _ = l
                        .log(
                            l.new_entry(
                                severity,
                                "health_engine",
                                &format!("System state changed to {}", new_s,),
                            )
                            .with_tags(&["health", "state"]),
                        )
                        .await;
                }
            }
        });
    }

    pub async fn get_status(&self) -> AgentStatus {
        self.status.read().await.clone()
    }

    pub async fn set_status_async(&self, status: AgentStatus) {
        let old = self.status.read().await.clone();
        self.log_status_change(&old, &status);
        *self.status.write().await = status;
    }

    pub async fn record_collector_success(&self, name: &str) {
        let mut collectors = self.collectors.write().await;
        collectors
            .entry(name.to_string())
            .or_insert_with(|| CollectorHealthRecord::new(name))
            .record_success();
    }

    pub async fn record_collector_failure(&self, name: &str, error: &str) {
        let mut collectors = self.collectors.write().await;
        let record = collectors
            .entry(name.to_string())
            .or_insert_with(|| CollectorHealthRecord::new(name));
        let old_status = record.status.clone();
        record.record_failure(error);
        let new_status = record.status.clone();
        drop(collectors);

        if old_status != new_status {
            if let Some(ref log) = self.log_engine {
                let _ = log
                    .error(
                        "metrics_engine",
                        &format!(
                            "{} collector status changed to {}: {}",
                            name, new_status, error,
                        ),
                    )
                    .await;
            }
        }

        // Escalate agent status if any collector has failed
        let collectors = self.collectors.read().await;
        let any_failed = collectors
            .values()
            .any(|c| c.status == CollectorStatus::Failed);
        let any_degraded = collectors
            .values()
            .any(|c| c.status == CollectorStatus::Degraded);
        drop(collectors);

        let mut status = self.status.write().await;
        if any_failed && *status == AgentStatus::Online {
            *status = AgentStatus::Degraded;
            drop(status);
            if let Some(ref log) = self.log_engine {
                let _ = log
                    .log(
                        log.new_entry(
                            "Warning",
                            "health_engine",
                            &format!("System state changed to {}", AgentStatus::Degraded,),
                        )
                        .with_tags(&["health", "state"]),
                    )
                    .await;
            }
        } else if !any_failed && !any_degraded && *status == AgentStatus::Degraded {
            *status = AgentStatus::Online;
            drop(status);
            if let Some(ref log) = self.log_engine {
                let _ = log
                    .log(
                        log.new_entry(
                            "Info",
                            "health_engine",
                            &format!("System state changed to {}", AgentStatus::Online,),
                        )
                        .with_tags(&["health", "state"]),
                    )
                    .await;
            }
        }
    }

    pub async fn disable_collector(&self, name: &str) {
        let mut collectors = self.collectors.write().await;
        collectors
            .entry(name.to_string())
            .or_insert_with(|| CollectorHealthRecord::new(name))
            .set_disabled();
    }

    pub async fn snapshot(&self) -> HealthSnapshot {
        let now = Utc::now();
        let uptime = (now - self.started_at).num_seconds().max(0) as u64;
        HealthSnapshot {
            agent_status: self.status.read().await.clone(),
            collectors: self.collectors.read().await.clone(),
            snapshot_at: now,
            uptime_secs: uptime,
        }
    }

    pub async fn to_ws_payload(&self) -> serde_json::Value {
        let snap = self.snapshot().await;
        serde_json::json!({
            "type": "health",
            "status": snap.agent_status.to_string(),
            "uptime_secs": snap.uptime_secs,
            "snapshot_at": snap.snapshot_at,
            "collectors": snap.collectors.values().map(|c| serde_json::json!({
                "name": c.name,
                "status": c.status.to_string(),
                "last_run": c.last_run,
                "last_success": c.last_success,
                "failure_count": c.failure_count,
            })).collect::<Vec<_>>(),
        })
    }
}

impl Default for HealthEngine {
    fn default() -> Self {
        Self::new()
    }
}
