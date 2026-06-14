use anyhow::Result;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::Command;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{debug, info, warn};

use crate::config::CollectorFlags;

use super::trait_collector::Collector;

pub trait CommandRunner: Send + Sync {
    fn run(&self, program: &str, args: &[&str]) -> std::io::Result<std::process::Output>;
}

pub struct RealCommandRunner;

impl CommandRunner for RealCommandRunner {
    fn run(&self, program: &str, args: &[&str]) -> std::io::Result<std::process::Output> {
        Command::new(program).args(args).output()
    }
}

#[derive(Clone, Debug)]
struct PodIdentity {
    name: String,
    namespace: String,
    phase: String,
}

#[derive(Clone, Debug, Default)]
struct NodeMetric {
    cpu_cores: f64,
    cpu_percent: Option<f64>,
    memory_bytes: u64,
    memory_percent: Option<f64>,
}

#[derive(Clone, Debug, Default)]
struct PodMetric {
    cpu_cores: f64,
    cpu_percent: Option<f64>,
    memory_bytes: u64,
    memory_percent: Option<f64>,
}

pub struct K3sCollector {
    runner: Box<dyn CommandRunner>,
    kubeconfig: String,
    log_engine: Option<crate::engines::logging::LogEngine>,
    prev_pod_states: Arc<Mutex<HashMap<String, PodIdentity>>>,
    flags: CollectorFlags,
}

impl K3sCollector {
    pub fn new(flags: CollectorFlags) -> Self {
        Self {
            runner: Box::new(RealCommandRunner),
            kubeconfig: "/etc/rancher/k3s/k3s.yaml".to_string(),
            log_engine: None,
            prev_pod_states: Arc::new(Mutex::new(HashMap::new())),
            flags,
        }
    }

    pub fn with_runner(runner: Box<dyn CommandRunner>, kubeconfig: &str) -> Self {
        Self {
            runner,
            kubeconfig: kubeconfig.to_string(),
            log_engine: None,
            prev_pod_states: Arc::new(Mutex::new(HashMap::new())),
            flags: Arc::new(tokio::sync::RwLock::new(HashMap::new())),
        }
    }

    pub fn with_log_engine(
        engine: crate::engines::logging::LogEngine,
        flags: CollectorFlags,
    ) -> Self {
        Self {
            runner: Box::new(RealCommandRunner),
            kubeconfig: "/etc/rancher/k3s/k3s.yaml".to_string(),
            log_engine: Some(engine),
            prev_pod_states: Arc::new(Mutex::new(HashMap::new())),
            flags,
        }
    }

    async fn log_diag(&self, msg: &str) {
        if let Some(ref le) = self.log_engine {
            let _ = le.info("k3s_engine", msg).await;
        }
        info!("[k3s] {msg}");
    }

    async fn log_diag_warn(&self, msg: &str) {
        if let Some(ref le) = self.log_engine {
            let _ = le.warn("k3s_engine", msg).await;
        }
        warn!("[k3s] {msg}");
    }
}

#[async_trait]
impl Collector for K3sCollector {
    fn name(&self) -> &'static str {
        "k3s"
    }

    async fn collect(&self) -> Result<Value> {
        // Check if K3s collector is enabled at runtime (dynamic toggle)
        {
            let flags = self.flags.read().await;
            if !flags.get("kubernetes").copied().unwrap_or(true) {
                return Ok(json!({
                    "server_reachable": false,
                    "node_count": 0,
                    "pod_count": 0,
                    "event_count": 0,
                    "collector_disabled": true,
                }));
            }
        }

        let server_status = probe_k3s_server(&*self.runner, &self.kubeconfig);
        self.log_diag(&format!("server_reachable={server_status}"))
            .await;

        let raw_nodes = collect_nodes(&*self.runner, &self.kubeconfig);
        let node_metrics = collect_node_metrics(&*self.runner, &self.kubeconfig);
        if !node_metrics.is_empty() {
            self.log_diag(&format!("node metrics collected: {}", node_metrics.len()))
                .await;
        }
        let nodes = merge_node_metrics(&raw_nodes, &node_metrics);
        let node_count = nodes.as_array().map(|a| a.len()).unwrap_or(0);
        self.log_diag(&format!("nodes collected: {node_count}"))
            .await;

        let raw_pods = collect_pods(&*self.runner, &self.kubeconfig);
        let pod_metrics = collect_pod_metrics(&*self.runner, &self.kubeconfig);
        if !pod_metrics.is_empty() {
            self.log_diag(&format!("pod metrics collected: {}", pod_metrics.len()))
                .await;
        }
        let pods = merge_pod_metrics(&raw_pods, &pod_metrics);
        let pod_count = pods.as_array().map(|a| a.len()).unwrap_or(0);
        self.log_diag(&format!("pods collected: {pod_count}")).await;

        let running = count_running_pods(&pods);
        let pending = count_pods_by_phase(&pods, "Pending");
        let failed = count_pods_by_phase(&pods, "Failed");
        let crashloop = count_crashloop_pods(&pods);
        debug!("[k3s] pod distribution: running={running} pending={pending} failed={failed} crashloop={crashloop}");

        let events = collect_pod_events(&*self.runner, &self.kubeconfig);
        let event_count = events.as_array().map(|a| a.len()).unwrap_or(0);
        if event_count > 0 {
            self.log_diag(&format!("pod events collected: {event_count}"))
                .await;
        }

        let deployments = collect_deployments(&*self.runner, &self.kubeconfig);
        let deployment_count = deployments.as_array().map(|a| a.len()).unwrap_or(0);
        let daemonsets = collect_daemonsets(&*self.runner, &self.kubeconfig);
        let daemonset_count = daemonsets.as_array().map(|a| a.len()).unwrap_or(0);
        let statefulsets = collect_statefulsets(&*self.runner, &self.kubeconfig);
        let statefulset_count = statefulsets.as_array().map(|a| a.len()).unwrap_or(0);
        let services = collect_services(&*self.runner, &self.kubeconfig);
        let service_count = services.as_array().map(|a| a.len()).unwrap_or(0);
        let pvcs = collect_pvcs(&*self.runner, &self.kubeconfig);
        let pvc_count = pvcs.as_array().map(|a| a.len()).unwrap_or(0);

        if server_status && node_metrics.is_empty() && pod_metrics.is_empty() {
            self.log_diag_warn(
                "kubectl top returned no metrics — metrics-server may not be installed or is unreachable",
            )
            .await;
        }

        let cluster_resources = summarize_cluster_resources(&nodes, &node_metrics);

        self.emit_pod_state_change_logs(&pods).await;

        Ok(json!({
            "server_reachable": server_status,
            "nodes": nodes,
            "pods":  pods,
            "events": events,
            "node_count": node_count,
            "pod_count":  pod_count,
            "running_pods": running,
            "pending_pods": pending,
            "failed_pods": failed,
            "succeeded_pods": count_pods_by_phase(&pods, "Succeeded"),
            "unknown_pods": count_pods_by_phase(&pods, "Unknown"),
            "crashloopbackoff_pods": crashloop,
            "event_count": event_count,
            "node_metrics_available": !node_metrics.is_empty(),
            "pod_metrics_available": !pod_metrics.is_empty(),
            "cluster_resources": cluster_resources,
            "deployment_count": deployment_count,
            "daemonset_count": daemonset_count,
            "statefulset_count": statefulset_count,
            "service_count": service_count,
            "persistent_volume_claim_count": pvc_count,
            "workloads": {
                "deployments": deployments,
                "daemonsets": daemonsets,
                "statefulsets": statefulsets,
                "services": services,
                "persistent_volume_claims": pvcs,
            },
        }))
    }
}

