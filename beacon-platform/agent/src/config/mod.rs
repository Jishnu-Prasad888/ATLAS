// config/mod.rs — Agent Configuration (SRP: parsing + validation separated)
//
// `AgentConfig` owns the data.
// `ConfigValidator` owns the validation rules (SRP — validation is its own concern).
// `AgentConfig::load` / `save` are the only I/O entry points.

pub mod validator;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::fs;

pub use validator::ConfigValidator;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    /// WebSocket server address (wss://...)
    pub server_addr: String,
    /// Username for API authentication
    pub username: String,
    /// Local storage directory
    pub storage_dir: String,
    /// Collection interval in seconds
    pub interval_seconds: u64,
    pub collectors: CollectorConfig,
    pub tls:        TlsConfig,
    pub queue:      QueueConfig,
    pub encryption: EncryptionConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectorConfig {
    pub cpu:         bool,
    pub ram:         bool,
    pub storage:     bool,
    pub network:     bool,
    pub process:     bool,
    pub systemd:     bool,
    pub docker:      bool,
    /// Enable k3s / Kubernetes metrics collection
    pub kubernetes:  bool,
    pub temperature: bool,
    pub power:       bool,
    /// Max processes to track per collection cycle
    pub max_processes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsConfig {
    pub verify_cert:  bool,
    pub ca_cert_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueConfig {
    pub max_retries:      u32,
    pub max_queue_size:   usize,
    pub retry_backoff_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptionConfig {
    pub enabled:           bool,
    pub key_rotation_days: u32,
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            server_addr:      "wss://localhost:8000/ws/ingest/".to_string(),
            username:         "admin".to_string(),
            storage_dir:      "/var/lib/beacon/agent".to_string(),
            interval_seconds: 5,
            collectors: CollectorConfig {
                cpu:           true,
                ram:           true,
                storage:       true,
                network:       true,
                process:       true,
                systemd:       true,
                docker:        false,
                kubernetes:    false,
                temperature:   true,
                power:         false,
                max_processes: 512,
            },
            tls: TlsConfig {
                verify_cert:  true,
                ca_cert_path: None,
            },
            queue: QueueConfig {
                max_retries:      5,
                max_queue_size:   100_000,
                retry_backoff_ms: 1_000,
            },
            encryption: EncryptionConfig {
                enabled:           true,
                key_rotation_days: 30,
            },
        }
    }
}

// ─── I/O ──────────────────────────────────────────────────────────────────────

impl AgentConfig {
    pub async fn load(path: &str) -> Result<Self> {
        if !Path::new(path).exists() {
            return Ok(Self::default());
        }
        let content = fs::read_to_string(path).await?;
        let config: Self = toml::from_str(&content)?;
        ConfigValidator::validate(&config)?;
        Ok(config)
    }

    pub async fn save(&self, path: &str) -> Result<()> {
        ConfigValidator::validate(self)?;
        if let Some(parent) = Path::new(path).parent() {
            fs::create_dir_all(parent).await?;
        }
        fs::write(path, toml::to_string_pretty(self)?).await?;
        Ok(())
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_is_valid() {
        ConfigValidator::validate(&AgentConfig::default()).unwrap();
    }

    #[test]
    fn invalid_interval_fails_validation() {
        let mut cfg = AgentConfig::default();
        cfg.interval_seconds = 0;
        assert!(ConfigValidator::validate(&cfg).is_err());
    }

    #[test]
    fn invalid_server_addr_fails_validation() {
        let mut cfg = AgentConfig::default();
        cfg.server_addr = "http://not-a-ws-url".to_string();
        assert!(ConfigValidator::validate(&cfg).is_err());
    }

    #[test]
    fn kubernetes_flag_can_be_enabled() {
        let mut cfg = AgentConfig::default();
        cfg.collectors.kubernetes = true;
        ConfigValidator::validate(&cfg).unwrap();
    }
}
