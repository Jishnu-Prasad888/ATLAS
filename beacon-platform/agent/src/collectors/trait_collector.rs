// collectors/trait_collector.rs — Collector Abstraction (OCP + LSP + DIP)
//
// All collectors implement this single trait. Adding a new collector (e.g. k3s)
// requires ONLY a new file that implements `Collector` — no modification to
// existing code (Open/Closed Principle).
//
// The trait depends on `MetricsEnqueuer`, not concrete `QueueEngine` +
// `StorageManager` (Dependency Inversion Principle).
//
// For testing, substitute any `MockEnqueuer` that implements `MetricsEnqueuer`
// without touching the filesystem or network.

use anyhow::Result;
use async_trait::async_trait;
use serde_json::Value;
use std::time::Duration;

use crate::collectors::payload::TelemetryPayload;

// ─── Dependency inversion boundary ───────────────────────────────────────────

/// Everything a collector needs to persist its output.
/// Implemented by the real `EnqueueAdapter` and by `MockEnqueuer` in tests.
#[async_trait]
pub trait MetricsEnqueuer: Send + Sync {
    async fn enqueue(&self, payload: &TelemetryPayload) -> Result<()>;
}

// ─── Core collector trait ─────────────────────────────────────────────────────

/// A single-responsibility metric source.
///
/// Implement `collect()` — a pure, synchronous (or lightweight async) function
/// that reads data and returns a `Value`.  The `run()` default wraps it in the
/// standard timer loop, isolating scheduling from collection logic.
///
/// Rationale for separating `collect` from `run`:
///   * `collect` is unit-testable without a Tokio runtime.
///   * `run` is integration-tested by asserting calls to a mock enqueuer.
#[async_trait]
pub trait Collector: Send + Sync {
    /// Human-readable name used in logs and health reports.
    fn name(&self) -> &'static str;

    /// Collect one snapshot of metrics. Must not block for longer than ~1s.
    async fn collect(&self) -> Result<Value>;

    /// Run forever, calling `collect()` every `interval` and forwarding to `enqueuer`.
    /// Override only when you need custom loop behaviour (e.g. Docker needs
    /// a daemon check before each collection).
    async fn run(&self, enqueuer: &dyn MetricsEnqueuer, interval: Duration, agent_id: &str) {
        use tracing::error;
        loop {
            match self.collect().await {
                Ok(data) => {
                    let payload = TelemetryPayload::new(agent_id, self.name(), data);
                    if let Err(e) = enqueuer.enqueue(&payload).await {
                        error!("{} collector enqueue error: {e}", self.name());
                    }
                }
                Err(e) => error!("{} collector error: {e}", self.name()),
            }
            tokio::time::sleep(interval).await;
        }
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
pub mod test_helpers {
    use super::*;
    use std::sync::{Arc, Mutex};

    /// Records every payload enqueued during a test.
    #[derive(Clone, Default)]
    pub struct MockEnqueuer {
        pub calls: Arc<Mutex<Vec<TelemetryPayload>>>,
    }

    #[async_trait]
    impl MetricsEnqueuer for MockEnqueuer {
        async fn enqueue(&self, payload: &TelemetryPayload) -> Result<()> {
            self.calls.lock().unwrap().push(payload.clone());
            Ok(())
        }
    }

    impl MockEnqueuer {
        pub fn drain(&self) -> Vec<TelemetryPayload> {
            self.calls.lock().unwrap().drain(..).collect()
        }
    }

    /// Always fails — lets you test that errors are swallowed by `run()`.
    pub struct FailingEnqueuer;

    #[async_trait]
    impl MetricsEnqueuer for FailingEnqueuer {
        async fn enqueue(&self, _payload: &TelemetryPayload) -> Result<()> {
            Err(anyhow::anyhow!("injected failure"))
        }
    }
}
