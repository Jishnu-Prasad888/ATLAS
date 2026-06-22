// transport/mod.rs — Secure WebSocket Transport
// TLS 1.3 WebSocket. Auto-reconnects with exponential backoff.
// Agent protocol: register → heartbeat loop + telemetry flush.

use anyhow::{anyhow, Result};
use base64::Engine as _;
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use tokio::time::sleep;
use tokio_tungstenite::{connect_async_tls_with_config, tungstenite::Message, Connector};
use tracing::{debug, error, info, warn};

use crate::config::{AgentConfig, CollectorFlags, ConfigValidator};
use crate::engines::encryption::EncryptionEngine;
use crate::engines::identity::AgentIdentity;
use crate::engines::logging::LogEngine;
use crate::engines::queue::QueueEngine;
use crate::registration::{build_http_client, resolve_secret};

const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(15);
const RECONNECT_BASE_DELAY: Duration = Duration::from_secs(1);
const RECONNECT_MAX_DELAY: Duration = Duration::from_secs(60);
const FLUSH_BATCH_SIZE: usize = 50;

#[derive(Clone)]
pub struct WebSocketTransport {
    config: AgentConfig,
    config_path: String,
    identity: AgentIdentity,
    queue: QueueEngine,
    encryption: EncryptionEngine,
    log_engine: LogEngine,
    collector_flags: CollectorFlags,
}

impl WebSocketTransport {
    pub fn new(
        config: AgentConfig,
        config_path: String,
        identity: AgentIdentity,
        queue: QueueEngine,
        encryption: EncryptionEngine,
        log_engine: LogEngine,
        collector_flags: CollectorFlags,
    ) -> Self {
        Self {
            config,
            config_path,
            identity,
            queue,
            encryption,
            log_engine,
            collector_flags,
        }
    }

    /// Run forever — reconnects automatically with exponential backoff.
    pub async fn run(&self) -> Result<()> {
        let mut backoff = RECONNECT_BASE_DELAY;
        let mut first_connect = true;
        loop {
            info!("Connecting to {}", self.config.server_addr);
            match self.connect_and_run().await {
                Ok(()) => {
                    info!("Transport disconnected cleanly — reconnecting...");
                    backoff = RECONNECT_BASE_DELAY;
                    first_connect = false;
                }
                Err(e) => {
                    warn!(
                        "Transport error: {e}. Reconnecting in {:.1}s...",
                        backoff.as_secs_f32()
                    );
                    if !first_connect {
                        let _ = self
                            .log_engine
                            .warn(
                                "queue_engine",
                                &format!("Network unavailable, buffering messages"),
                            )
                            .await;
                    }
                    sleep(backoff).await;
                    backoff = (backoff * 2).min(RECONNECT_MAX_DELAY);
                    first_connect = false;
                }
            }
        }
    }

