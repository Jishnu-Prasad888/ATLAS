// transport/mod.rs — Secure WebSocket Transport
// TLS 1.3 WebSocket. Auto-reconnects with exponential backoff.
// Agent protocol: register → heartbeat loop + telemetry flush.

use anyhow::{Result, anyhow};
use base64::Engine as _;
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::time::sleep;
use tokio_tungstenite::{
    connect_async_tls_with_config,
    tungstenite::Message,
    Connector,
};
use tracing::{info, warn, error, debug};

use crate::config::AgentConfig;
use crate::engines::identity::AgentIdentity;
use crate::engines::queue::QueueEngine;
use crate::engines::encryption::EncryptionEngine;

const HEARTBEAT_INTERVAL:   Duration = Duration::from_secs(15);
const RECONNECT_BASE_DELAY: Duration = Duration::from_secs(1);
const RECONNECT_MAX_DELAY:  Duration = Duration::from_secs(60);
const FLUSH_BATCH_SIZE:     usize    = 50;

#[derive(Clone)]
pub struct WebSocketTransport {
    config:     AgentConfig,
    identity:   AgentIdentity,
    queue:      QueueEngine,
    encryption: EncryptionEngine,
}

impl WebSocketTransport {
    pub fn new(
        config:     AgentConfig,
        identity:   AgentIdentity,
        queue:      QueueEngine,
        encryption: EncryptionEngine,
    ) -> Self {
        Self { config, identity, queue, encryption }
    }

    /// Run forever — reconnects automatically with exponential backoff.
    pub async fn run(&self) -> Result<()> {
        let mut backoff = RECONNECT_BASE_DELAY;
        loop {
            info!("Connecting to {}", self.config.server_addr);
            match self.connect_and_run().await {
                Ok(()) => {
                    info!("Transport disconnected cleanly — reconnecting...");
                    backoff = RECONNECT_BASE_DELAY;
                }
                Err(e) => {
                    warn!("Transport error: {e}. Reconnecting in {:.1}s...", backoff.as_secs_f32());
                    sleep(backoff).await;
                    backoff = (backoff * 2).min(RECONNECT_MAX_DELAY);
                }
            }
        }
    }

    async fn connect_and_run(&self) -> Result<()> {
        // Login to get JWT token
        let token = crate::auth::login(
            &self.config.server_addr,
            &self.config.username,
            &self.config.password
        ).await?;
        
        // Parse URL and add token as query parameter
        let mut url = url::Url::parse(&self.config.server_addr)
            .map_err(|e| anyhow!("Invalid server URL: {e}"))?;
        url.query_pairs_mut().append_pair("token", &token);
        
        let connector = self.build_tls_connector()?;

        let (ws_stream, _) = connect_async_tls_with_config(url, None, false, Some(connector))
            .await
            .map_err(|e| anyhow!("WebSocket connect failed: {e}"))?;

        info!("WebSocket connected to {}", self.config.server_addr);
        let (mut writer, mut reader) = ws_stream.split();

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
            }
        });
        writer.send(Message::Text(register_msg.to_string())).await
            .map_err(|e| anyhow!("Registration send failed: {e}"))?;
        info!("Registration sent for agent {}", &self.identity.agent_id[..16.min(self.identity.agent_id.len())]);

        let queue    = self.queue.clone();
        let identity = self.identity.clone();
        let enc      = self.encryption.clone();

        // Wrap writer in Arc<Mutex> so heartbeat and flush loops can share it
        let writer = Arc::new(Mutex::new(writer));

        // Run all loops concurrently; abort all on first error
        tokio::select! {
            r = Self::heartbeat_loop(Arc::clone(&writer), identity.clone())        => r,
            r = Self::flush_loop(Arc::clone(&writer), queue, enc, identity.clone()) => r,
            r = Self::read_loop(&mut reader)                                        => r,
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
            writer.lock().await.send(Message::Text(hb.to_string())).await
                .map_err(|e| anyhow!("Heartbeat send failed: {e}"))?;
            debug!("Heartbeat sent");
        }
    }

    async fn flush_loop<S>(
        writer:   Arc<Mutex<S>>,
        queue:    QueueEngine,
        enc:      EncryptionEngine,
        identity: AgentIdentity,
    ) -> Result<()>
    where
        S: SinkExt<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin,
    {
        loop {
            let batch = queue.dequeue_batch(FLUSH_BATCH_SIZE).await?;
            if batch.is_empty() {
                sleep(Duration::from_millis(500)).await;
                continue;
            }

            for msg in &batch {
                // Decrypt locally-encrypted payload before transmitting
                let plaintext = if enc.is_enabled() {
                    let ep = crate::engines::encryption::EncryptedPayload { data: msg.payload.clone() };
                    enc.decrypt(&ep).await.unwrap_or_else(|_| msg.payload.clone())
                } else {
                    msg.payload.clone()
                };

                let payload_json: serde_json::Value = serde_json::from_slice(&plaintext)
                    .unwrap_or_else(|_| json!({
                        "raw": base64::engine::general_purpose::STANDARD.encode(&plaintext)
                    }));

                let envelope = json!({
                    "type":     msg.msg_type,
                    "agent_id": identity.agent_id,
                    "payload":  payload_json,
                });

                match writer.lock().await.send(Message::Text(envelope.to_string())).await {
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

    async fn read_loop<S>(reader: &mut S) -> Result<()>
    where
        S: StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
    {
        while let Some(msg) = reader.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                        match parsed.get("type").and_then(|t| t.as_str()) {
                            Some("registered")    => info!("Agent registration confirmed by server"),
                            Some("heartbeat_ack") => debug!("Heartbeat acknowledged"),
                            Some("config_update") => info!("Received config update from server"),
                            _                     => debug!("Server message: {}", &text[..text.len().min(120)]),
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

    fn build_tls_connector(&self) -> Result<Connector> {
        use rustls::{ClientConfig, RootCertStore};
        use std::sync::Arc;

        let mut root_store = RootCertStore::empty();

        if self.config.tls.verify_cert {
            let native_certs = rustls_native_certs::load_native_certs()
                .map_err(|e| anyhow!("Failed to load native certs: {e}"))?;
            for cert in native_certs {
                root_store.add(cert).map_err(|e| anyhow!("Invalid cert: {e}"))?;
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
}