// config/mod.rs — Agent Configuration (SRP: parsing + validation separated)
//
// `AgentConfig` owns the data.
// `ConfigValidator` owns the validation rules (SRP — validation is its own concern).
// `AgentConfig::load` / `save` are the only I/O entry points.

pub mod validator;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tokio::fs;
use tokio::sync::RwLock;

pub use validator::ConfigValidator;

fn default_true() -> bool {
    true
}
fn default_sent_retention_hours() -> u64 {
    24
}
fn default_warning_audit_retention_days() -> u64 {
    10
}
fn default_compress_warning_audit() -> bool {
    true
}

/// Shared runtime flags that control whether each collector is active.
/// The Transport updates these when the server pushes a `config_update`.
/// Collectors check their flag on every `collect()` call.
pub type CollectorFlags = Arc<RwLock<HashMap<String, bool>>>;

/// Create initial collector flags from the on-disk config.
/// Called once at agent startup before the transport connects;
/// thereafter the server may push updates at any time.
pub fn create_collector_flags(config: &AgentConfig) -> CollectorFlags {
    let mut flags = HashMap::new();
    flags.insert("cpu".to_string(), config.collectors.cpu);
    flags.insert("ram".to_string(), config.collectors.ram);
    flags.insert("storage".to_string(), config.collectors.storage);
    flags.insert("network".to_string(), config.collectors.network);
    flags.insert("process".to_string(), config.collectors.process);
    flags.insert("systemd".to_string(), config.collectors.systemd);
    flags.insert(
        "system_inventory".to_string(),
        config.collectors.system_inventory,
    );
    flags.insert("docker".to_string(), config.collectors.docker);
    flags.insert("kubernetes".to_string(), config.collectors.kubernetes);
    flags.insert("temperature".to_string(), config.collectors.temperature);
    flags.insert("power".to_string(), config.collectors.power);
    flags.insert("gpu".to_string(), config.collectors.gpu);
    Arc::new(RwLock::new(flags))
}

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
    pub tls: TlsConfig,
    pub queue: QueueConfig,
    pub encryption: EncryptionConfig,
    #[serde(default)]
    pub logging: LoggingConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectorConfig {
    pub cpu: bool,
    pub ram: bool,
    pub storage: bool,
    pub network: bool,
    pub process: bool,
    pub systemd: bool,
    #[serde(default = "default_true")]
    pub system_inventory: bool,
    pub docker: bool,
    /// Enable k3s / Kubernetes metrics collection
    pub kubernetes: bool,
    pub temperature: bool,
    pub power: bool,
    #[serde(default)]
    pub gpu: bool,
    /// Max processes to track per collection cycle
    pub max_processes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsConfig {
    pub verify_cert: bool,
    pub ca_cert_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueConfig {
    pub max_retries: u32,
    pub max_queue_size: usize,
    pub retry_backoff_ms: u64,
    /// How long to retain sent queue rows locally before pruning
    #[serde(default = "default_sent_retention_hours")]
    pub sent_retention_hours: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptionConfig {
    pub enabled: bool,
    pub key_rotation_days: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoggingConfig {
    /// Maximum log entries per second before dropping
    pub max_log_rate: u64,
    /// Enable file-based log export
    pub log_to_file: bool,
    /// Log file path (if log_to_file is true)
    pub log_file_path: String,
    /// Days to retain warnings and audit records locally after sync
    #[serde(default = "default_warning_audit_retention_days")]
    pub warning_audit_retention_days: u64,
    /// Compress retained warning/audit rows to save space
    #[serde(default = "default_compress_warning_audit")]
    pub compress_warning_audit: bool,
}

impl Default for LoggingConfig {
    fn default() -> Self {
        Self {
            max_log_rate: 1000,
            log_to_file: false,
            log_file_path: "/var/log/beacon/agent.log".to_string(),
            warning_audit_retention_days: 10,
            compress_warning_audit: true,
        }
    }
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            server_addr: "wss://localhost:8000/ws/ingest/".to_string(),
            username: "admin".to_string(),
            password: String::new(),
            secret: String::new(),
            storage_dir: "/var/lib/beacon/agent".to_string(),
            interval_seconds: 5,
            collectors: CollectorConfig {
                cpu: true,
                ram: true,
                storage: true,
                network: true,
                process: true,
                systemd: true,
                system_inventory: true,
                docker: false,
                kubernetes: false,
                temperature: true,
                power: false,
                gpu: true,
                max_processes: 512,
            },
            tls: TlsConfig {
                verify_cert: true,
                ca_cert_path: None,
            },
            queue: QueueConfig {
                max_retries: 5,
                max_queue_size: 100_000,
                retry_backoff_ms: 1_000,
                sent_retention_hours: 24,
            },
            encryption: EncryptionConfig {
                enabled: true,
                key_rotation_days: 30,
            },
            logging: LoggingConfig::default(),
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

    /// Apply a config update payload (from server WebSocket) and return the modified config.
    /// Fields like `cpu_enabled`, `docker_enabled`, `interval_seconds` are mapped
    /// to the corresponding AgentConfig fields.
    pub fn apply_update(mut self, payload: &serde_json::Value) -> Self {
        if let Some(val) = payload.get("cpu_enabled").and_then(|v| v.as_bool()) {
            self.collectors.cpu = val;
        }
        if let Some(val) = payload.get("ram_enabled").and_then(|v| v.as_bool()) {
            self.collectors.ram = val;
        }
        if let Some(val) = payload.get("storage_enabled").and_then(|v| v.as_bool()) {
            self.collectors.storage = val;
        }
        if let Some(val) = payload.get("network_enabled").and_then(|v| v.as_bool()) {
            self.collectors.network = val;
        }
        if let Some(val) = payload.get("process_enabled").and_then(|v| v.as_bool()) {
            self.collectors.process = val;
        }
        if let Some(val) = payload.get("systemd_enabled").and_then(|v| v.as_bool()) {
            self.collectors.systemd = val;
        }
        if let Some(val) = payload
            .get("system_inventory_enabled")
            .and_then(|v| v.as_bool())
        {
            self.collectors.system_inventory = val;
        }
        if let Some(val) = payload.get("docker_enabled").and_then(|v| v.as_bool()) {
            self.collectors.docker = val;
        }
        if let Some(val) = payload.get("kubernetes_enabled").and_then(|v| v.as_bool()) {
            self.collectors.kubernetes = val;
        }
        if let Some(val) = payload.get("temperature_enabled").and_then(|v| v.as_bool()) {
            self.collectors.temperature = val;
        }
        if let Some(val) = payload.get("power_enabled").and_then(|v| v.as_bool()) {
            self.collectors.power = val;
        }
        if let Some(val) = payload.get("gpu_enabled").and_then(|v| v.as_bool()) {
            self.collectors.gpu = val;
        }
        if let Some(val) = payload.get("interval_seconds").and_then(|v| v.as_u64()) {
            self.interval_seconds = val;
        }
        if let Some(val) = payload.get("retention_days").and_then(|v| v.as_u64()) {
            // retention_days is not a field on AgentConfig; it's server-side only.
            // Silently ignore.
            let _ = val;
        }
        self
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
