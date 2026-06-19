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
pub mod system_inventory;
pub mod trait_collector;

use anyhow::Result;
use std::sync::Arc;
use std::time::Duration;
use tokio::task::JoinHandle;
use tracing::{error, info};

use crate::config::{AgentConfig, CollectorFlags};
use crate::engines::identity::AgentIdentity;
use crate::engines::logging::LogEngine;
use crate::engines::queue::QueueEngine;
use crate::storage::StorageManager;

use enqueue_adapter::EnqueueAdapter;
use trait_collector::{Collector, MetricsEnqueuer};

// Re-export for external use
pub use payload::TelemetryPayload;

// ─── Registry ─────────────────────────────────────────────────────────────────

/// Build the list of active collectors based on configuration.
/// Returns `(name, boxed_collector)` pairs so callers can log names.
/// When `log_engine` is provided, collectors that support log emission
/// (docker, kubernetes) will emit state-change events.
/// `collector_flags` allows the server to dynamically toggle collectors
/// at runtime via WebSocket config_update messages.
pub fn build_collectors(
    config: &AgentConfig,
    identity: &AgentIdentity,
    log_engine: Option<&LogEngine>,
    collector_flags: CollectorFlags,
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

    register!(c.cpu, cpu::CpuCollector::new());
    register!(c.ram, ram::RamCollector::new());
    register!(c.storage, storage::StorageCollector::new());
    register!(c.network, network::NetworkCollector::new());
    register!(c.process, process::ProcessCollector::new(c.max_processes));
    register!(c.systemd, systemd::SystemdCollector::new());
    register!(c.system_inventory, system_inventory::SystemInventoryCollector::new(identity.clone()));

    if c.docker {
        let collector = match log_engine {
            Some(le) => {
                docker::DockerCollector::with_log_engine(le.clone(), collector_flags.clone())
            }
            None => docker::DockerCollector::new(collector_flags.clone()),
        };
        collectors.push(("docker", Box::new(collector) as Box<dyn Collector>));
    }

    if c.kubernetes {
        let collector = match log_engine {
            Some(le) => k3s::K3sCollector::with_log_engine(le.clone(), collector_flags.clone()),
            None => k3s::K3sCollector::new(collector_flags.clone()),
        };
        collectors.push(("k3s", Box::new(collector) as Box<dyn Collector>));
    }

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
    config: AgentConfig,
    identity: AgentIdentity,
    queue: QueueEngine,
    storage: StorageManager,
    log_engine: &LogEngine,
    collector_flags: CollectorFlags,
) -> Result<Vec<JoinHandle<()>>> {
    let interval = Duration::from_secs(config.interval_seconds);
    let agent_id = identity.agent_id.clone();
    let collectors = build_collectors(&config, &identity, Some(log_engine), collector_flags);
    let mut handles = Vec::with_capacity(collectors.len());

    for (name, collector) in collectors {
        info!(
            "Starting {} collector (interval={}s)",
            name, config.interval_seconds
        );
        let _ = log_engine
            .info("metrics_engine", &format!("{} collector started", name,))
            .await;

        // Each collector gets its own enqueuer — isolation between collectors
        let enqueuer: Arc<dyn MetricsEnqueuer> =
            Arc::new(EnqueueAdapter::new(queue.clone(), storage.clone()));
        let agent_id = agent_id.clone();
        let log = log_engine.clone();

        handles.push(tokio::spawn(async move {
            // Wrap the collector run with error logging
            loop {
                match collector.collect().await {
                    Ok(data) => {
                        let payload = TelemetryPayload::new(&agent_id, collector.name(), data);
                        if let Err(e) = enqueuer.enqueue(&payload).await {
                            let _ = log.error("metrics_engine", &format!(
                                "{} collector enqueue error: {}",
                                collector.name(), e,
                            )).await;
                            error!("{} collector enqueue error: {e}", collector.name());
                        }
                    }
                    Err(e) => {
                        let _ = log
                            .error(
                                "metrics_engine",
                                &format!("{} collector error: {}", collector.name(), e,),
                            )
                            .await;
                        error!("{} collector error: {e}", collector.name());
                    }
                }
                tokio::time::sleep(interval).await;
            }
        }));
    }

    info!("Started {} collectors", handles.len());
    Ok(handles)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{AgentConfig, CollectorConfig};
    use std::sync::Arc;
    use trait_collector::test_helpers::MockEnqueuer;

    fn test_identity() -> AgentIdentity {
        AgentIdentity {
            agent_id: "test-agent".into(),
            hostname: "localhost".into(),
            os: "linux".into(),
            arch: "x86_64".into(),
        }
    }

    fn all_on_config() -> AgentConfig {
        AgentConfig {
            collectors: CollectorConfig {
                cpu: true,
                ram: true,
                storage: true,
                network: true,
                process: true,
                systemd: true,
                system_inventory: true,
                docker: true,
                kubernetes: true,
                temperature: true,
                power: false,
                max_processes: 10,
            },
            ..AgentConfig::default()
        }
    }

    fn all_off_config() -> AgentConfig {
        AgentConfig {
            collectors: CollectorConfig {
                cpu: false,
                ram: false,
                storage: false,
                network: false,
                process: false,
                systemd: false,
                system_inventory: false,
                docker: false,
                kubernetes: false,
                temperature: false,
                power: false,
                max_processes: 10,
            },
            ..AgentConfig::default()
        }
    }

    fn test_flags() -> CollectorFlags {
        Arc::new(tokio::sync::RwLock::new(
            vec![("docker".into(), true), ("kubernetes".into(), true)]
                .into_iter()
                .collect(),
        ))
    }

    #[test]
    fn build_collectors_all_on_includes_kernel() {
        let identity = test_identity();
        let collectors = build_collectors(&all_on_config(), &identity, None, test_flags());
        let names: Vec<_> = collectors.iter().map(|(n, _)| *n).collect();
        // Kernel + all enabled collectors (cpu, ram, storage, network, process, systemd, docker, k3s)
        assert!(names.contains(&"kernel"), "kernel should always be present");
        assert!(names.contains(&"docker"));
        assert!(names.contains(&"k3s"));
    }

    #[test]
    fn build_collectors_all_off_still_has_kernel() {
        let identity = test_identity();
        let collectors = build_collectors(&all_off_config(), &identity, None, test_flags());
        let names: Vec<_> = collectors.iter().map(|(n, _)| *n).collect();
        // Only kernel should remain
        assert_eq!(names, vec!["kernel"]);
    }

    /// Verify that a Collector can be run against a MockEnqueuer —
    /// demonstrates the full test harness without touching I/O.
    #[tokio::test]
    async fn kernel_collector_produces_payload_with_mock_enqueuer() {
        let identity = test_identity();
        let collector = kernel::KernelCollector::new(identity);
        let enqueuer = MockEnqueuer::default();
        let duration = Duration::from_millis(1);

        // Drive one collection cycle
        let data = collector.collect().await.unwrap();
        let payload = TelemetryPayload::new("test-agent", collector.name(), data);
        enqueuer.enqueue(&payload).await.unwrap();

        let calls = enqueuer.drain();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].metric_type, "kernel");
    }
}
