use anyhow::{anyhow, Context, Result};
use async_nats::{jetstream, Client, ConnectOptions};
use base64::Engine as _;
use bytes::Bytes;
use chrono::Utc;
use futures_util::StreamExt;
use serde_json::json;
use std::io::Cursor;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::time::sleep;
use tracing::{debug, error, info, warn};

use async_nats::jetstream::consumer::pull::Config as PullConsumerConfig;
use async_nats::jetstream::consumer::AckPolicy;

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

const CONTROL_STREAM: &str = "agent_control";

const FRAME_VERSION: u8 = 1;
const ENCODING_NONE: u8 = 0;
const ENCODING_ZSTD: u8 = 1;
const ZSTD_LEVEL: i32 = 6;

#[derive(Clone)]
pub struct JetstreamTransport {
    config: AgentConfig,
    config_path: String,
    identity: AgentIdentity,
    queue: QueueEngine,
    encryption: EncryptionEngine,
    log_engine: LogEngine,
    collector_flags: CollectorFlags,
}

impl JetstreamTransport {
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

    pub async fn run(&self) -> Result<()> {
        let mut backoff = RECONNECT_BASE_DELAY;
        let mut first_connect = true;

        loop {
            info!(
                "Connecting to NATS at {} (agent={})",
                self.config.nats.url, self.identity.agent_id
            );

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
                                "Network unavailable, buffering messages",
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
        let (_, js) = self.connect_nats().await?;
        let js = Arc::new(js);

        info!(
            "Connected to NATS {} (prefix={}, command_prefix={})",
            self.config.nats.url,
            self.config.nats.subject_prefix,
            self.config.nats.command_prefix,
        );

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

        let secret = resolve_secret(&self.config)?;
        let register_envelope = json!({
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
        let register_subject =
            ingest_subject(&self.config.nats.subject_prefix, &self.identity.agent_id, "register");
        Self::publish_envelope(js.clone(), &register_subject, register_envelope, None).await?;
        info!(
            "Registration event published to {register_subject} for agent {}",
            &self.identity.agent_id[..16.min(self.identity.agent_id.len())]
        );

        let config_request_subject = ingest_subject(
            &self.config.nats.subject_prefix,
            &self.identity.agent_id,
            "config_request",
        );
        let config_request = json!({
            "type": "config_request",
            "agent_id": self.identity.agent_id,
        });
        let _ = Self::publish_envelope(js.clone(), &config_request_subject, config_request, None)
            .await;
        debug!("Config request published");

        let heartbeat_subject = ingest_subject(
            &self.config.nats.subject_prefix,
            &self.identity.agent_id,
            "heartbeat",
        );

        let command_filter = command_filter_subject(
            &self.config.nats.command_prefix,
            &self.identity.agent_id,
        );
        let durable_name = command_durable_name(&self.identity.agent_id);

        let heartbeat_task = Self::heartbeat_loop(
            js.clone(),
            heartbeat_subject,
            self.identity.clone(),
        );

        let flush_task = Self::flush_loop(
            js.clone(),
            self.config.nats.subject_prefix.clone(),
            self.identity.clone(),
            self.queue.clone(),
            self.encryption.clone(),
            self.config.logging.warning_audit_retention_days as i64,
            self.config.logging.compress_warning_audit,
            self.config.queue.sent_retention_hours as i64,
        );

        let command_task = Self::command_loop(
            js,
            command_filter,
            durable_name,
            self.config.clone(),
            self.config_path.clone(),
            self.collector_flags.clone(),
            self.log_engine.clone(),
            self.identity.clone(),
        );

        tokio::select! {
            res = heartbeat_task => res,
            res = flush_task => res,
            res = command_task => res,
        }
    }

    async fn connect_nats(&self) -> Result<(Client, jetstream::Context)> {
        let mut options = ConnectOptions::new()
            .name(format!("beacon-agent-{}", &self.identity.agent_id[..8.min(self.identity.agent_id.len())]))
            .retry_on_initial_connect()
            .max_reconnects(None);

        if let Some(path) = &self.config.nats.creds_path {
            options = options
                .credentials_file(path)
                .await
                .map_err(|e| anyhow!("Failed to load NATS credentials {}: {e}", path))?;
        }

        if let Some(timeout) = self.config.nats.connect_timeout {
            options = options.connection_timeout(Duration::from_secs(timeout));
        }

        let client = options
            .connect(self.config.nats.url.clone())
            .await
            .map_err(|e| anyhow!("Failed to connect to NATS: {e}"))?;

        let js = match &self.config.nats.domain {
            Some(domain) if !domain.is_empty() => jetstream::with_domain(client.clone(), domain),
            _ => jetstream::new(client.clone()),
        };

        Ok((client, js))
    }

    async fn publish_envelope(
        js: Arc<jetstream::Context>,
        subject: &str,
        envelope: serde_json::Value,
        message_id: Option<&str>,
    ) -> Result<()> {
        let json_bytes = serde_json::to_vec(&envelope)?;
        let frame = encode_frame(&json_bytes)?;
        let publish = match message_id {
            Some(id) => jetstream::context::Publish::build()
                .payload(Bytes::from(frame))
                .message_id(id),
            None => jetstream::context::Publish::build().payload(Bytes::from(frame)),
        };

        let subject_owned = subject.to_string();
        let ack = js
            .send_publish(subject_owned, publish)
            .await
            .map_err(|e| anyhow!("Failed to publish to {subject}: {e}"))?;
        ack.await
            .map_err(|e| anyhow!("Publish to {subject} not acknowledged: {e}"))?;
        Ok(())
    }

    async fn heartbeat_loop(
        js: Arc<jetstream::Context>,
        subject: String,
        identity: AgentIdentity,
    ) -> Result<()> {
        loop {
            sleep(HEARTBEAT_INTERVAL).await;
            let envelope = json!({
                "type":     "heartbeat",
                "agent_id": identity.agent_id,
                "status":   "ONLINE",
                "timestamp": Utc::now().to_rfc3339(),
            });
            if let Err(e) = Self::publish_envelope(js.clone(), &subject, envelope, None).await {
                return Err(anyhow!("Heartbeat send failed: {e}"));
            }
            debug!("Heartbeat published");
        }
    }

    async fn flush_loop(
        js: Arc<jetstream::Context>,
        subject_prefix: String,
        identity: AgentIdentity,
        queue: QueueEngine,
        encryption: EncryptionEngine,
        retention_days: i64,
        compress_retained: bool,
        queue_sent_retention_hours: i64,
    ) -> Result<()> {
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
                let subject = ingest_subject(&subject_prefix, &identity.agent_id, &msg.msg_type);

                let plaintext = if encryption.is_enabled() {
                    let ep = crate::engines::encryption::EncryptedPayload {
                        data: msg.payload.clone(),
                    };
                    encryption
                        .decrypt(&ep)
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
                    "message_id": msg.message_id,
                    "payload":  payload_json,
                });

                match Self::publish_envelope(
                    js.clone(),
                    &subject,
                    envelope,
                    Some(&msg.message_id),
                )
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

    async fn command_loop(
        js: Arc<jetstream::Context>,
        filter_subject: String,
        durable_name: String,
        agent_config: AgentConfig,
        config_path: String,
        collector_flags: CollectorFlags,
        _log_engine: LogEngine,
        identity: AgentIdentity,
    ) -> Result<()> {
        let log_engine = _log_engine;
        let stream = js
            .get_stream(CONTROL_STREAM)
            .await
            .with_context(|| format!("JetStream stream '{CONTROL_STREAM}' not found"))?;

        let consumer_config = PullConsumerConfig {
            durable_name: Some(durable_name.clone()),
            name: Some(durable_name.clone()),
            filter_subject: filter_subject.clone(),
            ack_policy: AckPolicy::Explicit,
            ..Default::default()
        };

        let consumer = stream
            .get_or_create_consumer(&durable_name, consumer_config)
            .await
            .map_err(|e| anyhow!("Failed to create command consumer: {e}"))?;

        let mut messages = consumer
            .messages()
            .await
            .map_err(|e| anyhow!("Failed to pull command messages: {e}"))?;

        while let Some(message) = messages.next().await {
            let message = message.map_err(|e| anyhow!("Command fetch failed: {e}"))?;
            let decoded = decode_frame(message.payload.as_ref())?;

            if let Ok(parsed) = serde_json::from_slice::<serde_json::Value>(&decoded) {
                if let Some(msg_type) = parsed.get("type").and_then(|t| t.as_str()) {
                    match msg_type {
                        "registered" => {
                            info!("Agent registration confirmed by server");
                        }
                        "heartbeat_ack" => {
                            debug!("Heartbeat acknowledged");
                        }
                        "config_update" => {
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
                        "process_kill" => {
                            if let Some(payload) = parsed.get("payload") {
                                if let Some(pid) = payload.get("pid").and_then(|p| p.as_i64()) {
                                    let req_id =
                                        payload.get("request_id").and_then(|r| r.as_i64());
                                    info!(
                                        "Received process_kill for pid {} (req {:?})",
                                        pid, req_id
                                    );
                                    let result = Self::kill_process(pid as i32, &log_engine).await;
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
                                            "Failed to send kill result for pid {}: {}", pid, e
                                        );
                                    }
                                }
                            }
                        }
                        other => {
                            debug!(
                                "Server command: {}",
                                other
                            );
                        }
                    }
                }
            }

            message
                .ack()
                .await
                .map_err(|e| anyhow!("Failed to ack command message: {e}"))?;
        }

        Ok(())
    }

    async fn apply_config_update(
        flags: &CollectorFlags,
        payload: &serde_json::Value,
        config: &AgentConfig,
        config_path: &str,
    ) {
        let updated = config.clone().apply_update(payload);
        if let Err(e) = ConfigValidator::validate(&updated) {
            warn!("Rejected config update: {e}");
            return;
        }

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

        if let Err(e) = updated.save(config_path).await {
            error!("Failed to persist config update to disk: {e}");
        } else {
            info!("Config persisted to {config_path}");
        }
    }

    async fn kill_process(pid: i32, log_engine: &LogEngine) -> Result<()> {
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

    async fn send_kill_result(
        config: &AgentConfig,
        identity: &AgentIdentity,
        pid: i32,
        request_id: Option<i64>,
        error: Option<&anyhow::Error>,
    ) -> Result<()> {
        let base = config.rest_base_url.trim_end_matches('/');
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

fn ingest_subject(prefix: &str, agent_id: &str, msg_type: &str) -> String {
    format!("{}.{}.{}", prefix, agent_id, msg_type)
}

fn command_filter_subject(prefix: &str, agent_id: &str) -> String {
    format!("{}.{}.>", prefix, agent_id)
}

fn command_durable_name(agent_id: &str) -> String {
    format!("agent-commands-{}", agent_id)
}

fn encode_frame(json_bytes: &[u8]) -> Result<Vec<u8>> {
    let compressed = zstd::stream::encode_all(Cursor::new(json_bytes), ZSTD_LEVEL)
        .map_err(|e| anyhow!("zstd compression failed: {e}"))?;
    let mut out = Vec::with_capacity(2 + compressed.len());
    out.push(FRAME_VERSION);
    out.push(ENCODING_ZSTD);
    out.extend_from_slice(&compressed);
    Ok(out)
}

fn decode_frame(frame: &[u8]) -> Result<Vec<u8>> {
    if frame.len() < 2 {
        return Err(anyhow!("Frame too short"));
    }
    let version = frame[0];
    if version != FRAME_VERSION {
        return Err(anyhow!("Unsupported frame version: {}", version));
    }
    let encoding = frame[1];
    let body = &frame[2..];
    match encoding {
        ENCODING_NONE => Ok(body.to_vec()),
        ENCODING_ZSTD => zstd::stream::decode_all(Cursor::new(body))
            .map_err(|e| anyhow!("zstd decompression failed: {e}")),
        other => Err(anyhow!("Unsupported frame encoding: {}", other)),
    }
}
