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
    /// Password for API authentication
    pub password: String,
    /// Shared secret for agent registration.
    /// Must match BEACON_AGENT_SECRET on the server.
    /// Can also be provided via the BEACON_AGENT_SECRET environment variable
    /// (env takes priority over this field).
    #[serde(default)]
    pub secret: String,
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
            password:         String::new(),
            secret:           String::new(),
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
        // Default has empty secret — that's fine at config level;
        // the registration step enforces secret presence.
        let cfg = AgentConfig::default();
        // validator doesn't require secret to be non-empty (env var may supply it)
        ConfigValidator::validate(&cfg).unwrap();
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

    #[test]
    fn secret_field_is_serialized_and_deserialized() {
        let mut cfg = AgentConfig::default();
        cfg.secret = "hunter2".to_string();
        let toml_str = toml::to_string_pretty(&cfg).unwrap();
        assert!(toml_str.contains("secret"));
        let reloaded: AgentConfig = toml::from_str(&toml_str).unwrap();
        assert_eq!(reloaded.secret, "hunter2");
    }

    #[test]
    fn missing_secret_field_deserializes_to_empty_string() {
        // Old config files without a secret field should still load cleanly.
        let toml_no_secret = r#"
server_addr = "wss://localhost:8000/ws/ingest/"
username = "admin"
password = "pass"
storage_dir = "/tmp"
interval_seconds = 5

[collectors]
cpu = true
ram = true
storage = true
network = true
process = true
systemd = true
docker = false
kubernetes = false
temperature = true
power = false
max_processes = 512

[tls]
verify_cert = true

[queue]
max_retries = 5
max_queue_size = 100000
retry_backoff_ms = 1000

[encryption]
enabled = true
key_rotation_days = 30
"#;
        let cfg: AgentConfig = toml::from_str(toml_no_secret).unwrap();
        assert_eq!(cfg.secret, "");
    }
}