    async fn connect_and_run(&self) -> Result<()> {
        // Connect directly — the WebSocket consumer authenticates agents via the
        // registration message, not JWT. The middleware gracefully handles the
        // absence of a token by setting AnonymousUser.
        let url = url::Url::parse(&self.config.server_addr)
            .map_err(|e| anyhow!("Invalid server URL: {e}"))?;
        let connector = self.build_tls_connector()?;

        let (ws_stream, _) = connect_async_tls_with_config(url, None, false, Some(connector))
            .await
            .map_err(|e| anyhow!("WebSocket connect failed: {e}"))?;

        info!("WebSocket connected to {}", self.config.server_addr);

        // Log connection recovery and replay count
        let queue_count = self
            .queue
            .status()
            .await
            .map(|s| s.pending + s.failed)
            .unwrap_or(0);
        if queue_count > 0 {
            let _ = self
                .log_engine
                .info(
                    "queue_engine",
                    &format!(
                        "Recovered connection, replaying {} queued messages",
                        queue_count,
                    ),
                )
                .await;
        } else {
            let _ = self
                .log_engine
                .info("service_engine", "Connection established with server")
                .await;
        }

        let (mut writer, mut reader) = ws_stream.split();

        let secret = resolve_secret(&self.config)
            .map_err(|e| anyhow!("Missing agent secret for WebSocket registration: {e}"))?;

        // Send registration
        let register_msg = json!({
            "type": "register",
            "payload": {
                "agent_id":     self.identity.agent_id,
                "hostname":     self.identity.hostname,
                "os":           self.identity.os,
                "architecture": self.identity.arch,
                "version":      "1.0.0",
                "tags":         [],
                "metadata":     {},
                "secret":       secret,
            }
        });
        writer
            .send(Message::Text(register_msg.to_string()))
            .await
            .map_err(|e| anyhow!("Registration send failed: {e}"))?;
        info!(
            "Registration sent for agent {}",
            &self.identity.agent_id[..16.min(self.identity.agent_id.len())]
        );

        // Send config request to sync collector flags from server
        let config_req = json!({
            "type": "config_request",
            "agent_id": self.identity.agent_id,
        });
        let _ = writer.send(Message::Text(config_req.to_string())).await;
        debug!("Config request sent");

        let queue = self.queue.clone();
        let identity = self.identity.clone();
        let enc = self.encryption.clone();
        let flags = self.collector_flags.clone();
        let config = self.config.clone();
        let config_path = self.config_path.clone();
        let log_engine = self.log_engine.clone();
        let retention_days = self.config.logging.warning_audit_retention_days as i64;
        let compress_retained = self.config.logging.compress_warning_audit;
        let queue_sent_retention_hours = self.config.queue.sent_retention_hours as i64;

        // Wrap writer in Arc<Mutex> so heartbeat and flush loops can share it
        let writer = Arc::new(Mutex::new(writer));

        // Run all loops concurrently; abort all on first error
        tokio::select! {
            r = Self::heartbeat_loop(Arc::clone(&writer), identity.clone())            => r,
            r = Self::flush_loop(
                Arc::clone(&writer),
                queue,
                enc,
                identity.clone(),
                retention_days,
                compress_retained,
                queue_sent_retention_hours,
            )     => r,
            r = Self::read_loop(&mut reader, flags, config, config_path, log_engine, identity)    => r,
        }
    }

    async fn heartbeat_loop<S>(writer: Arc<Mutex<S>>, identity: AgentIdentity) -> Result<()>
    where
        S: SinkExt<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin,
    {
        loop {
            sleep(HEARTBEAT_INTERVAL).await;
            let hb = json!({
                "type":     "heartbeat",
                "agent_id": identity.agent_id,
                "status":   "ONLINE",
            });
            writer
                .lock()
                .await
                .send(Message::Text(hb.to_string()))
                .await
                .map_err(|e| anyhow!("Heartbeat send failed: {e}"))?;
            debug!("Heartbeat sent");
        }
    }

    async fn flush_loop<S>(
        writer: Arc<Mutex<S>>,
        queue: QueueEngine,
        enc: EncryptionEngine,
        identity: AgentIdentity,
        retention_days: i64,
        compress_retained: bool,
        queue_sent_retention_hours: i64,
    ) -> Result<()>
    where
        S: SinkExt<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin,
    {
        let mut last_cleanup = Instant::now() - Duration::from_secs(15);
        loop {
            let batch = queue.dequeue_batch(FLUSH_BATCH_SIZE).await?;
            if batch.is_empty() {
                if last_cleanup.elapsed() >= Duration::from_secs(10) {
                    if let Ok(status) = queue.status().await {
                        if status.pending == 0 && status.failed == 0 && status.processing == 0 {
                            let storage = queue.storage();
                            match storage
                                .cleanup_after_sync(
                                    retention_days,
                                    compress_retained,
                                    queue_sent_retention_hours,
                                )
                                .await
                            {
                                Ok(stats) => {
                                    debug!(
                                        "Cleanup complete (metrics_deleted={}, warnings_deleted={}, audits_deleted={}, queue_pruned={})",
                                        stats.metrics_deleted,
                                        stats.warnings_deleted,
                                        stats.audits_deleted,
                                        stats.queue_pruned,
                                    );
                                }
                                Err(e) => {
                                    warn!("Cleanup after sync failed: {e}");
                                }
                            }
                            last_cleanup = Instant::now();
                        }
                    }
                }
                sleep(Duration::from_millis(500)).await;
                continue;
            }

            for msg in &batch {
                // Decrypt locally-encrypted payload before transmitting
                let plaintext = if enc.is_enabled() {
                    let ep = crate::engines::encryption::EncryptedPayload {
                        data: msg.payload.clone(),
                    };
                    enc.decrypt(&ep)
                        .await
                        .unwrap_or_else(|_| msg.payload.clone())
                } else {
                    msg.payload.clone()
                };

                let payload_json: serde_json::Value = serde_json::from_slice(&plaintext)
                    .unwrap_or_else(|_| {
                        json!({
                            "raw": base64::engine::general_purpose::STANDARD.encode(&plaintext)
                        })
                    });

                let envelope = json!({
                    "type":     msg.msg_type,
                    "agent_id": identity.agent_id,
                    "payload":  payload_json,
                });

                match writer
                    .lock()
                    .await
                    .send(Message::Text(envelope.to_string()))
                    .await
                {
                    Ok(_) => {
                        queue.ack(msg.id).await?;
                        debug!("Flushed message {}", msg.message_id);
                    }
                    Err(e) => {
                        error!("Send failed for {}: {e}", msg.message_id);
                        queue.nack(msg.id, &msg.message_id).await?;
                        return Err(anyhow!("Send error: {e}"));
                    }
                }
            }

            sleep(Duration::from_millis(100)).await;
        }
    }

