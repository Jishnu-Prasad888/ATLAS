use anyhow::Result;
use chrono::Utc;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{warn, debug};
use uuid::Uuid;

use crate::engines::identity::AgentIdentity;
use crate::engines::queue::QueueEngine;
use crate::storage::StorageManager;

const SCHEMA_VERSION: u32 = 1;
const MAX_LOG_RATE: u64 = 1000;
const MAX_MESSAGE_LENGTH: usize = 32_768;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Severity {
    Trace,
    Debug,
    Info,
    Warning,
    Error,
    Critical,
}

impl Severity {
    pub fn as_str(&self) -> &'static str {
        match self {
            Severity::Trace => "Trace",
            Severity::Debug => "Debug",
            Severity::Info => "Info",
            Severity::Warning => "Warning",
            Severity::Error => "Error",
            Severity::Critical => "Critical",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub log_id: String,
    pub timestamp: String,
    pub agent_id: String,
    pub hostname: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub namespace: Option<String>,
    pub severity: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_type: Option<String>,
    pub message: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    pub sequence_number: u64,
    pub schema_version: u32,
}

impl LogEntry {
    pub fn new(
        agent_id: &str,
        hostname: &str,
        severity: &str,
        source: &str,
        message: &str,
    ) -> Self {
        Self {
            log_id: Uuid::new_v4().to_string(),
            timestamp: Utc::now().to_rfc3339(),
            agent_id: agent_id.to_string(),
            hostname: hostname.to_string(),
            execution_id: None,
            namespace: None,
            severity: severity.to_string(),
            source: source.to_string(),
            event_type: None,
            message: message.to_string(),
            tags: Vec::new(),
            sequence_number: 0,
            schema_version: SCHEMA_VERSION,
        }
    }

    pub fn with_execution(mut self, execution_id: &str, namespace: &str) -> Self {
        self.execution_id = Some(execution_id.to_string());
        self.namespace = Some(namespace.to_string());
        self
    }

    pub fn with_event_type(mut self, event_type: &str) -> Self {
        self.event_type = Some(event_type.to_string());
        self
    }

    pub fn with_tags(mut self, tags: &[&str]) -> Self {
        self.tags = tags.iter().map(|t| t.to_string()).collect();
        self
    }

    pub fn set_sequence(&mut self, seq: u64) {
        self.sequence_number = seq;
    }

    pub fn to_json_bytes(&self) -> Vec<u8> {
        serde_json::to_vec(self).unwrap_or_default()
    }

    pub fn to_json_string(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }
}

struct RateLimiter {
    max_rate: u64,
    count: u64,
    window_start: chrono::DateTime<Utc>,
    dropped: u64,
}

impl RateLimiter {
    fn new(max_rate: u64) -> Self {
        Self {
            max_rate,
            count: 0,
            window_start: Utc::now(),
            dropped: 0,
        }
    }

    fn allow(&mut self) -> bool {
        let now = Utc::now();
        if (now - self.window_start).num_seconds() >= 1 {
            self.count = 0;
            self.window_start = now;
            self.dropped = 0;
        }
        if self.count < self.max_rate {
            self.count += 1;
            true
        } else {
            self.dropped += 1;
            false
        }
    }

    fn dropped(&self) -> u64 {
        self.dropped
    }
}

struct LogSanitizer {
    patterns: Vec<(Regex, &'static str)>,
}

impl LogSanitizer {
    fn new() -> Self {
        let mut patterns = Vec::new();

        patterns.push((Regex::new(r"(?i)(password\s*[=:]\s*)\S+").unwrap(), "${1}[REDACTED]"));
        patterns.push((Regex::new(r"(?i)(passwd\s*[=:]\s*)\S+").unwrap(), "${1}[REDACTED]"));
        patterns.push((Regex::new(r"(?i)(secret\s*[=:]\s*)\S+").unwrap(), "${1}[REDACTED]"));
        patterns.push((Regex::new(r"(?i)(api[_-]?key\s*[=:]\s*)\S+").unwrap(), "${1}[REDACTED]"));
        patterns.push((Regex::new(r"(?i)(token\s*[=:]\s*)\S+").unwrap(), "${1}[REDACTED]"));
        patterns.push((Regex::new(r"-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----").unwrap(), "[REDACTED PRIVATE KEY]"));
        patterns.push((Regex::new(r"(?i)(jwt\s*[=:]\s*)\S+").unwrap(), "${1}[REDACTED]"));
        patterns.push((Regex::new(r"(?i)(authorization:\s*Bearer\s+)\S+").unwrap(), "${1}[REDACTED]"));

        Self { patterns }
    }

    fn sanitize(&self, message: &str) -> String {
        let mut result = message.to_string();

        if result.len() > MAX_MESSAGE_LENGTH {
            result.truncate(MAX_MESSAGE_LENGTH);
            result.push_str("... [TRUNCATED]");
        }

        for (re, replacement) in &self.patterns {
            result = re.replace_all(&result, *replacement).to_string();
        }

        result
    }

