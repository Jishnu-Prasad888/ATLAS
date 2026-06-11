// collectors/enqueue_adapter.rs — Production MetricsEnqueuer (DIP bridge)
//
// Adapts the concrete `QueueEngine` + `StorageManager` pair into the
// `MetricsEnqueuer` trait that collectors depend on.
//
// This keeps collectors free of knowledge about storage internals.
// In tests, swap this with `MockEnqueuer` from `trait_collector::test_helpers`.

use anyhow::Result;
use async_trait::async_trait;

use crate::collectors::payload::TelemetryPayload;
use crate::collectors::trait_collector::MetricsEnqueuer;
use crate::engines::queue::QueueEngine;
use crate::storage::StorageManager;

pub struct EnqueueAdapter {
    queue:   QueueEngine,
    storage: StorageManager,
}

impl EnqueueAdapter {
    pub fn new(queue: QueueEngine, storage: StorageManager) -> Self {
        Self { queue, storage }
    }
}

#[async_trait]
impl MetricsEnqueuer for EnqueueAdapter {
    async fn enqueue(&self, payload: &TelemetryPayload) -> Result<()> {
        // Always persist locally first (offline-first guarantee)
        self.storage.store_metric(
            &payload.agent_id,
            &payload.metric_type,
            &serde_json::to_string(&payload.data).unwrap_or_default(),
        ).await?;

        // Then queue for transmission
        self.queue.enqueue(payload.to_json_bytes(), "metrics").await?;
        Ok(())
    }
}
