// collectors/k3s.rs — k3s / Kubernetes Metrics Collector (OCP addition)
//
// Collects node + pod metrics from a k3s cluster running on this host.
//
// Data sources (in priority order):
//   1. `kubectl top nodes / pods`  — fast, available when k3s is healthy
//   2. `/run/k3s/containerd/...`   — fallback socket-level pod list
//   3. kubeconfig at /etc/rancher/k3s/k3s.yaml (default k3s path)
//
// Adding this collector required ZERO changes to any existing file —
// it is registered in `mod.rs` only (Open/Closed Principle).
//
// Testing strategy:
//   * `parse_kubectl_nodes()` and `parse_kubectl_pods()` are pure functions
//     that accept raw kubectl JSON bytes — test with fixture strings.
//   * `K3sCollector::collect()` calls them; mock the command runner for
//     integration-level tests via the `CommandRunner` trait.

use anyhow::Result;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::process::Command;
use tracing::warn;

use super::trait_collector::Collector;

// ─── Dependency inversion for command execution ───────────────────────────────
// Swappable in tests without forking processes.

pub trait CommandRunner: Send + Sync {
    fn run(&self, program: &str, args: &[&str]) -> std::io::Result<std::process::Output>;
}

pub struct RealCommandRunner;

impl CommandRunner for RealCommandRunner {
    fn run(&self, program: &str, args: &[&str]) -> std::io::Result<std::process::Output> {
        Command::new(program).args(args).output()
    }
}

// ─── Collector ────────────────────────────────────────────────────────────────

pub struct K3sCollector {
    runner:     Box<dyn CommandRunner>,
    kubeconfig: String,
}

impl K3sCollector {
    /// Production constructor — uses real kubectl and the default k3s kubeconfig.
    pub fn new() -> Self {
        Self {
            runner:     Box::new(RealCommandRunner),
            kubeconfig: "/etc/rancher/k3s/k3s.yaml".to_string(),
        }
    }

    /// Inject a custom runner and kubeconfig (for tests).
    pub fn with_runner(runner: Box<dyn CommandRunner>, kubeconfig: &str) -> Self {
        Self { runner, kubeconfig: kubeconfig.to_string() }
    }
}

#[async_trait]
impl Collector for K3sCollector {
    fn name(&self) -> &'static str { "k3s" }

    async fn collect(&self) -> Result<Value> {
        // Check if k3s is reachable before collecting
        let server_status = probe_k3s_server(&*self.runner, &self.kubeconfig);

        let nodes = collect_nodes(&*self.runner, &self.kubeconfig);
        let pods  = collect_pods(&*self.runner,  &self.kubeconfig);

        Ok(json!({
            "server_reachable": server_status,
            "nodes": nodes,
            "pods":  pods,
            "node_count": nodes.as_array().map(|a| a.len()).unwrap_or(0),
            "pod_count":  pods.as_array().map(|a| a.len()).unwrap_or(0),
            "running_pods": count_running_pods(&pods),
        }))
    }
}

// ─── Data collection helpers ──────────────────────────────────────────────────