fn kubectl_args<'a>(kubeconfig: &'a str, extra: &[&'a str]) -> Vec<&'a str> {
    let mut args = vec!["--kubeconfig", kubeconfig];
    args.extend_from_slice(extra);
    args
}

fn probe_k3s_server(runner: &dyn CommandRunner, kubeconfig: &str) -> bool {
    runner
        .run(
            "kubectl",
            &kubectl_args(kubeconfig, &["cluster-info", "--request-timeout=2s"]),
        )
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn collect_nodes(runner: &dyn CommandRunner, kubeconfig: &str) -> Value {
    let args = kubectl_args(kubeconfig, &["get", "nodes", "-o", "json"]);
    match runner.run("kubectl", &args) {
        Ok(out) if out.status.success() => parse_kubectl_nodes(&out.stdout).unwrap_or(json!([])),
        Ok(_) | Err(_) => {
            warn!("k3s: unable to list nodes");
            json!([])
        }
    }
}

fn collect_pods(runner: &dyn CommandRunner, kubeconfig: &str) -> Value {
    let args = kubectl_args(
        kubeconfig,
        &["get", "pods", "--all-namespaces", "-o", "json"],
    );
    match runner.run("kubectl", &args) {
        Ok(out) if out.status.success() => parse_kubectl_pods(&out.stdout).unwrap_or(json!([])),
        Ok(_) | Err(_) => {
            warn!("k3s: unable to list pods");
            json!([])
        }
    }
}

fn collect_pod_events(runner: &dyn CommandRunner, kubeconfig: &str) -> Value {
    let args = kubectl_args(
        kubeconfig,
        &[
            "get",
            "events",
            "--all-namespaces",
            "--field-selector",
            "involvedObject.kind=Pod",
            "-o",
            "json",
            "--sort-by=.lastTimestamp",
        ],
    );
    match runner.run("kubectl", &args) {
        Ok(out) if out.status.success() => parse_kubectl_events(&out.stdout).unwrap_or(json!([])),
        Ok(_) | Err(_) => {
            json!([])
        }
    }
}

fn collect_node_metrics(
    runner: &dyn CommandRunner,
    kubeconfig: &str,
) -> HashMap<String, NodeMetric> {
    let args = kubectl_args(
        kubeconfig,
        &[
            "top",
            "nodes",
            "--no-headers",
            "--use-protocol-buffers=false",
        ],
    );
    match runner.run("kubectl", &args) {
        Ok(out) if out.status.success() => parse_kubectl_top_nodes(&out.stdout).unwrap_or_default(),
        Ok(out) => {
            debug!(
                "[k3s] kubectl top nodes exited with status {:?}",
                out.status
            );
            HashMap::new()
        }
        Err(e) => {
            debug!("[k3s] kubectl top nodes failed: {e}");
            HashMap::new()
        }
    }
}

fn collect_pod_metrics(runner: &dyn CommandRunner, kubeconfig: &str) -> HashMap<String, PodMetric> {
    let args = kubectl_args(
        kubeconfig,
        &[
            "top",
            "pods",
            "--all-namespaces",
            "--no-headers",
            "--use-protocol-buffers=false",
        ],
    );
    match runner.run("kubectl", &args) {
        Ok(out) if out.status.success() => parse_kubectl_top_pods(&out.stdout).unwrap_or_default(),
        Ok(out) => {
            debug!("[k3s] kubectl top pods exited with status {:?}", out.status);
            HashMap::new()
        }
        Err(e) => {
            debug!("[k3s] kubectl top pods failed: {e}");
            HashMap::new()
        }
    }
}

fn merge_node_metrics(nodes: &Value, metrics: &HashMap<String, NodeMetric>) -> Value {
    let mut merged = Vec::new();
    if let Some(arr) = nodes.as_array() {
        for node in arr {
            let mut item = node.clone();
            if let Some(name) = item.get("name").and_then(|v| v.as_str()) {
                if let Some(metric) = metrics.get(name) {
                    if let Value::Object(ref mut obj) = item {
                        obj.insert(
                            "metrics".into(),
                            json!({
                                "cpu_cores": metric.cpu_cores,
                                "cpu_percent": metric.cpu_percent,
                                "memory_bytes": metric.memory_bytes,
                                "memory_percent": metric.memory_percent,
                            }),
                        );
                    }
                }
            }
            merged.push(item);
        }
    }
    Value::Array(merged)
}

fn merge_pod_metrics(pods: &Value, metrics: &HashMap<String, PodMetric>) -> Value {
    let mut merged = Vec::new();
    if let Some(arr) = pods.as_array() {
        for pod in arr {
            let mut item = pod.clone();
            if let (Some(ns), Some(name)) = (
                item.get("namespace").and_then(|v| v.as_str()),
                item.get("name").and_then(|v| v.as_str()),
            ) {
                let key = format!("{}/{}", ns, name);
                if let Some(metric) = metrics.get(&key) {
                    if let Value::Object(ref mut obj) = item {
                        obj.insert(
                            "metrics".into(),
                            json!({
                                "cpu_cores": metric.cpu_cores,
                                "cpu_percent": metric.cpu_percent,
                                "memory_bytes": metric.memory_bytes,
                                "memory_percent": metric.memory_percent,
                            }),
                        );
                    }
                }
            }
            merged.push(item);
        }
    }
    Value::Array(merged)
}

fn parse_kubectl_top_nodes(raw: &[u8]) -> Result<HashMap<String, NodeMetric>> {
    let text = String::from_utf8_lossy(raw);
    let mut metrics = HashMap::new();

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("NAME") {
            continue;
        }

        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }

        let name = parts[0];
        let mut idx = 1;

        let cpu_cores = parts
            .get(idx)
            .and_then(|v| parse_cpu_quantity_to_cores(v))
            .unwrap_or(0.0);
        idx += 1;

        let mut cpu_percent = None;
        if let Some(part) = parts.get(idx) {
            if part.contains('%') {
                cpu_percent = parse_percent(part);
                idx += 1;
            }
        }

        let memory_bytes = parts
            .get(idx)
            .and_then(|v| parse_k8s_quantity_to_bytes(v))
            .unwrap_or(0);
        idx += 1;

        let mut memory_percent = None;
        if let Some(part) = parts.get(idx) {
            if part.contains('%') {
                memory_percent = parse_percent(part);
            }
        }

        metrics.insert(
            name.to_string(),
            NodeMetric {
                cpu_cores,
                cpu_percent,
                memory_bytes,
                memory_percent,
            },
        );
    }

    Ok(metrics)
}

