// collectors/mod.rs — Collector Registry
//
// To add a new collector:
//   1. Create `src/collectors/my_new.rs` implementing `Collector`.
//   2. Add `pub mod my_new;` below.
//   3. Push it into `build_collectors()` — nothing else changes.
//
// This is the only place modified when extending the system (OCP).

pub mod cpu;
pub mod docker;
pub mod enqueue_adapter;
pub mod k3s;
pub mod kernel;
pub mod network;
pub mod payload;
pub mod process;
pub mod ram;
pub mod storage;
pub mod systemd;
pub mod trait_collector;

use anyhow::Result;
use std::sync::Arc;
use std::time::Duration;
use tokio::task::JoinHandle;
use tracing::info;

use crate::config::AgentConfig;
use crate::engines::identity::AgentIdentity;
use crate::engines::queue::QueueEngine;
use crate::storage::StorageManager;

use enqueue_adapter::EnqueueAdapter;
use trait_collector::{Collector, MetricsEnqueuer};

// Re-export for external use
pub use payload::TelemetryPayload;

// ─── Registry ─────────────────────────────────────────────────────────────────

/// Build the list of active collectors based on configuration.
/// Returns `(name, boxed_collector)` pairs so callers can log names.
pub fn build_collectors(
    config:   &AgentConfig,
    identity: &AgentIdentity,
) -> Vec<(&'static str, Box<dyn Collector>)> {
    let c = &config.collectors;
    let mut collectors: Vec<(&'static str, Box<dyn Collector>)> = Vec::new();

    macro_rules! register {
        ($flag:expr, $collector:expr) => {
            if $flag {
                let c: Box<dyn Collector> = Box::new($collector);
                collectors.push((c.name(), c));
            }
        };
    }

    register!(c.cpu,        cpu::CpuCollector::new());
    register!(c.ram,        ram::RamCollector::new());
    register!(c.storage,    storage::StorageCollector::new());
    register!(c.network,    network::NetworkCollector::new());
    register!(c.process,    process::ProcessCollector::new(c.max_processes));
    register!(c.systemd,    systemd::SystemdCollector::new());
    register!(c.docker,     docker::DockerCollector::new());
    register!(c.kubernetes, k3s::K3sCollector::new());

    // Kernel collector is always active — lightweight and required for identity
    let kernel: Box<dyn Collector> = Box::new(kernel::KernelCollector::new(identity.clone()));
    collectors.push((kernel.name(), kernel));

    collectors
}

/// Spawn all active collectors as independent Tokio tasks.
///
/// Each collector gets its own `Arc<dyn MetricsEnqueuer>` so failure in one
/// collector's enqueue path cannot cascade to others.
pub async fn start_all(
    config:   AgentConfig,
    identity: AgentIdentity,
    queue:    QueueEngine,
    storage:  StorageManager,
) -> Result<Vec<JoinHandle<()>>> {
    let interval   = Duration::from_secs(config.interval_seconds);
    let agent_id   = identity.agent_id.clone();
    let collectors = build_collectors(&config, &identity);
    let mut handles = Vec::with_capacity(collectors.len());

    for (name, collector) in collectors {
        info!("Starting {} collector (interval={}s)", name, config.interval_seconds);

        // Each collector gets its own enqueuer — isolation between collectors
        let enqueuer: Arc<dyn MetricsEnqueuer> = Arc::new(
            EnqueueAdapter::new(queue.clone(), storage.clone())
        );
        let agent_id = agent_id.clone();

        handles.push(tokio::spawn(async move {
            collector.run(enqueuer.as_ref(), interval, &agent_id).await;
        }));
    }

    info!("Started {} collectors", handles.len());
    Ok(handles)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{CollectorConfig, AgentConfig};
    use trait_collector::test_helpers::MockEnqueuer;
    use std::sync::Arc;

    fn test_identity() -> AgentIdentity {
        AgentIdentity {
            agent_id: "test-agent".into(),
            hostname:  "localhost".into(),
            os:        "linux".into(),
            arch:      "x86_64".into(),
        }
    }

    fn all_on_config() -> AgentConfig {
        AgentConfig {
            collectors: CollectorConfig {
                cpu: true, ram: true, storage: true, network: true,
                process: true, systemd: true, docker: true, kubernetes: true,
                temperature: true, power: false, max_processes: 10,
            },
            ..AgentConfig::default()
        }
    }

    fn all_off_config() -> AgentConfig {
        AgentConfig {
            collectors: CollectorConfig {
                cpu: false, ram: false, storage: false, network: false,
                process: false, systemd: false, docker: false, kubernetes: false,
                temperature: false, power: false, max_processes: 10,
            },
            ..AgentConfig::default()
        }
    }

    #[test]
    fn build_collectors_all_on_includes_kernel() {
        let identity   = test_identity();
        let collectors = build_collectors(&all_on_config(), &identity);
        let names: Vec<_> = collectors.iter().map(|(n, _)| *n).collect();
        assert!(names.contains(&"kernel"), "kernel should always be present");
    }

    #[test]
    fn build_collectors_all_off_still_has_kernel() {
        let identity   = test_identity();
        let collectors = build_collectors(&all_off_config(), &identity);
        let names: Vec<_> = collectors.iter().map(|(n, _)| *n).collect();
        // Only kernel should remain
        assert_eq!(names, vec!["kernel"]);
    }

    /// Verify that a Collector can be run against a MockEnqueuer —
    /// demonstrates the full test harness without touching I/O.
    #[tokio::test]
    async fn kernel_collector_produces_payload_with_mock_enqueuer() {
        let identity  = test_identity();
        let collector = kernel::KernelCollector::new(identity);
        let enqueuer  = MockEnqueuer::default();
        let duration  = Duration::from_millis(1);

        // Drive one collection cycle
        let data = collector.collect().await.unwrap();
        let payload = TelemetryPayload::new("test-agent", collector.name(), data);
        enqueuer.enqueue(&payload).await.unwrap();

        let calls = enqueuer.drain();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].metric_type, "kernel");
    }
}