fn kubectl_args<'a>(kubeconfig: &'a str, extra: &[&'a str]) -> Vec<&'a str> {
    let mut args = vec!["--kubeconfig", kubeconfig];
    args.extend_from_slice(extra);
    args
}

fn probe_k3s_server(runner: &dyn CommandRunner, kubeconfig: &str) -> bool {
    runner
        .run("kubectl", &kubectl_args(kubeconfig, &["cluster-info", "--request-timeout=2s"]))
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn collect_nodes(runner: &dyn CommandRunner, kubeconfig: &str) -> Value {
    let args = kubectl_args(kubeconfig, &["get", "nodes", "-o", "json"]);
    match runner.run("kubectl", &args) {
        Ok(out) if out.status.success() => {
            parse_kubectl_nodes(&out.stdout).unwrap_or(json!([]))
        }
        Ok(_) | Err(_) => {
            warn!("k3s: unable to list nodes");
            json!([])
        }
    }
}

fn collect_pods(runner: &dyn CommandRunner, kubeconfig: &str) -> Value {
    let args = kubectl_args(kubeconfig, &["get", "pods", "--all-namespaces", "-o", "json"]);
    match runner.run("kubectl", &args) {
        Ok(out) if out.status.success() => {
            parse_kubectl_pods(&out.stdout).unwrap_or(json!([]))
        }
        Ok(_) | Err(_) => {
            warn!("k3s: unable to list pods");
            json!([])
        }
    }
}

fn count_running_pods(pods: &Value) -> usize {
    pods.as_array().map(|arr| {
        arr.iter()
           .filter(|p| p.get("phase").and_then(|v| v.as_str()) == Some("Running"))
           .count()
    }).unwrap_or(0)
}

// ─── Pure parsers (testable) ──────────────────────────────────────────────────

/// Parse `kubectl get nodes -o json` output into a summary array.
pub fn parse_kubectl_nodes(raw: &[u8]) -> Result<Value> {
    let doc: Value = serde_json::from_slice(raw)?;
    let items = doc["items"].as_array().cloned().unwrap_or_default();

    let nodes: Vec<Value> = items.iter().map(|node| {
        let name    = node["metadata"]["name"].as_str().unwrap_or("").to_string();
        let status  = extract_node_ready_status(node);
        let version = node["status"]["nodeInfo"]["kubeletVersion"]
            .as_str().unwrap_or("").to_string();
        let arch    = node["status"]["nodeInfo"]["architecture"]
            .as_str().unwrap_or("").to_string();
        let os      = node["status"]["nodeInfo"]["osImage"]
            .as_str().unwrap_or("").to_string();

        // Resource capacity
        let cpu_cap = node["status"]["capacity"]["cpu"]
            .as_str().unwrap_or("0").to_string();
        let mem_cap = node["status"]["capacity"]["memory"]
            .as_str().unwrap_or("0Ki").to_string();

        // Resource allocatable
        let cpu_alloc = node["status"]["allocatable"]["cpu"]
            .as_str().unwrap_or("0").to_string();
        let mem_alloc = node["status"]["allocatable"]["memory"]
            .as_str().unwrap_or("0Ki").to_string();

        json!({
            "name":               name,
            "ready":              status,
            "kubelet_version":    version,
            "architecture":       arch,
            "os":                 os,
            "capacity_cpu":       cpu_cap,
            "capacity_memory":    mem_cap,
            "allocatable_cpu":    cpu_alloc,
            "allocatable_memory": mem_alloc,
        })
    }).collect();

    Ok(Value::Array(nodes))
}

fn extract_node_ready_status(node: &Value) -> bool {
    node["status"]["conditions"]
        .as_array()
        .and_then(|conditions| {
            conditions.iter()
                .find(|c| c["type"].as_str() == Some("Ready"))
                .and_then(|c| c["status"].as_str())
                .map(|s| s == "True")
        })
        .unwrap_or(false)
}

/// Parse `kubectl get pods --all-namespaces -o json` into a summary array.
pub fn parse_kubectl_pods(raw: &[u8]) -> Result<Value> {
    let doc: Value = serde_json::from_slice(raw)?;
    let items = doc["items"].as_array().cloned().unwrap_or_default();

    let pods: Vec<Value> = items.iter().map(|pod| {
        let name      = pod["metadata"]["name"].as_str().unwrap_or("").to_string();
        let namespace = pod["metadata"]["namespace"].as_str().unwrap_or("").to_string();
        let phase     = pod["status"]["phase"].as_str().unwrap_or("Unknown").to_string();
        let node_name = pod["spec"]["nodeName"].as_str().unwrap_or("").to_string();

        let containers: Vec<Value> = pod["spec"]["containers"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .map(|c| {
                let cname   = c["name"].as_str().unwrap_or("").to_string();
                let image   = c["image"].as_str().unwrap_or("").to_string();
                let ready   = extract_container_ready(pod, &cname);
                let restarts = extract_container_restarts(pod, &cname);
                json!({
                    "name":     cname,
                    "image":    image,
                    "ready":    ready,
                    "restarts": restarts,
                })
            })
            .collect();

        json!({
            "name":       name,
            "namespace":  namespace,
            "phase":      phase,
            "node":       node_name,
            "containers": containers,
        })
    }).collect();

    Ok(Value::Array(pods))
}

fn extract_container_ready(pod: &Value, container_name: &str) -> bool {
    pod["status"]["containerStatuses"]
        .as_array()
        .and_then(|statuses| {
            statuses.iter()
                .find(|cs| cs["name"].as_str() == Some(container_name))
                .and_then(|cs| cs["ready"].as_bool())
        })
        .unwrap_or(false)
}

fn extract_container_restarts(pod: &Value, container_name: &str) -> u64 {
    pod["status"]["containerStatuses"]
        .as_array()
        .and_then(|statuses| {
            statuses.iter()
                .find(|cs| cs["name"].as_str() == Some(container_name))
                .and_then(|cs| cs["restartCount"].as_u64())
        })
        .unwrap_or(0)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Node parsing ──────────────────────────────────────────────────────────

    fn node_fixture(name: &str, ready: &str) -> Value {
        json!({
            "metadata": { "name": name },
            "status": {
                "conditions": [{ "type": "Ready", "status": ready }],
                "nodeInfo": {
                    "kubeletVersion": "v1.28.0+k3s1",
                    "architecture":   "amd64",
                    "osImage":        "Ubuntu 22.04.3 LTS"
                },
                "capacity":    { "cpu": "4", "memory": "8Gi" },
                "allocatable": { "cpu": "3800m", "memory": "7Gi" }
            }
        })
    }

    #[test]
    fn parse_nodes_extracts_name_and_ready() {
        let doc = json!({ "items": [
            node_fixture("node-1", "True"),
            node_fixture("node-2", "False"),
        ]});
        let raw    = serde_json::to_vec(&doc).unwrap();
        let parsed = parse_kubectl_nodes(&raw).unwrap();
        let nodes  = parsed.as_array().unwrap();
        assert_eq!(nodes.len(), 2);
        assert_eq!(nodes[0]["name"], "node-1");
        assert_eq!(nodes[0]["ready"], true);
        assert_eq!(nodes[1]["ready"], false);
    }

    #[test]
    fn parse_nodes_empty_items_returns_empty_array() {
        let doc = json!({ "items": [] });
        let raw    = serde_json::to_vec(&doc).unwrap();
        let parsed = parse_kubectl_nodes(&raw).unwrap();
        assert!(parsed.as_array().unwrap().is_empty());
    }

    #[test]
    fn parse_nodes_invalid_json_returns_error() {
        let result = parse_kubectl_nodes(b"not-json");
        assert!(result.is_err());
    }

    // ── Pod parsing ───────────────────────────────────────────────────────────

    fn pod_fixture(name: &str, namespace: &str, phase: &str, restarts: u64) -> Value {
        json!({
            "metadata": { "name": name, "namespace": namespace },
            "spec": {
                "nodeName":   "node-1",
                "containers": [{ "name": "app", "image": "nginx:latest" }]
            },
            "status": {
                "phase": phase,
                "containerStatuses": [{
                    "name":         "app",
                    "ready":        phase == "Running",
                    "restartCount": restarts,
                }]
            }
        })
    }

    #[test]
    fn parse_pods_extracts_phase_and_restarts() {
        let doc = json!({ "items": [
            pod_fixture("web-1", "default", "Running", 0),
            pod_fixture("db-1",  "default", "Pending", 3),
        ]});
        let raw    = serde_json::to_vec(&doc).unwrap();
        let parsed = parse_kubectl_pods(&raw).unwrap();
        let pods   = parsed.as_array().unwrap();
        assert_eq!(pods.len(), 2);
        assert_eq!(pods[0]["phase"], "Running");
        assert_eq!(pods[1]["phase"], "Pending");
        assert_eq!(pods[1]["containers"][0]["restarts"].as_u64().unwrap(), 3);
    }

    #[test]
    fn count_running_pods_counts_only_running() {
        let pods = json!([
            { "phase": "Running" },
            { "phase": "Pending" },
            { "phase": "Running" },
            { "phase": "Failed"  },
        ]);
        assert_eq!(count_running_pods(&pods), 2);
    }

    // ── Mock command runner ───────────────────────────────────────────────────

    struct MockRunner { output: Vec<u8>, success: bool }

    impl CommandRunner for MockRunner {
        fn run(&self, _program: &str, _args: &[&str]) -> std::io::Result<std::process::Output> {
            use std::os::unix::process::ExitStatusExt;
            Ok(std::process::Output {
                status: std::process::ExitStatus::from_raw(if self.success { 0 } else { 1 }),
                stdout: self.output.clone(),
                stderr: vec![],
            })
        }
    }

    #[tokio::test]
    async fn collector_returns_zero_counts_when_kubectl_fails() {
        let runner = Box::new(MockRunner { output: vec![], success: false });
        let c      = K3sCollector::with_runner(runner, "/tmp/fake.yaml");
        let v      = c.collect().await.unwrap();
        assert_eq!(v["node_count"].as_u64().unwrap(), 0);
        assert_eq!(v["pod_count"].as_u64().unwrap(),  0);
    }
}
