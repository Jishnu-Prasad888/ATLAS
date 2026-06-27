// registration.rs — Agent Registration & Secret Verification
//
// Flow:
//   1. Agent calls `register()` which POSTs to /api/v1/agents/register/
//      with agent_id, hostname, os, arch, version, tags, metadata, and secret.
//   2. The server validates the secret against its own .env value.
//   3. On success (HTTP 200 / 201) we persist registration status locally.
//   4. On mismatch (403 / 401) we print a clear error and halt — no metrics
//      are sent until the agent is properly registered.
//   5. `is_registered()` is a cheap local check used by the daemon loop before
//      starting collectors.  It re-validates against the server on every start
//      so a revoked / disabled agent stops promptly.

use anyhow::{anyhow, bail, Result};
use serde::{Deserialize, Serialize};
use tracing::{error, info, warn};

use crate::config::AgentConfig;
use crate::engines::identity::AgentIdentity;
use crate::engines::logging::LogEngine;
use crate::storage::StorageManager;

// ─── Wire types ───────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct RegisterRequest<'a> {
    agent_id: &'a str,
    hostname: &'a str,
    os: &'a str,
    architecture: &'a str,
    version: &'static str,
    tags: Vec<String>,
    metadata: serde_json::Value,
    secret: &'a str,
}

/// Minimal fields we care about from the register response.
#[derive(Deserialize, Debug)]
struct RegisterResponse {
    agent_id: String,
    status: Option<String>,
}

// ─── Registration state stored locally ────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub enum RegistrationStatus {
    /// Successfully registered with the server.
    Registered,
    /// Secret mismatch or server rejected the agent.
    SecretMismatch,
    /// Never attempted or network/server error.
    Unregistered,
}

impl RegistrationStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            RegistrationStatus::Registered => "registered",
            RegistrationStatus::SecretMismatch => "secret_mismatch",
            RegistrationStatus::Unregistered => "unregistered",
        }
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn from_str(s: &str) -> Self {
        match s {
            "registered" => RegistrationStatus::Registered,
            "secret_mismatch" => RegistrationStatus::SecretMismatch,
            _ => RegistrationStatus::Unregistered,
        }
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/// Attempt to register (or re-register) the agent with the Beacon server.
///
/// Returns `Ok(())` only when the server confirms registration.
/// Returns `Err` on secret mismatch, network failure, or configuration error.
/// Always persists the final status to local storage so `is_registered()` is
/// consistent with the last server response.
pub async fn register(
    config: &AgentConfig,
    identity: &AgentIdentity,
    storage: &StorageManager,
    log_engine: &LogEngine,
) -> Result<()> {
    // ── Validate secret is present ────────────────────────────────────────────
    let secret = resolve_secret(config)?;

    let base_url = config.rest_base_url.trim_end_matches('/');
    let register_url = format!("{}/api/v1/agents/register/", base_url);

    info!(
        "Registering agent {} at {}",
        &identity.agent_id[..16.min(identity.agent_id.len())],
        register_url
    );

    // ── Build and send request ────────────────────────────────────────────────
    let body = RegisterRequest {
        agent_id: &identity.agent_id,
        hostname: &identity.hostname,
        os: &identity.os,
        architecture: &identity.arch,
        version: "1.0.0",
        tags: vec![],
        metadata: serde_json::json!({}),
        secret: &secret,
    };

    let client = build_http_client(config)?;
    let response = client
        .post(&register_url)
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("Registration HTTP request failed: {}", e))?;

    let http_status = response.status();
    let body_text = response.text().await.unwrap_or_default();

    match http_status.as_u16() {
        // ── Success ───────────────────────────────────────────────────────────
        200 | 201 => {
            let resp: RegisterResponse = serde_json::from_str(&body_text)
                .map_err(|e| anyhow!("Failed to parse registration response: {}", e))?;

            info!(
                "Agent registered successfully (id={}, status={:?})",
                resp.agent_id, resp.status
            );

            log_engine
                .info(
                    "auth_engine",
                    &format!(
                        "Agent {} registered with server (hostname={})",
                        &resp.agent_id[..16.min(resp.agent_id.len())],
                        identity.hostname,
                    ),
                )
                .await?;

            storage
                .set_config(
                    "registration_status",
                    RegistrationStatus::Registered.as_str(),
                )
                .await?;
            storage
                .set_config("registered_agent_id", &resp.agent_id)
                .await?;

            Ok(())
        }

        // ── Secret mismatch ───────────────────────────────────────────────────
        401 | 403 => {
            let msg = format!(
                "Registration rejected by server (HTTP {}): {}",
                http_status, body_text
            );
            error!("{}", msg);

            log_engine
                .warn("auth_engine", "Registration rejected — secret mismatch")
                .await?;

            storage
                .set_config(
                    "registration_status",
                    RegistrationStatus::SecretMismatch.as_str(),
                )
                .await?;

            bail!(
                "Secret mismatch — the secret provided to 'beacon-agent init' does not match \
                 the BEACON_AGENT_SECRET configured on the server.\n\
                 Run 'beacon-agent init' again with the correct secret or check your server \
                 .env file."
            );
        }

        // ── Agent disabled ────────────────────────────────────────────────────
        404 => {
            let msg = format!(
                "Server returned 404 during registration. The agent may have been disabled \
                 or removed on the server side. Body: {}",
                body_text
            );
            warn!("{}", msg);

            log_engine
                .warn(
                    "auth_engine",
                    &format!("Registration rejected — agent disabled or removed on server"),
                )
                .await?;

            storage
                .set_config(
                    "registration_status",
                    RegistrationStatus::Unregistered.as_str(),
                )
                .await?;
            bail!("{}", msg);
        }

        // ── Other HTTP errors ─────────────────────────────────────────────────
        other => {
            let msg = format!(
                "Unexpected HTTP {} from registration endpoint: {}",
                other, body_text
            );
            error!("{}", msg);

            log_engine
                .warn(
                    "auth_engine",
                    &format!("Registration failed (HTTP {})", other,),
                )
                .await?;

            let current = storage.get_config("registration_status").await?;
            if current.as_deref() != Some("registered") {
                storage
                    .set_config(
                        "registration_status",
                        RegistrationStatus::Unregistered.as_str(),
                    )
                    .await?;
            }
            bail!("{}", msg);
        }
    }
}