fn parse_kubectl_top_pods(raw: &[u8]) -> Result<HashMap<String, PodMetric>> {
    let text = String::from_utf8_lossy(raw);
    let mut metrics = HashMap::new();

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("NAMESPACE") {
            continue;
        }

        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 3 {
            continue;
        }

        let namespace = parts[0];
        let name = parts[1];
        let mut idx = 2;

        let cpu_cores = parts
            .get(idx)
            .and_then(|v| parse_cpu_quantity_to_cores(v))
            .unwrap_or(0.0);
        idx += 1;

        let mut cpu_percent = None;
        if let Some(part) = parts.get(idx) {
            if part.contains('%') {
                cpu_percent = parse_percent(part);
                idx += 1;
            }
        }

        let memory_bytes = parts
            .get(idx)
            .and_then(|v| parse_k8s_quantity_to_bytes(v))
            .unwrap_or(0);
        idx += 1;

        let mut memory_percent = None;
        if let Some(part) = parts.get(idx) {
            if part.contains('%') {
                memory_percent = parse_percent(part);
            }
        }

        let key = format!("{}/{}", namespace, name);
        metrics.insert(
            key,
            PodMetric {
                cpu_cores,
                cpu_percent,
                memory_bytes,
                memory_percent,
            },
        );
    }

    Ok(metrics)
}

fn summarize_cluster_resources(nodes: &Value, metrics: &HashMap<String, NodeMetric>) -> Value {
    let mut cpu_usage = 0.0;
    let mut cpu_percent_sum = 0.0;
    let mut cpu_percent_count = 0u64;
    let mut memory_usage = 0u64;

    for metric in metrics.values() {
        cpu_usage += metric.cpu_cores;
        if let Some(pct) = metric.cpu_percent {
            cpu_percent_sum += pct;
            cpu_percent_count += 1;
        }
        memory_usage += metric.memory_bytes;
    }

    let mut cpu_capacity = 0.0;
    let mut cpu_allocatable = 0.0;
    let mut memory_capacity = 0u64;
    let mut memory_allocatable = 0u64;

    if let Some(arr) = nodes.as_array() {
        for node in arr {
            if let Some(val) = node
                .get("capacity_cpu")
                .and_then(|v| v.as_str())
                .and_then(parse_cpu_quantity_to_cores)
            {
                cpu_capacity += val;
            }
            if let Some(val) = node
                .get("allocatable_cpu")
                .and_then(|v| v.as_str())
                .and_then(parse_cpu_quantity_to_cores)
            {
                cpu_allocatable += val;
            }
            if let Some(val) = node
                .get("capacity_memory")
                .and_then(|v| v.as_str())
                .and_then(parse_k8s_quantity_to_bytes)
            {
                memory_capacity += val;
            }
            if let Some(val) = node
                .get("allocatable_memory")
                .and_then(|v| v.as_str())
                .and_then(parse_k8s_quantity_to_bytes)
            {
                memory_allocatable += val;
            }
        }
    }

    let cpu_percent_avg = if cpu_percent_count > 0 {
        cpu_percent_sum / cpu_percent_count as f64
    } else {
        0.0
    };

    json!({
        "nodes_reporting": metrics.len(),
        "cpu_usage_cores": cpu_usage,
        "cpu_capacity_cores": cpu_capacity,
        "cpu_allocatable_cores": cpu_allocatable,
        "cpu_percent_avg": cpu_percent_avg,
        "memory_usage_bytes": memory_usage,
        "memory_capacity_bytes": memory_capacity,
        "memory_allocatable_bytes": memory_allocatable,
    })
}

fn parse_cpu_quantity_to_cores(input: &str) -> Option<f64> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Some(value) = trimmed.strip_suffix('m') {
        return value.parse::<f64>().ok().map(|v| v / 1000.0);
    }
    if let Some(value) = trimmed.strip_suffix('u') {
        return value.parse::<f64>().ok().map(|v| v / 1_000_000.0);
    }
    if let Some(value) = trimmed.strip_suffix('n') {
        return value.parse::<f64>().ok().map(|v| v / 1_000_000_000.0);
    }

    trimmed.parse::<f64>().ok()
}

fn parse_k8s_quantity_to_bytes(input: &str) -> Option<u64> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }

    let lower = trimmed.to_ascii_lowercase();

    let parse_with_multiplier = |num: &str, multiplier: u64| -> Option<u64> {
        num.trim()
            .parse::<f64>()
            .ok()
            .map(|v| (v * multiplier as f64).round() as u64)
    };

    if let Some(num) = lower.strip_suffix("ki") {
        return parse_with_multiplier(num, 1024);
    }
    if let Some(num) = lower.strip_suffix("mi") {
        return parse_with_multiplier(num, 1024_u64.pow(2));
    }
    if let Some(num) = lower.strip_suffix("gi") {
        return parse_with_multiplier(num, 1024_u64.pow(3));
    }
    if let Some(num) = lower.strip_suffix("ti") {
        return parse_with_multiplier(num, 1024_u64.pow(4));
    }
    if let Some(num) = lower.strip_suffix("pi") {
        return parse_with_multiplier(num, 1024_u64.pow(5));
    }
    if let Some(num) = lower.strip_suffix("k") {
        return parse_with_multiplier(num, 1_000);
    }
    if let Some(num) = lower.strip_suffix("m") {
        return parse_with_multiplier(num, 1_000_000);
    }
    if let Some(num) = lower.strip_suffix("g") {
        return parse_with_multiplier(num, 1_000_000_000);
    }
    if let Some(num) = lower.strip_suffix("t") {
        return parse_with_multiplier(num, 1_000_000_000_000);
    }
    if let Some(num) = lower.strip_suffix("p") {
        return parse_with_multiplier(num, 1_000_000_000_000_000);
    }

    trimmed.parse::<f64>().ok().map(|v| v.round() as u64)
}

fn parse_percent(input: &str) -> Option<f64> {
    let trimmed = input.trim().trim_end_matches('%');
    trimmed.parse::<f64>().ok()
}

