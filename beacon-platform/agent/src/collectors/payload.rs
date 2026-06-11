// collectors/payload.rs — Telemetry Payload (Single Responsibility)
//
// Owns the wire format for every metric emitted by the agent.
// Kept separate from collection logic so serialisation changes never
// require touching individual collector files.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};

static SEQ: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TelemetryPayload {
    pub agent_id:        String,
    pub metric_type:     String,
    pub timestamp:       String,
    pub data:            serde_json::Value,
    pub schema_version:  String,
    pub sequence_number: u64,
}

impl TelemetryPayload {
    pub fn new(agent_id: &str, metric_type: &str, data: serde_json::Value) -> Self {
        Self {
            agent_id:        agent_id.to_string(),
            metric_type:     metric_type.to_string(),
            timestamp:       chrono::Utc::now().to_rfc3339(),
            data,
            schema_version:  "1.0".to_string(),
            sequence_number: SEQ.fetch_add(1, Ordering::Relaxed),
        }
    }

    pub fn to_json_bytes(&self) -> Vec<u8> {
        serde_json::to_vec(self).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sequence_numbers_are_monotonically_increasing() {
        let a = TelemetryPayload::new("agent-1", "cpu", json!({}));
        let b = TelemetryPayload::new("agent-1", "ram", json!({}));
        assert!(b.sequence_number > a.sequence_number);
    }

    #[test]
    fn roundtrips_through_json() {
        let original = TelemetryPayload::new("agent-1", "cpu", json!({"usage": 42.5}));
        let bytes  = original.to_json_bytes();
        let parsed: TelemetryPayload = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(parsed.metric_type, "cpu");
        assert_eq!(parsed.agent_id,    "agent-1");
    }
}