/// Check whether this agent is currently considered registered.
///
/// This is the fast path used by the daemon: if local state says `registered`,
/// we skip a redundant network call.  The full `register()` is always called
/// once per daemon start to refresh the status.
pub async fn is_registered(storage: &StorageManager) -> Result<bool> {
    let status = storage.get_config("registration_status").await?;
    Ok(status.as_deref() == Some("registered"))
}

/// Clear local registration state (e.g. called from `init` to force fresh
/// registration on next start).
pub async fn clear_registration(storage: &StorageManager) -> Result<()> {
    storage
        .set_config(
            "registration_status",
            RegistrationStatus::Unregistered.as_str(),
        )
        .await?;
    Ok(())
}

// ─── Secret resolution ────────────────────────────────────────────────────────

/// Resolve the agent secret with the following priority:
///   1. `BEACON_AGENT_SECRET` environment variable (or from a `.env` file)
///   2. `config.secret` field in agent.toml
///
/// Returns an error if neither is set.
pub fn resolve_secret(config: &AgentConfig) -> Result<String> {
    // Priority 1: environment variable (supports .env via shell / systemd env)
    if let Ok(env_secret) = std::env::var("BEACON_AGENT_SECRET") {
        let trimmed = env_secret.trim().to_string();
        if !trimmed.is_empty() {
            return Ok(trimmed);
        }
    }

    // Priority 2: toml config field
    let cfg_secret = config.secret.trim().to_string();
    if !cfg_secret.is_empty() {
        return Ok(cfg_secret);
    }

    bail!(
        "No agent secret configured.\n\
         Set BEACON_AGENT_SECRET in your environment or .env file, \
         or add 'secret = \"...\"' to your agent.toml.\n\
         The secret must match the BEACON_AGENT_SECRET on the server."
    );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/// Build a `reqwest::Client` that respects the TLS configuration.
pub(crate) fn build_http_client(config: &AgentConfig) -> Result<reqwest::Client> {
    let mut builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(30));

    if !config.tls.verify_cert {
        warn!("TLS certificate verification DISABLED for HTTP registration client");
        builder = builder.danger_accept_invalid_certs(true);
    }

    if let Some(ref ca_path) = config.tls.ca_cert_path {
        if !ca_path.is_empty() {
            let pem = std::fs::read(ca_path)
                .map_err(|e| anyhow!("Failed to read CA cert {}: {}", ca_path, e))?;
            let cert = reqwest::Certificate::from_pem(&pem)
                .map_err(|e| anyhow!("Invalid CA cert: {}", e))?;
            builder = builder.add_root_certificate(cert);
        }
    }

    builder
        .build()
        .map_err(|e| anyhow!("Failed to build HTTP client: {}", e))
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::AgentConfig;

    #[test]
    fn resolve_secret_from_config() {
        let mut cfg = AgentConfig::default();
        cfg.secret = "my-secret".to_string();
        // Make sure env var isn't set
        std::env::remove_var("BEACON_AGENT_SECRET");
        assert_eq!(resolve_secret(&cfg).unwrap(), "my-secret");
    }

    #[test]
    fn resolve_secret_prefers_env_over_config() {
        let mut cfg = AgentConfig::default();
        cfg.secret = "config-secret".to_string();
        std::env::set_var("BEACON_AGENT_SECRET", "env-secret");
        let result = resolve_secret(&cfg).unwrap();
        std::env::remove_var("BEACON_AGENT_SECRET");
        assert_eq!(result, "env-secret");
    }

    #[test]
    fn resolve_secret_errors_when_neither_set() {
        let cfg = AgentConfig::default(); // secret = ""
        std::env::remove_var("BEACON_AGENT_SECRET");
        assert!(resolve_secret(&cfg).is_err());
    }

    #[test]
    fn registration_status_round_trips() {
        for s in &[
            RegistrationStatus::Registered,
            RegistrationStatus::SecretMismatch,
            RegistrationStatus::Unregistered,
        ] {
            assert_eq!(*s, RegistrationStatus::from_str(s.as_str()));
        }
    }
}