fn count_running_pods(pods: &Value) -> usize {
    pods.as_array()
        .map(|arr| {
            arr.iter()
                .filter(|p| p.get("phase").and_then(|v| v.as_str()) == Some("Running"))
                .count()
        })
        .unwrap_or(0)
}

fn count_pods_by_phase(pods: &Value, phase: &str) -> usize {
    pods.as_array()
        .map(|arr| {
            arr.iter()
                .filter(|p| p.get("phase").and_then(|v| v.as_str()) == Some(phase))
                .count()
        })
        .unwrap_or(0)
}

fn count_crashloop_pods(pods: &Value) -> usize {
    pods.as_array()
        .map(|arr| {
            arr.iter()
                .filter(|pod| {
                    pod["container_statuses"]
                        .as_array()
                        .map_or(false, |statuses| {
                            statuses.iter().any(|s| {
                                s["state"]["waiting"]["reason"].as_str() == Some("CrashLoopBackOff")
                                    || s["last_state"]["terminated"]["reason"].as_str()
                                        == Some("CrashLoopBackOff")
                            })
                        })
                        || pod["init_container_statuses"]
                            .as_array()
                            .map_or(false, |statuses| {
                                statuses.iter().any(|s| {
                                    s["state"]["waiting"]["reason"]
                                        .as_str()
                                        .map_or(false, |r| r.contains("CrashLoopBackOff"))
                                })
                            })
                })
                .count()
        })
        .unwrap_or(0)
}

pub fn parse_kubectl_nodes(raw: &[u8]) -> Result<Value> {
    let doc: Value = serde_json::from_slice(raw)?;
    let items = doc["items"].as_array().cloned().unwrap_or_default();

    let nodes: Vec<Value> = items
        .iter()
        .map(|node| {
            let name = node["metadata"]["name"].as_str().unwrap_or("").to_string();
            let status = extract_node_ready_status(node);
            let version = node["status"]["nodeInfo"]["kubeletVersion"]
                .as_str()
                .unwrap_or("")
                .to_string();
            let arch = node["status"]["nodeInfo"]["architecture"]
                .as_str()
                .unwrap_or("")
                .to_string();
            let os = node["status"]["nodeInfo"]["osImage"]
                .as_str()
                .unwrap_or("")
                .to_string();

            let cpu_cap = node["status"]["capacity"]["cpu"]
                .as_str()
                .unwrap_or("0")
                .to_string();
            let mem_cap = node["status"]["capacity"]["memory"]
                .as_str()
                .unwrap_or("0Ki")
                .to_string();

            let cpu_alloc = node["status"]["allocatable"]["cpu"]
                .as_str()
                .unwrap_or("0")
                .to_string();
            let mem_alloc = node["status"]["allocatable"]["memory"]
                .as_str()
                .unwrap_or("0Ki")
                .to_string();

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
        })
        .collect();

    Ok(Value::Array(nodes))
}

fn extract_node_ready_status(node: &Value) -> bool {
    node["status"]["conditions"]
        .as_array()
        .and_then(|conditions| {
            conditions
                .iter()
                .find(|c| c["type"].as_str() == Some("Ready"))
                .and_then(|c| c["status"].as_str())
                .map(|s| s == "True")
        })
        .unwrap_or(false)
}

fn extract_container_state_detail(status: &Value) -> Value {
    let state = &status["state"];
    if let Some(running) = state.get("running") {
        return json!({
            "type": "running",
            "started_at": running.get("startedAt").and_then(|v| v.as_str()).unwrap_or(""),
        });
    }
    if let Some(waiting) = state.get("waiting") {
        return json!({
            "type": "waiting",
            "reason": waiting.get("reason").and_then(|v| v.as_str()).unwrap_or(""),
            "message": waiting.get("message").and_then(|v| v.as_str()).unwrap_or(""),
        });
    }
    if let Some(terminated) = state.get("terminated") {
        return json!({
            "type": "terminated",
            "reason": terminated.get("reason").and_then(|v| v.as_str()).unwrap_or(""),
            "exit_code": terminated.get("exitCode").and_then(|v| v.as_i64()).unwrap_or(-1),
            "started_at": terminated.get("startedAt").and_then(|v| v.as_str()).unwrap_or(""),
            "finished_at": terminated.get("finishedAt").and_then(|v| v.as_str()).unwrap_or(""),
            "message": terminated.get("message").and_then(|v| v.as_str()).unwrap_or(""),
        });
    }
    json!({"type": "unknown"})
}

pub fn parse_kubectl_pods(raw: &[u8]) -> Result<Value> {
    let doc: Value = serde_json::from_slice(raw)?;
    let items = doc["items"].as_array().cloned().unwrap_or_default();

    let pods: Vec<Value> = items
        .iter()
        .map(|pod| {
            let name = pod["metadata"]["name"].as_str().unwrap_or("").to_string();
            let namespace = pod["metadata"]["namespace"]
                .as_str()
                .unwrap_or("")
                .to_string();
            let phase = pod["status"]["phase"]
                .as_str()
                .unwrap_or("Unknown")
                .to_string();
            let node_name = pod["spec"]["nodeName"].as_str().unwrap_or("").to_string();
            let pod_ip = pod["status"]["podIP"].as_str().unwrap_or("").to_string();
            let host_ip = pod["status"]["hostIP"].as_str().unwrap_or("").to_string();
            let qos_class = pod["status"]["qosClass"].as_str().unwrap_or("").to_string();
            let reason = pod["status"]["reason"].as_str().unwrap_or("").to_string();
            let start_time = pod["status"]["startTime"]
                .as_str()
                .unwrap_or("")
                .to_string();
            let deletion_time = pod["metadata"]["deletionTimestamp"]
                .as_str()
                .unwrap_or("")
                .to_string();

            let container_statuses = parse_container_statuses(pod, "containerStatuses");
            let init_container_statuses = parse_container_statuses(pod, "initContainerStatuses");
            let ephemeral_container_statuses =
                parse_container_statuses(pod, "ephemeralContainerStatuses");

            let conditions: Vec<Value> = pod["status"]["conditions"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .map(|c| {
                    json!({
                        "type": c["type"].as_str().unwrap_or(""),
                        "status": c["status"].as_str().unwrap_or(""),
                        "reason": c["reason"].as_str().unwrap_or(""),
                        "message": c["message"].as_str().unwrap_or(""),
                        "last_transition": c["lastTransitionTime"].as_str().unwrap_or(""),
                    })
                })
                .collect();

            json!({
                "name":       name,
                "namespace":  namespace,
                "phase":      phase,
                "node":       node_name,
                "pod_ip":     pod_ip,
                "host_ip":    host_ip,
                "qos_class":  qos_class,
                "reason":     reason,
                "start_time": start_time,
                "deletion_timestamp": deletion_time,
                "containers": container_statuses,
                "init_containers": init_container_statuses,
                "ephemeral_containers": ephemeral_container_statuses,
                "conditions": conditions,
            })
        })
        .collect();

    Ok(Value::Array(pods))
}

fn parse_container_statuses(pod: &Value, field: &str) -> Vec<Value> {
    pod["status"][field]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|s| {
            let cname = s["name"].as_str().unwrap_or("").to_string();
            let image = s["image"].as_str().unwrap_or("").to_string();
            let ready = s["ready"].as_bool().unwrap_or(false);
            let restarts = s["restartCount"].as_u64().unwrap_or(0);
            let image_id = s["imageID"].as_str().unwrap_or("").to_string();
            let container_id = s["containerID"].as_str().unwrap_or("").to_string();
            let started = s["started"].as_bool().unwrap_or(false);

            let state = extract_container_state_detail(s);
            let last_state = extract_container_state_detail_on_last(s);

            json!({
                "name":        cname,
                "image":       image,
                "ready":       ready,
                "restarts":    restarts,
                "state":       state,
                "last_state":  last_state,
                "image_id":    image_id,
                "container_id": container_id,
                "started":     started,
            })
        })
        .collect()
}