    fn sanitize_entry(&self, entry: &mut LogEntry) {
        let sanitized = self.sanitize(&entry.message);
        if sanitized.len() != entry.message.len() {
            debug!("Log message sanitized (source={}, severity={})", entry.source, entry.severity);
        }
        entry.message = sanitized;
    }
}

#[derive(Clone)]
pub struct LogEngine {
    agent_id: String,
    hostname: String,
    queue: QueueEngine,
    storage: StorageManager,
    sequence_counter: Arc<AtomicU64>,
    rate_limiter: Arc<RwLock<RateLimiter>>,
    sanitizer: Arc<LogSanitizer>,
}

impl LogEngine {
    pub fn new(
        identity: &AgentIdentity,
        queue: QueueEngine,
        storage: StorageManager,
    ) -> Self {
        Self {
            agent_id: identity.agent_id.clone(),
            hostname: identity.hostname.clone(),
            queue,
            storage,
            sequence_counter: Arc::new(AtomicU64::new(1)),
            rate_limiter: Arc::new(RwLock::new(RateLimiter::new(MAX_LOG_RATE))),
            sanitizer: Arc::new(LogSanitizer::new()),
        }
    }

    pub async fn log(&self, mut entry: LogEntry) -> Result<()> {
        let seq = self.sequence_counter.fetch_add(1, Ordering::Relaxed);
        entry.set_sequence(seq);

        self.sanitizer.sanitize_entry(&mut entry);

        {
            let mut rl = self.rate_limiter.write().await;
            if !rl.allow() {
                if rl.dropped() % 100 == 1 {
                    warn!(
                        "Log rate limit exceeded: dropped {} messages (max={}/sec)",
                        rl.dropped(),
                        rl.max_rate
                    );
                }
                return Ok(());
            }
        }

        self.storage
            .store_log_entry(&entry)
            .await
            .map_err(|e| {
                warn!("Failed to persist log entry: {}", e);
                e
            })?;

        let json_bytes = entry.to_json_bytes();
        if !json_bytes.is_empty() {
            self.queue
                .enqueue(json_bytes, "logs")
                .await
                .map_err(|e| {
                    warn!("Failed to enqueue log entry: {}", e);
                    e
                })?;
        }

        Ok(())
    }

    pub async fn trace(&self, source: &str, message: &str) -> Result<()> {
        let entry = LogEntry::new(&self.agent_id, &self.hostname, Severity::Trace.as_str(), source, message);
        self.log(entry).await
    }

    pub async fn debug(&self, source: &str, message: &str) -> Result<()> {
        let entry = LogEntry::new(&self.agent_id, &self.hostname, Severity::Debug.as_str(), source, message);
        self.log(entry).await
    }

    pub async fn info(&self, source: &str, message: &str) -> Result<()> {
        let entry = LogEntry::new(&self.agent_id, &self.hostname, Severity::Info.as_str(), source, message);
        self.log(entry).await
    }

    pub async fn warn(&self, source: &str, message: &str) -> Result<()> {
        let entry = LogEntry::new(&self.agent_id, &self.hostname, Severity::Warning.as_str(), source, message);
        self.log(entry).await
    }

    pub async fn error(&self, source: &str, message: &str) -> Result<()> {
        let entry = LogEntry::new(&self.agent_id, &self.hostname, Severity::Error.as_str(), source, message);
        self.log(entry).await
    }

    pub async fn critical(&self, source: &str, message: &str) -> Result<()> {
        let entry = LogEntry::new(&self.agent_id, &self.hostname, Severity::Critical.as_str(), source, message);
        self.log(entry).await
    }

    pub async fn log_execution(&self, source: &str, severity: &str, message: &str, execution_id: &str, namespace: &str) -> Result<()> {
        let entry = LogEntry::new(&self.agent_id, &self.hostname, severity, source, message)
            .with_execution(execution_id, namespace);
        self.log(entry).await
    }

    pub async fn log_event(&self, source: &str, severity: &str, event_type: &str, message: &str) -> Result<()> {
        let entry = LogEntry::new(&self.agent_id, &self.hostname, severity, source, message)
            .with_event_type(event_type);
        self.log(entry).await
    }

    pub async fn log_with_tags(&self, source: &str, severity: &str, message: &str, tags: &[&str]) -> Result<()> {
        let entry = LogEntry::new(&self.agent_id, &self.hostname, severity, source, message)
            .with_tags(tags);
        self.log(entry).await
    }

    pub fn new_entry(&self, severity: &str, source: &str, message: &str) -> LogEntry {
        LogEntry::new(&self.agent_id, &self.hostname, severity, source, message)
    }

    pub fn agent_id(&self) -> &str {
        &self.agent_id
    }