    async fn read_loop<S>(
        reader: &mut S,
        collector_flags: CollectorFlags,
        agent_config: AgentConfig,
        config_path: String,
        log_engine: LogEngine,
        identity: AgentIdentity,
    ) -> Result<()>
    where
        S: StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
    {
        while let Some(msg) = reader.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                        match parsed.get("type").and_then(|t| t.as_str()) {
                            Some("registered") => info!("Agent registration confirmed by server"),
                            Some("heartbeat_ack") => debug!("Heartbeat acknowledged"),
                            Some("config_update") => {
                                info!("Received config update from server");
                                if let Some(payload) = parsed.get("payload") {
                                    Self::apply_config_update(
                                        &collector_flags,
                                        payload,
                                        &agent_config,
                                        &config_path,
                                    )
                                    .await;
                                }
                            }
                            Some("process_kill") => {
                                if let Some(payload) = parsed.get("payload") {
                                    if let Some(pid) = payload.get("pid").and_then(|p| p.as_i64()) {
                                        let req_id =
                                            payload.get("request_id").and_then(|r| r.as_i64());
                                        info!(
                                            "Received process_kill for pid {} (req {:?})",
                                            pid, req_id
                                        );
                                        let result =
                                            Self::kill_process(pid as i32, &log_engine).await;
                                        if let Err(e) = &result {
                                            error!("process_kill failed for pid {}: {}", pid, e);
                                        }
                                        if let Err(e) = Self::send_kill_result(
                                            &agent_config,
                                            &identity,
                                            pid as i32,
                                            req_id,
                                            result.as_ref().err(),
                                        )
                                        .await
                                        {
                                            warn!(
                                                "Failed to send kill result for pid {}: {}",
                                                pid, e
                                            );
                                        }
                                    }
                                }
                            }
                            _ => debug!("Server message: {}", &text[..text.len().min(120)]),
                        }
                    }
                }
                Ok(Message::Close(frame)) => {
                    info!("Server closed connection: {:?}", frame);
                    return Ok(());
                }
                Ok(Message::Ping(_)) => debug!("Received ping"),
                Ok(_) => {}
                Err(e) => return Err(anyhow!("WebSocket read error: {e}")),
            }
        }
        Ok(())
    }

    /// Apply a config_update payload to the shared collector flags and persist to disk.
    /// The payload is expected to contain boolean fields like "docker_enabled".
    async fn apply_config_update(
        flags: &CollectorFlags,
        payload: &serde_json::Value,
        config: &AgentConfig,
        config_path: &str,
    ) {
        // Apply and validate config before mutating runtime flags or disk
        let updated = config.clone().apply_update(payload);
        if let Err(e) = ConfigValidator::validate(&updated) {
            warn!("Rejected config update: {e}");
            return;
        }

        // Update in-memory flags for all collectors
        {
            let mut map = flags.write().await;
            let mappings = [
                ("cpu_enabled", "cpu"),
                ("ram_enabled", "ram"),
                ("storage_enabled", "storage"),
                ("network_enabled", "network"),
                ("process_enabled", "process"),
                ("systemd_enabled", "systemd"),
                ("system_inventory_enabled", "system_inventory"),
                ("docker_enabled", "docker"),
                ("kubernetes_enabled", "kubernetes"),
                ("temperature_enabled", "temperature"),
                ("power_enabled", "power"),
                ("gpu_enabled", "gpu"),
            ];
            for (field, key) in &mappings {
                if let Some(val) = payload.get(*field).and_then(|v| v.as_bool()) {
                    info!("Config update: {} = {}", key, val);
                    map.insert(key.to_string(), val);
                }
            }
        }

        // Persist updated config to disk so changes survive agent restart
        if let Err(e) = updated.save(config_path).await {
            error!("Failed to persist config update to disk: {e}");
        } else {
            info!("Config persisted to {config_path}");
        }
    }

    async fn kill_process(pid: i32, log_engine: &LogEngine) -> Result<()> {
        // Use libc kill to send SIGKILL. Fall back to /bin/kill if needed.
        unsafe {
            let res = libc::kill(pid, libc::SIGKILL);
            if res == 0 {
                let _ = log_engine
                    .info(
                        "process_kill",
                        &format!("Killed pid {} via libc SIGKILL", pid),
                    )
                    .await;
                return Ok(());
            }
        }
        // If libc kill failed, attempt shell kill
        let status = std::process::Command::new("/bin/kill")
            .arg("-9")
            .arg(pid.to_string())
            .status();
        match status {
            Ok(s) if s.success() => {
                let _ = log_engine
                    .info(
                        "process_kill",
                        &format!("Killed pid {} via /bin/kill -9", pid),
                    )
                    .await;
                Ok(())
            }
            Ok(s) => Err(anyhow!("kill exited with status {:?}", s.code())),
            Err(e) => Err(anyhow!("kill failed: {e}")),
        }
    }

    fn build_tls_connector(&self) -> Result<Connector> {
        use rustls::{ClientConfig, RootCertStore};
        use std::sync::Arc;

        let mut root_store = RootCertStore::empty();

        if self.config.tls.verify_cert {
            let native_certs = rustls_native_certs::load_native_certs()
                .map_err(|e| anyhow!("Failed to load native certs: {e}"))?;
            for cert in native_certs {
                root_store
                    .add(cert)
                    .map_err(|e| anyhow!("Invalid cert: {e}"))?;
            }
        } else {
            warn!("TLS certificate verification DISABLED — not for production!");
            root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        }

        let tls_config = ClientConfig::builder()
            .with_root_certificates(root_store)
            .with_no_client_auth();

        Ok(Connector::Rustls(Arc::new(tls_config)))
    }

    async fn send_kill_result(
        config: &AgentConfig,
        identity: &AgentIdentity,
        pid: i32,
        request_id: Option<i64>,
        error: Option<&anyhow::Error>,
    ) -> Result<()> {
        // Derive REST base from WS URL
        let ws_url = url::Url::parse(&config.server_addr)?;
        let scheme = match ws_url.scheme() {
            "wss" => "https",
            "ws" => "http",
            other => other,
        };
        let host = ws_url
            .host_str()
            .ok_or_else(|| anyhow!("Invalid server host"))?;
        let port = ws_url.port().map(|p| format!(":{p}")).unwrap_or_default();
        let base = format!("{}://{}{}", scheme, host, port);
        let url = format!(
            "{}/api/v1/agents/{}/kill_process_result/",
            base, identity.agent_id
        );

        let client = build_http_client(config)?;
        let secret = resolve_secret(config)?;
        let mut payload = serde_json::json!({
            "pid": pid,
            "status": if error.is_some() { "failed" } else { "completed" },
        });
        if let Some(id) = request_id {
            payload["request_id"] = serde_json::json!(id);
        }
        if let Some(err) = error {
            payload["error"] = serde_json::json!(err.to_string());
        }

        client
            .post(url)
            .header("X-Beacon-Agent-Secret", secret)
            .header("X-Agent-ID", &identity.agent_id)
            .json(&payload)
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }
}