fn extract_container_state_detail_on_last(status: &Value) -> Value {
    let state = &status["lastState"];
    if let Some(running) = state.get("running") {
        return json!({
            "type": "running",
            "started_at": running.get("startedAt").and_then(|v| v.as_str()).unwrap_or(""),
        });
    }
    if let Some(waiting) = state.get("waiting") {
        return json!({
            "type": "waiting",
            "reason": waiting.get("reason").and_then(|v| v.as_str()).unwrap_or(""),
            "message": waiting.get("message").and_then(|v| v.as_str()).unwrap_or(""),
        });
    }
    if let Some(terminated) = state.get("terminated") {
        return json!({
            "type": "terminated",
            "reason": terminated.get("reason").and_then(|v| v.as_str()).unwrap_or(""),
            "exit_code": terminated.get("exitCode").and_then(|v| v.as_i64()).unwrap_or(-1),
            "started_at": terminated.get("startedAt").and_then(|v| v.as_str()).unwrap_or(""),
            "finished_at": terminated.get("finishedAt").and_then(|v| v.as_str()).unwrap_or(""),
            "message": terminated.get("message").and_then(|v| v.as_str()).unwrap_or(""),
        });
    }
    json!({"type": "none"})
}

pub fn parse_kubectl_events(raw: &[u8]) -> Result<Value> {
    let doc: Value = serde_json::from_slice(raw)?;
    let items = doc["items"].as_array().cloned().unwrap_or_default();

    let events: Vec<Value> = items
        .iter()
        .map(|ev| {
            let metadata = &ev["metadata"];
            let involved = &ev["involvedObject"];
            let source = &ev["source"];

            json!({
                "name": metadata["name"].as_str().unwrap_or(""),
                "namespace": metadata["namespace"].as_str().unwrap_or(""),
                "creation_timestamp": metadata["creationTimestamp"].as_str().unwrap_or(""),
                "involved_object": {
                    "kind": involved["kind"].as_str().unwrap_or(""),
                    "name": involved["name"].as_str().unwrap_or(""),
                    "namespace": involved["namespace"].as_str().unwrap_or(""),
                    "uid": involved["uid"].as_str().unwrap_or(""),
                },
                "reason": ev["reason"].as_str().unwrap_or(""),
                "message": ev["message"].as_str().unwrap_or(""),
                "source": {
                    "component": source["component"].as_str().unwrap_or(""),
                    "host": source["host"].as_str().unwrap_or(""),
                },
                "type": ev["type"].as_str().unwrap_or(""), // Normal or Warning
                "count": ev["count"].as_u64().unwrap_or(1),
                "last_timestamp": ev["lastTimestamp"].as_str().unwrap_or(""),
                "first_timestamp": ev["firstTimestamp"].as_str().unwrap_or(""),
                "series": ev["series"].as_object().map(|_| json!({
                    "count": ev["series"]["count"].as_u64().unwrap_or(0),
                    "last_observed_time": ev["series"]["lastObservedTime"].as_str().unwrap_or(""),
                })).unwrap_or(json!(null)),
            })
        })
        .collect();

    Ok(Value::Array(events))
}

fn collect_deployments(runner: &dyn CommandRunner, kubeconfig: &str) -> Value {
    let args = kubectl_args(
        kubeconfig,
        &["get", "deployments", "--all-namespaces", "-o", "json"],
    );
    match runner.run("kubectl", &args) {
        Ok(out) if out.status.success() => {
            parse_kubectl_deployments(&out.stdout).unwrap_or(json!([]))
        }
        Ok(_) | Err(_) => json!([]),
    }
}

fn collect_daemonsets(runner: &dyn CommandRunner, kubeconfig: &str) -> Value {
    let args = kubectl_args(
        kubeconfig,
        &["get", "daemonsets", "--all-namespaces", "-o", "json"],
    );
    match runner.run("kubectl", &args) {
        Ok(out) if out.status.success() => {
            parse_kubectl_daemonsets(&out.stdout).unwrap_or(json!([]))
        }
        Ok(_) | Err(_) => json!([]),
    }
}

fn collect_statefulsets(runner: &dyn CommandRunner, kubeconfig: &str) -> Value {
    let args = kubectl_args(
        kubeconfig,
        &["get", "statefulsets", "--all-namespaces", "-o", "json"],
    );
    match runner.run("kubectl", &args) {
        Ok(out) if out.status.success() => {
            parse_kubectl_statefulsets(&out.stdout).unwrap_or(json!([]))
        }
        Ok(_) | Err(_) => json!([]),
    }
}

fn collect_services(runner: &dyn CommandRunner, kubeconfig: &str) -> Value {
    let args = kubectl_args(
        kubeconfig,
        &["get", "services", "--all-namespaces", "-o", "json"],
    );
    match runner.run("kubectl", &args) {
        Ok(out) if out.status.success() => parse_kubectl_services(&out.stdout).unwrap_or(json!([])),
        Ok(_) | Err(_) => json!([]),
    }
}

fn collect_pvcs(runner: &dyn CommandRunner, kubeconfig: &str) -> Value {
    let args = kubectl_args(
        kubeconfig,
        &["get", "pvc", "--all-namespaces", "-o", "json"],
    );
    match runner.run("kubectl", &args) {
        Ok(out) if out.status.success() => parse_kubectl_pvcs(&out.stdout).unwrap_or(json!([])),
        Ok(_) | Err(_) => json!([]),
    }
}

