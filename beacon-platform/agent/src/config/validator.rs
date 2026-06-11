// config/validator.rs — Configuration Validation (SRP)
//
// Validation rules are isolated here so they can be unit-tested independently
// of the I/O in `config/mod.rs`.
//
// Note: The `secret` field is intentionally NOT required to be non-empty here.
// The secret may be supplied via the BEACON_AGENT_SECRET environment variable
// at runtime.  `registration::resolve_secret()` enforces that at least one
// source provides a non-empty value right before the registration attempt.

use anyhow::{bail, Result};
use crate::config::AgentConfig;

pub struct ConfigValidator;

impl ConfigValidator {
    pub fn validate(config: &AgentConfig) -> Result<()> {
        Self::check_server_addr(&config.server_addr)?;
        Self::check_interval(config.interval_seconds)?;
        Self::check_queue(&config.queue.max_queue_size, &config.queue.max_retries)?;
        Self::check_username(&config.username)?;
        Ok(())
    }

    fn check_server_addr(addr: &str) -> Result<()> {
        if !addr.starts_with("ws://") && !addr.starts_with("wss://") {
            bail!("server_addr must start with ws:// or wss://, got: {addr}");
        }
        Ok(())
    }

    fn check_interval(interval: u64) -> Result<()> {
        if interval == 0 {
            bail!("interval_seconds must be > 0");
        }
        if interval > 3600 {
            bail!("interval_seconds must be <= 3600 (1 hour), got: {interval}");
        }
        Ok(())
    }

    fn check_queue(max_size: &usize, max_retries: &u32) -> Result<()> {
        if *max_size == 0 {
            bail!("queue.max_queue_size must be > 0");
        }
        if *max_retries == 0 {
            bail!("queue.max_retries must be > 0");
        }
        Ok(())
    }

    fn check_username(username: &str) -> Result<()> {
        if username.trim().is_empty() {
            bail!("username must not be empty");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::AgentConfig;

    #[test]
    fn ws_scheme_is_accepted() {
        let mut cfg = AgentConfig::default();
        cfg.server_addr = "ws://localhost:8000/ws/".to_string();
        assert!(ConfigValidator::validate(&cfg).is_ok());
    }

    #[test]
    fn wss_scheme_is_accepted() {
        ConfigValidator::validate(&AgentConfig::default()).unwrap();
    }

    #[test]
    fn http_scheme_is_rejected() {
        let mut cfg = AgentConfig::default();
        cfg.server_addr = "http://example.com".to_string();
        assert!(ConfigValidator::validate(&cfg).is_err());
    }

    #[test]
    fn zero_interval_is_rejected() {
        let mut cfg = AgentConfig::default();
        cfg.interval_seconds = 0;
        let err = ConfigValidator::validate(&cfg).unwrap_err();
        assert!(err.to_string().contains("interval_seconds"));
    }

    #[test]
    fn over_max_interval_is_rejected() {
        let mut cfg = AgentConfig::default();
        cfg.interval_seconds = 9999;
        assert!(ConfigValidator::validate(&cfg).is_err());
    }

    #[test]
    fn empty_username_is_rejected() {
        let mut cfg = AgentConfig::default();
        cfg.username = "   ".to_string();
        assert!(ConfigValidator::validate(&cfg).is_err());
    }

    #[test]
    fn zero_queue_size_is_rejected() {
        let mut cfg = AgentConfig::default();
        cfg.queue.max_queue_size = 0;
        assert!(ConfigValidator::validate(&cfg).is_err());
    }

    /// Empty secret is allowed at the config level — env var may supply it.
    #[test]
    fn empty_secret_passes_config_validation() {
        let mut cfg = AgentConfig::default();
        cfg.secret = String::new();
        assert!(ConfigValidator::validate(&cfg).is_ok());
    }
}