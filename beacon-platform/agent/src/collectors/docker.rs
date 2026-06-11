// collectors/docker.rs — Docker Collector (SRP + Collector trait)

use anyhow::Result;
use async_trait::async_trait;
use serde_json::{json, Value};
use tracing::warn;

use super::trait_collector::Collector;

pub struct DockerCollector;

impl DockerCollector {
    pub fn new() -> Self { Self }
}

#[async_trait]
impl Collector for DockerCollector {
    fn name(&self) -> &'static str { "docker" }

    async fn collect(&self) -> Result<Value> {
        let containers = query_docker_containers().await.unwrap_or_default();
        Ok(aggregate_containers(containers))
    }
}

/// Pure aggregation — testable with any Vec<Value>.
pub fn aggregate_containers(containers: Vec<Value>) -> Value {
    let running = containers.iter()
        .filter(|c| c.get("State").and_then(|s| s.as_str()) == Some("running"))
        .count();
    json!({
        "total_containers":   containers.len(),
        "running_containers": running,
        "stopped_containers": containers.len() - running,
        "containers":         containers,
    })
}

async fn query_docker_containers() -> Result<Vec<Value>> {
    let output = tokio::process::Command::new("docker")
        .args(["ps", "-a", "--format", "{{json .}}"])
        .output()
        .await;

    match output {
        Ok(out) if out.status.success() => {
            let containers = String::from_utf8_lossy(&out.stdout)
                .lines()
                .filter_map(|l| serde_json::from_str(l).ok())
                .collect();
            Ok(containers)
        }
        Ok(_) => Ok(vec![]),
        Err(e) => { warn!("Docker unavailable: {e}"); Ok(vec![]) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_running_vs_stopped() {
        let containers = vec![
            json!({"State": "running", "Names": "web"}),
            json!({"State": "exited",  "Names": "db"}),
            json!({"State": "running", "Names": "proxy"}),
        ];
        let v = aggregate_containers(containers);
        assert_eq!(v["total_containers"].as_u64().unwrap(),   3);
        assert_eq!(v["running_containers"].as_u64().unwrap(), 2);
        assert_eq!(v["stopped_containers"].as_u64().unwrap(), 1);
    }

    #[test]
    fn empty_list_produces_zeros() {
        let v = aggregate_containers(vec![]);
        assert_eq!(v["total_containers"].as_u64().unwrap(), 0);
    }
}