fn parse_kubectl_deployments(raw: &[u8]) -> Result<Value> {
    let doc: Value = serde_json::from_slice(raw)?;
    let items = doc["items"].as_array().cloned().unwrap_or_default();

    let deployments: Vec<Value> = items
        .iter()
        .map(|item| {
            let metadata = &item["metadata"];
            let spec = &item["spec"];
            let status = &item["status"];

            let conditions: Vec<Value> = status["conditions"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .map(|c| {
                    json!({
                        "type": c["type"].as_str().unwrap_or(""),
                        "status": c["status"].as_str().unwrap_or(""),
                        "reason": c["reason"].as_str().unwrap_or(""),
                        "message": c["message"].as_str().unwrap_or(""),
                        "last_transition": c["lastUpdateTime"].as_str().unwrap_or(
                            c["lastTransitionTime"].as_str().unwrap_or("")
                        ),
                    })
                })
                .collect();

            json!({
                "name": metadata["name"].as_str().unwrap_or(""),
                "namespace": metadata["namespace"].as_str().unwrap_or(""),
                "generation": metadata["generation"].as_i64().unwrap_or(0),
                "replicas": spec["replicas"].as_u64().unwrap_or(1),
                "updated_replicas": status["updatedReplicas"].as_u64().unwrap_or(0),
                "ready_replicas": status["readyReplicas"].as_u64().unwrap_or(0),
                "available_replicas": status["availableReplicas"].as_u64().unwrap_or(0),
                "unavailable_replicas": status["unavailableReplicas"].as_u64().unwrap_or(0),
                "conditions": conditions,
            })
        })
        .collect();

    Ok(Value::Array(deployments))
}

fn parse_kubectl_daemonsets(raw: &[u8]) -> Result<Value> {
    let doc: Value = serde_json::from_slice(raw)?;
    let items = doc["items"].as_array().cloned().unwrap_or_default();

    let daemonsets: Vec<Value> = items
        .iter()
        .map(|item| {
            let metadata = &item["metadata"];
            let status = &item["status"];

            json!({
                "name": metadata["name"].as_str().unwrap_or(""),
                "namespace": metadata["namespace"].as_str().unwrap_or(""),
                "desired": status["desiredNumberScheduled"].as_u64().unwrap_or(0),
                "current": status["currentNumberScheduled"].as_u64().unwrap_or(0),
                "ready": status["numberReady"].as_u64().unwrap_or(0),
                "available": status["numberAvailable"].as_u64().unwrap_or(0),
                "unavailable": status["numberUnavailable"].as_u64().unwrap_or(0),
                "updated": status["updatedNumberScheduled"].as_u64().unwrap_or(0),
                "misscheduled": status["numberMisscheduled"].as_u64().unwrap_or(0),
            })
        })
        .collect();

    Ok(Value::Array(daemonsets))
}

fn parse_kubectl_statefulsets(raw: &[u8]) -> Result<Value> {
    let doc: Value = serde_json::from_slice(raw)?;
    let items = doc["items"].as_array().cloned().unwrap_or_default();

    let statefulsets: Vec<Value> = items
        .iter()
        .map(|item| {
            let metadata = &item["metadata"];
            let spec = &item["spec"];
            let status = &item["status"];

            json!({
                "name": metadata["name"].as_str().unwrap_or(""),
                "namespace": metadata["namespace"].as_str().unwrap_or(""),
                "replicas": spec["replicas"].as_u64().unwrap_or(1),
                "ready_replicas": status["readyReplicas"].as_u64().unwrap_or(0),
                "current_replicas": status["currentReplicas"].as_u64().unwrap_or(0),
                "updated_replicas": status["updatedReplicas"].as_u64().unwrap_or(0),
                "update_revision": status["updateRevision"].as_str().unwrap_or(""),
            })
        })
        .collect();

    Ok(Value::Array(statefulsets))
}

fn parse_kubectl_services(raw: &[u8]) -> Result<Value> {
    let doc: Value = serde_json::from_slice(raw)?;
    let items = doc["items"].as_array().cloned().unwrap_or_default();

    let services: Vec<Value> = items
        .iter()
        .map(|svc| {
            let metadata = &svc["metadata"];
            let spec = &svc["spec"];

            let ports: Vec<Value> = spec["ports"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .map(|p| {
                    let target_port = if let Some(tp) = p["targetPort"].as_i64() {
                        json!(tp)
                    } else if let Some(tp) = p["targetPort"].as_str() {
                        json!(tp)
                    } else {
                        Value::Null
                    };
                    json!({
                        "port": p["port"].as_i64().unwrap_or(0),
                        "target_port": target_port,
                        "protocol": p["protocol"].as_str().unwrap_or(""),
                        "node_port": p["nodePort"].as_i64().unwrap_or(0),
                    })
                })
                .collect();

            let selector = spec["selector"]
                .as_object()
                .map(|m| {
                    m.iter()
                        .map(|(k, v)| format!("{}={}", k, v.as_str().unwrap_or("")))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();

            json!({
                "name": metadata["name"].as_str().unwrap_or(""),
                "namespace": metadata["namespace"].as_str().unwrap_or(""),
                "type": spec["type"].as_str().unwrap_or(""),
                "cluster_ip": spec["clusterIP"].as_str().unwrap_or(""),
                "external_ips": spec["externalIPs"].as_array().cloned().unwrap_or_default()
                    .iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect::<Vec<_>>(),
                "selector": selector,
                "ports": ports,
            })
        })
        .collect();

    Ok(Value::Array(services))
}

fn parse_kubectl_pvcs(raw: &[u8]) -> Result<Value> {
    let doc: Value = serde_json::from_slice(raw)?;
    let items = doc["items"].as_array().cloned().unwrap_or_default();

    let pvcs: Vec<Value> = items.iter().map(|item| {
        let metadata = &item["metadata"];
        let spec = &item["spec"];
        let status = &item["status"];

        let access_modes = spec["accessModes"].as_array().cloned().unwrap_or_default()
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect::<Vec<_>>();

        json!({
            "name": metadata["name"].as_str().unwrap_or(""),
            "namespace": metadata["namespace"].as_str().unwrap_or(""),
            "phase": status["phase"].as_str().unwrap_or(""),
            "storage_class": spec["storageClassName"].as_str().unwrap_or(""),
            "volume_name": spec["volumeName"].as_str().unwrap_or(""),
            "requested_storage": spec["resources"]["requests"]["storage"].as_str().unwrap_or(""),
            "capacity": status["capacity"]["storage"].as_str().unwrap_or(""),
            "access_modes": access_modes,
        })
    }).collect();

    Ok(Value::Array(pvcs))
}

impl K3sCollector {
    async fn emit_pod_state_change_logs(&self, pods: &Value) {
        let log_engine = match &self.log_engine {
            Some(e) => e,
            None => return,
        };

        // BUILD current states WITHOUT holding prev_pod_states lock
        let current_states: HashMap<String, PodIdentity> = pods
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|pod| {
                        let name = pod["name"].as_str()?;
                        let namespace = pod["namespace"].as_str()?;
                        let phase = pod["phase"].as_str().unwrap_or("Unknown");
                        let key = format!("{}/{}", namespace, name);
                        Some((
                            key,
                            PodIdentity {
                                name: name.to_string(),
                                namespace: namespace.to_string(),
                                phase: phase.to_string(),
                            },
                        ))
                    })
                    .collect()
            })
            .unwrap_or_default();

        let crashloop_count = count_crashloop_pods(pods);

        // LOCK: only for comparing and swapping prev states
        let diffs: Vec<PodLogAction> = {
            let mut prev = self.prev_pod_states.lock().await;

            let mut actions = Vec::new();

            for (key, cur) in &current_states {
                match prev.get(key) {
                    Some(prev_state) if prev_state.phase != cur.phase => {
                        actions.push(PodLogAction::PhaseChange {
                            key: key.clone(),
                            namespace: cur.namespace.clone(),
                            name: cur.name.clone(),
                            old_phase: prev_state.phase.clone(),
                            new_phase: cur.phase.clone(),
                        });
                    }
                    None => {
                        actions.push(PodLogAction::NewPod {
                            key: key.clone(),
                            namespace: cur.namespace.clone(),
                            name: cur.name.clone(),
                            phase: cur.phase.clone(),
                        });
                    }
                    _ => {}
                }
            }

            for (key, prev_state) in prev.iter() {
                if !current_states.contains_key(key) {
                    actions.push(PodLogAction::Removed {
                        key: key.clone(),
                        namespace: prev_state.namespace.clone(),
                        name: prev_state.name.clone(),
                    });
                }
            }

            *prev = current_states;
            actions
        }; // Lock released

        // EMIT logs without holding any lock
        if diffs.is_empty() && crashloop_count == 0 {
            return;
        }

        if !diffs.is_empty() {
            self.log_diag(&format!("{} pod state change(s) detected", diffs.len()))
                .await;
        }

        for action in diffs {
            match action {
                PodLogAction::PhaseChange {
                    key: _,
                    namespace,
                    name,
                    old_phase,
                    new_phase,
                } => {
                    let msg =
                        format!("Pod {namespace}/{name} phase changed: {old_phase} -> {new_phase}");
                    let (severity, event_type) = match new_phase.as_str() {
                        "Running" => ("Info", "pod_started"),
                        "Pending" => ("Warning", "pod_pending"),
                        "Failed" => ("Error", "pod_failed"),
                        "Succeeded" => ("Info", "pod_succeeded"),
                        "Unknown" => ("Warning", "pod_unknown"),
                        _ => ("Info", "pod_phase_change"),
                    };
                    if let Err(e) = log_engine
                        .log_event("kubernetes", severity, event_type, &msg)
                        .await
                    {
                        warn!("[k3s] log_event failed for phase change: {e}");
                        let _ = log_engine
                            .warn("k3s_engine", &format!("log_event failed: {e}"))
                            .await;
                    }
                }
                PodLogAction::NewPod {
                    key: _,
                    namespace,
                    name,
                    phase,
                } => {
                    let msg = format!("New pod detected: {namespace}/{name} — phase: {phase}");
                    if let Err(e) = log_engine
                        .log_event("kubernetes", "Info", "pod_created", &msg)
                        .await
                    {
                        warn!("[k3s] log_event failed for new pod: {e}");
                    }
                }
                PodLogAction::Removed {
                    key: _,
                    namespace,
                    name,
                } => {
                    let msg = format!("Pod removed: {namespace}/{name}");
                    if let Err(e) = log_engine
                        .log_event("kubernetes", "Info", "pod_deleted", &msg)
                        .await
                    {
                        warn!("[k3s] log_event failed for pod removal: {e}");
                    }
                }
            }
        }

        if crashloop_count > 0 {
            let msg = format!("{crashloop_count} pod(s) in CrashLoopBackOff state");
            self.log_diag_warn(&msg).await;
            if let Err(e) = log_engine
                .log_event("kubernetes", "Error", "crashloop_detected", &msg)
                .await
            {
                warn!("[k3s] log_event failed for crashloop: {e}");
            }
        }
    }
}

enum PodLogAction {
    PhaseChange {
        key: String,
        namespace: String,
        name: String,
        old_phase: String,
        new_phase: String,
    },
    NewPod {
        key: String,
        namespace: String,
        name: String,
        phase: String,
    },
    Removed {
        key: String,
        namespace: String,
        name: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let raw = serde_json::to_vec(&doc).unwrap();
        let parsed = parse_kubectl_nodes(&raw).unwrap();
        let nodes = parsed.as_array().unwrap();
        assert_eq!(nodes.len(), 2);
        assert_eq!(nodes[0]["name"], "node-1");
        assert_eq!(nodes[0]["ready"], true);
        assert_eq!(nodes[1]["ready"], false);
    }

    #[test]
    fn parse_nodes_empty_items_returns_empty_array() {
        let doc = json!({ "items": [] });
        let raw = serde_json::to_vec(&doc).unwrap();
        let parsed = parse_kubectl_nodes(&raw).unwrap();
        assert!(parsed.as_array().unwrap().is_empty());
    }

    #[test]
    fn parse_nodes_invalid_json_returns_error() {
        let result = parse_kubectl_nodes(b"not-json");
        assert!(result.is_err());
    }

    fn pod_fixture(
        name: &str,
        namespace: &str,
        phase: &str,
        restarts: u64,
        state_type: &str,
        state_reason: &str,
    ) -> Value {
        let state = match state_type {
            "running" => json!({"running": {"startedAt": "2024-01-01T00:00:00Z"}}),
            "waiting" => json!({"waiting": {"reason": state_reason, "message": "backoff"}}),
            "terminated" => {
                json!({"terminated": {"reason": state_reason, "exitCode": 137, "startedAt": "t1", "finishedAt": "t2", "message": "oom"}})
            }
            _ => json!({}),
        };
        json!({
            "metadata": { "name": name, "namespace": namespace },
            "spec": {
                "nodeName":   "node-1",
                "containers": [{ "name": "app", "image": "nginx:latest" }]
            },
            "status": {
                "phase": phase,
                "podIP": "10.42.0.1",
                "hostIP": "192.168.1.1",
                "qosClass": "Burstable",
                "startTime": "2024-01-01T00:00:00Z",
                "containerStatuses": [{
                    "name":         "app",
                    "ready":        phase == "Running",
                    "started":      phase == "Running",
                    "restartCount": restarts,
                    "image":        "nginx:latest",
                    "imageID":      "docker-pullable://nginx@sha256:abc",
                    "containerID":  "docker://abc123",
                    "state": state,
                    "lastState": {
                        "terminated": {
                            "reason": "Completed",
                            "exitCode": 0,
                            "startedAt": "t0",
                            "finishedAt": "t1"
                        }
                    }
                }]
            }
        })
    }

    #[test]
    fn parse_pods_extracts_phase_and_state() {
        let doc = json!({ "items": [
            pod_fixture("web-1", "default", "Running", 0, "running", ""),
            pod_fixture("db-1",  "default", "Pending", 3, "waiting", "CrashLoopBackOff"),
        ]});
        let raw = serde_json::to_vec(&doc).unwrap();
        let parsed = parse_kubectl_pods(&raw).unwrap();
        let pods = parsed.as_array().unwrap();
        assert_eq!(pods.len(), 2);
        assert_eq!(pods[0]["phase"], "Running");
        assert_eq!(pods[1]["phase"], "Pending");
        assert_eq!(pods[1]["containers"][0]["restarts"].as_u64().unwrap(), 3);
        assert_eq!(pods[1]["containers"][0]["state"]["type"], "waiting");
        assert_eq!(
            pods[1]["containers"][0]["state"]["reason"],
            "CrashLoopBackOff"
        );
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

    #[test]
    fn count_pods_by_phase_works() {
        let pods = json!([
            { "phase": "Running" },
            { "phase": "Pending" },
            { "phase": "Pending" },
            { "phase": "Failed"  },
        ]);
        assert_eq!(count_pods_by_phase(&pods, "Pending"), 2);
        assert_eq!(count_pods_by_phase(&pods, "Failed"), 1);
    }

    #[test]
    fn detect_crashloop_pods() {
        let pods = json!([
            {
                "phase": "Running",
                "container_statuses": [{
                    "state": {"running": {"startedAt": "t1"}},
                    "last_state": {"terminated": {"reason": "Error"}}
                }]
            },
            {
                "phase": "Pending",
                "container_statuses": [{
                    "state": {"waiting": {"reason": "CrashLoopBackOff", "message": "backoff"}},
                    "last_state": {"terminated": {"reason": "CrashLoopBackOff"}}
                }]
            }
        ]);
        assert_eq!(count_crashloop_pods(&pods), 1);
    }

    #[test]
    fn parse_events_extracts_fields() {
        let doc = json!({
            "items": [{
                "metadata": {
                    "name": "pod.123",
                    "namespace": "default",
                    "creationTimestamp": "2024-01-01T00:00:00Z"
                },
                "involvedObject": {
                    "kind": "Pod",
                    "name": "web-1",
                    "namespace": "default",
                    "uid": "uid-123"
                },
                "reason": "BackOff",
                "message": "Back-off restarting failed container",
                "source": {
                    "component": "kubelet",
                    "host": "node-1"
                },
                "type": "Warning",
                "count": 5,
                "lastTimestamp": "2024-01-01T00:01:00Z",
                "firstTimestamp": "2024-01-01T00:00:00Z"
            }]
        });
        let raw = serde_json::to_vec(&doc).unwrap();
        let parsed = parse_kubectl_events(&raw).unwrap();
        let events = parsed.as_array().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0]["reason"], "BackOff");
        assert_eq!(events[0]["type"], "Warning");
        assert_eq!(events[0]["involved_object"]["name"], "web-1");
    }

    #[test]
    fn parse_top_nodes_handles_percentages() {
        let raw = b"node-1 200m 10% 512Mi 25%\nnode-2 1 5% 1Gi 50%\n";
        let metrics = parse_kubectl_top_nodes(raw).unwrap();
        let node1 = metrics.get("node-1").unwrap();
        assert!((node1.cpu_cores - 0.2).abs() < f64::EPSILON);
        assert_eq!(node1.memory_bytes, 512 * 1024 * 1024);
        assert_eq!(node1.memory_percent.unwrap(), 25.0);
        let node2 = metrics.get("node-2").unwrap();
        assert!((node2.cpu_cores - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn parse_top_pods_handles_units() {
        let raw = b"default web-1 25m 64Mi\nmonitor prometheus 150m 256Mi 30%\n";
        let metrics = parse_kubectl_top_pods(raw).unwrap();
        let pod = metrics.get("default/web-1").unwrap();
        assert!((pod.cpu_cores - 0.025).abs() < f64::EPSILON);
        assert_eq!(pod.memory_bytes, 64 * 1024 * 1024);
        let pod2 = metrics.get("monitor/prometheus").unwrap();
        assert!(pod2.memory_percent.is_some());
    }

    #[test]
    fn parse_cpu_quantity_parses_millicores() {
        assert!((parse_cpu_quantity_to_cores("500m").unwrap() - 0.5).abs() < f64::EPSILON);
        assert!((parse_cpu_quantity_to_cores("2").unwrap() - 2.0).abs() < f64::EPSILON);
    }

    #[test]
    fn parse_k8s_quantity_parses_memory_units() {
        assert_eq!(parse_k8s_quantity_to_bytes("1024Ki").unwrap(), 1024 * 1024);
        assert_eq!(
            parse_k8s_quantity_to_bytes("2Gi").unwrap(),
            2 * 1024_u64.pow(3)
        );
    }

    #[test]
    fn parse_deployments_extracts_replicas() {
        let doc = json!({
        "items": [{
            "metadata": {"name": "web", "namespace": "default", "generation": 3},
            "spec": {"replicas": 3},
            "status": {
                "updatedReplicas": 3,
                "readyReplicas": 2,
                "availableReplicas": 2,
                "unavailableReplicas": 1,
                "conditions": [{
                    "type": "Available",
                    "status": "True",
                    "reason": "MinimumReplicasAvailable",
                    "message": "Deployment has minimum availability",
                    "lastUpdateTime": "2024-01-01T00:00:00Z"
                }]
            }
        }]});
        let raw = serde_json::to_vec(&doc).unwrap();
        let parsed = parse_kubectl_deployments(&raw).unwrap();
        let arr = parsed.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["replicas"].as_u64().unwrap(), 3);
        assert_eq!(arr[0]["available_replicas"].as_u64().unwrap(), 2);
    }

    struct MockRunner {
        output: Vec<u8>,
        success: bool,
    }

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
        let runner = Box::new(MockRunner {
            output: vec![],
            success: false,
        });
        let c = K3sCollector::with_runner(runner, "/tmp/fake.yaml");
        let v = c.collect().await.unwrap();
        assert_eq!(v["node_count"].as_u64().unwrap(), 0);
        assert_eq!(v["pod_count"].as_u64().unwrap(), 0);
        assert_eq!(v["event_count"].as_u64().unwrap(), 0);
    }
}
