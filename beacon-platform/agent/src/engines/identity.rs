// engines/identity.rs — Identity Engine
// Derives a stable SHA-256 agent_id from hardware characteristics.
// Persists in config.db so it survives reboots.

use anyhow::Result;
use sha2::{Digest, Sha256};
use std::fs;
use std::process::Command;
use tracing::info;

use crate::storage::StorageManager;

#[derive(Debug, Clone)]
pub struct AgentIdentity {
    pub agent_id: String,
    pub hostname: String,
    pub os: String,
    pub arch: String,
}

pub struct IdentityEngine;

impl IdentityEngine {
    pub async fn new(storage: &StorageManager) -> Result<AgentIdentity> {
        // Check if identity is already persisted
        if let Some((agent_id, hostname)) = storage.get_agent_identity().await? {
            info!(
                "Loaded existing agent identity: {}",
                &agent_id[..agent_id.len().min(20)]
            );
            return Ok(AgentIdentity {
                agent_id,
                hostname,
                os: "linux".to_string(),
                arch: std::env::consts::ARCH.to_string(),
            });
        }

        // Derive new identity from hardware fingerprints
        let agent_id = Self::derive_agent_id()?;
        let hostname = Self::get_hostname();

        storage.store_agent_identity(&agent_id, &hostname).await?;
        info!(
            "Generated new agent identity: {}",
            &agent_id[..agent_id.len().min(20)]
        );

        Ok(AgentIdentity {
            agent_id,
            hostname,
            os: "linux".to_string(),
            arch: std::env::consts::ARCH.to_string(),
        })
    }

    fn derive_agent_id() -> Result<String> {
        let mut hasher = Sha256::new();

        // /etc/machine-id — stable across reboots
        match fs::read_to_string("/etc/machine-id") {
            Ok(mid) => hasher.update(mid.trim().as_bytes()),
            Err(_) => hasher.update(b"no-machine-id"),
        }

        // Hostname
        hasher.update(Self::get_hostname().as_bytes());

        // CPU architecture
        hasher.update(std::env::consts::ARCH.as_bytes());

        // CPU model from /proc/cpuinfo
        match fs::read_to_string("/proc/cpuinfo") {
            Ok(cpu) => {
                for line in cpu.lines() {
                    if line.starts_with("model name") || line.starts_with("Hardware") {
                        hasher.update(line.as_bytes());
                        break;
                    }
                }
            }
            Err(_) => hasher.update(b"no-cpuinfo"),
        }

        // RAM total from /proc/meminfo
        match fs::read_to_string("/proc/meminfo") {
            Ok(mem) => {
                if let Some(line) = mem.lines().next() {
                    hasher.update(line.as_bytes());
                }
            }
            Err(_) => hasher.update(b"no-meminfo"),
        }

        // Stable random salt (generated once, stored on disk)
        let salt = Self::get_or_create_salt();
        hasher.update(salt.as_bytes());

        let result = hasher.finalize();
        Ok(format!("sha256:{}", hex::encode(result)))
    }

    fn get_hostname() -> String {
        // Try /etc/hostname first
        if let Ok(h) = fs::read_to_string("/etc/hostname") {
            let trimmed = h.trim().to_string();
            if !trimmed.is_empty() {
                return trimmed;
            }
        }

        // Fall back to `hostname` command
        if let Ok(out) = Command::new("hostname").output() {
            let h = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !h.is_empty() {
                return h;
            }
        }

        // Fall back to environment
        std::env::var("HOSTNAME").unwrap_or_else(|_| "unknown-host".to_string())
    }

    fn get_or_create_salt() -> String {
        let salt_path = "/var/lib/beacon/agent/.identity_salt";

        if let Ok(salt) = fs::read_to_string(salt_path) {
            let trimmed = salt.trim().to_string();
            if !trimmed.is_empty() {
                return trimmed;
            }
        }

        // Generate new 32-byte random salt
        use rand::RngCore;
        let mut bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut bytes);
        let salt = hex::encode(bytes);

        let _ = fs::create_dir_all("/var/lib/beacon/agent");
        let _ = fs::write(salt_path, &salt);
        salt
    }
}