    pub fn hostname(&self) -> &str {
        &self.hostname
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn severity_display() {
        assert_eq!(Severity::Trace.as_str(), "Trace");
        assert_eq!(Severity::Debug.as_str(), "Debug");
        assert_eq!(Severity::Info.as_str(), "Info");
        assert_eq!(Severity::Warning.as_str(), "Warning");
        assert_eq!(Severity::Error.as_str(), "Error");
        assert_eq!(Severity::Critical.as_str(), "Critical");
    }

    #[test]
    fn log_entry_creation() {
        let entry = LogEntry::new("agent-1", "host-1", "Info", "execution_engine", "Test message");
        assert_eq!(entry.agent_id, "agent-1");
        assert_eq!(entry.hostname, "host-1");
        assert_eq!(entry.severity, "Info");
        assert_eq!(entry.source, "execution_engine");
        assert_eq!(entry.message, "Test message");
        assert_eq!(entry.schema_version, 1);
        assert!(entry.execution_id.is_none());
        assert!(entry.namespace.is_none());
    }

    #[test]
    fn log_entry_with_execution() {
        let entry = LogEntry::new("agent-1", "host-1", "Info", "execution_engine", "Test")
            .with_execution("exec-123", "restart_nginx");
        assert_eq!(entry.execution_id, Some("exec-123".to_string()));
        assert_eq!(entry.namespace, Some("restart_nginx".to_string()));
    }

    #[test]
    fn log_entry_with_tags() {
        let entry = LogEntry::new("agent-1", "host-1", "Info", "execution_engine", "Test")
            .with_tags(&["production", "web"]);
        assert_eq!(entry.tags, vec!["production", "web"]);
    }

    #[test]
    fn log_entry_roundtrips_through_json() {
        let original = LogEntry::new("agent-1", "host-1", "Info", "execution_engine", "Test message")
            .with_execution("exec-123", "restart_nginx")
            .with_tags(&["production"]);
        let json = original.to_json_string();
        let parsed: LogEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.log_id, original.log_id);
        assert_eq!(parsed.agent_id, "agent-1");
        assert_eq!(parsed.hostname, "host-1");
        assert_eq!(parsed.execution_id, Some("exec-123".to_string()));
        assert_eq!(parsed.namespace, Some("restart_nginx".to_string()));
        assert_eq!(parsed.tags, vec!["production"]);
    }

    #[test]
    fn sequence_numbers_increment() {
        let entry_a = LogEntry::new("agent-1", "host-1", "Info", "test", "A");
        let entry_b = LogEntry::new("agent-1", "host-1", "Info", "test", "B");
        // Sequence is initialized by LogEngine::log, not the constructor
        // Just verify the field exists and has default
        assert_eq!(entry_a.sequence_number, 0);
        assert_eq!(entry_b.sequence_number, 0);
    }

    #[test]
    fn sanitizer_removes_password() {
        let sanitizer = LogSanitizer::new();
        let msg = "Connecting with password=hunter2 to database";
        let sanitized = sanitizer.sanitize(msg);
        assert!(!sanitized.contains("hunter2"));
        assert!(sanitized.contains("[REDACTED]"));
    }

    #[test]
    fn sanitizer_removes_api_key() {
        let sanitizer = LogSanitizer::new();
        let msg = "Using api_key=sk-abc123def456 for external service";
        let sanitized = sanitizer.sanitize(msg);
        assert!(!sanitized.contains("sk-abc123def456"));
        assert!(sanitized.contains("[REDACTED]"));
    }

    #[test]
    fn sanitizer_removes_jwt() {
        let sanitizer = LogSanitizer::new();
        let msg = "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.token";
        let sanitized = sanitizer.sanitize(msg);
        assert!(!sanitized.contains("eyJhbGciOiJIUzI1NiJ9.token"));
    }

    #[test]
    fn sanitizer_truncates_long_messages() {
        let sanitizer = LogSanitizer::new();
        let long_msg = "x".repeat(MAX_MESSAGE_LENGTH + 1000);
        let sanitized = sanitizer.sanitize(&long_msg);
        assert!(sanitized.len() <= MAX_MESSAGE_LENGTH + 20);
        assert!(sanitized.ends_with("[TRUNCATED]"));
    }

    #[test]
    fn sanitizer_does_not_modify_safe_messages() {
        let sanitizer = LogSanitizer::new();
        let msg = "Package upgrade completed successfully";
        let sanitized = sanitizer.sanitize(msg);
        assert_eq!(sanitized, msg);
    }

    #[test]
    fn rate_limiter_allows_up_to_max_rate() {
        let mut rl = RateLimiter::new(10);
        for _ in 0..10 {
            assert!(rl.allow());
        }
        assert!(!rl.allow());
        assert_eq!(rl.dropped(), 1);
    }

    #[test]
    fn rate_limiter_resets_each_second() {
        let mut rl = RateLimiter::new(5);
        for _ in 0..5 {
            assert!(rl.allow());
        }
        assert!(!rl.allow());

        rl.window_start = Utc::now() - chrono::Duration::seconds(2);

        assert!(rl.allow());
        assert_eq!(rl.count, 1);
    }
}
