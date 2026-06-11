// engines/health.rs — Health Engine
// Tracks agent-level and per-collector health state.
// Status is readable via TUI, REST API, and WebSocket.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

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
            AgentStatus::Booting          => write!(f, "BOOTING"),
            AgentStatus::Initializing     => write!(f, "INITIALIZING"),
            AgentStatus::Online           => write!(f, "ONLINE"),
            AgentStatus::Degraded         => write!(f, "DEGRADED"),
            AgentStatus::OfflineBuffering => write!(f, "OFFLINE_BUFFERING"),
            AgentStatus::Recovering       => write!(f, "RECOVERING"),
            AgentStatus::Failed           => write!(f, "FAILED"),
            AgentStatus::ShuttingDown     => write!(f, "SHUTTING_DOWN"),
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
            CollectorStatus::Healthy  => write!(f, "Healthy"),
            CollectorStatus::Degraded => write!(f, "Degraded"),
            CollectorStatus::Failed   => write!(f, "Failed"),
            CollectorStatus::Disabled => write!(f, "Disabled"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectorHealthRecord {
    pub name:          String,
    pub status:        CollectorStatus,
    pub last_run:      Option<DateTime<Utc>>,
    pub last_success:  Option<DateTime<Utc>>,
    pub last_failure:  Option<DateTime<Utc>>,
    pub failure_count: u32,
    pub error_message: Option<String>,
}

impl CollectorHealthRecord {
    pub fn new(name: &str) -> Self {
        Self {
            name:          name.to_string(),
            status:        CollectorStatus::Healthy,
            last_run:      None,
            last_success:  None,
            last_failure:  None,
            failure_count: 0,
            error_message: None,
        }
    }

    pub fn record_success(&mut self) {
        let now = Utc::now();
        self.last_run     = Some(now);
        self.last_success = Some(now);
        self.status       = CollectorStatus::Healthy;
        self.error_message = None;
        // Reset failure count after consecutive successes
        if self.failure_count > 0 {
            self.failure_count = self.failure_count.saturating_sub(1);
        }
    }

    pub fn record_failure(&mut self, error: &str) {
        let now = Utc::now();
        self.last_run     = Some(now);
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
    pub collectors:   HashMap<String, CollectorHealthRecord>,
    pub snapshot_at:  DateTime<Utc>,
    pub uptime_secs:  u64,
}

#[derive(Clone)]
pub struct HealthEngine {
    status:     Arc<RwLock<AgentStatus>>,
    collectors: Arc<RwLock<HashMap<String, CollectorHealthRecord>>>,
    started_at: DateTime<Utc>,
}

impl HealthEngine {
    pub fn new() -> Self {
        Self {
            status:     Arc::new(RwLock::new(AgentStatus::Booting)),
            collectors: Arc::new(RwLock::new(HashMap::new())),
            started_at: Utc::now(),
        }
    }

    pub fn set_status(&self, status: AgentStatus) {
        // Synchronous wrapper — only used during startup
        let status_clone = self.status.clone();
        tokio::spawn(async move {
            *status_clone.write().await = status;
        });
    }

    pub async fn get_status(&self) -> AgentStatus {
        self.status.read().await.clone()
    }

    pub async fn set_status_async(&self, status: AgentStatus) {
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
        record.record_failure(error);

        // Escalate agent status if any collector has failed
        drop(collectors);
        let collectors = self.collectors.read().await;
        let any_failed = collectors.values().any(|c| c.status == CollectorStatus::Failed);
        let any_degraded = collectors.values().any(|c| c.status == CollectorStatus::Degraded);
        drop(collectors);

        let mut status = self.status.write().await;
        if any_failed && *status == AgentStatus::Online {
            *status = AgentStatus::Degraded;
        } else if !any_failed && !any_degraded && *status == AgentStatus::Degraded {
            *status = AgentStatus::Online;
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
        let now   = Utc::now();
        let uptime = (now - self.started_at).num_seconds().max(0) as u64;
        HealthSnapshot {
            agent_status: self.status.read().await.clone(),
            collectors:   self.collectors.read().await.clone(),
            snapshot_at:  now,
            uptime_secs:  uptime,
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