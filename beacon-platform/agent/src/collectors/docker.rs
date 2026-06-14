use anyhow::Result;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{debug, info, warn};

use crate::config::CollectorFlags;

use super::trait_collector::Collector;

#[derive(Clone, Debug)]
struct ContainerState {
    id: String,
    name: String,
    state: String,
    status: String,
}

#[derive(Clone, Debug, Default)]
struct ContainerStats {
    id: String,
    name: String,
    cpu_percent: f64,
    memory_usage_bytes: u64,
    memory_limit_bytes: u64,
    memory_percent: f64,
    network_rx_bytes: u64,
    network_tx_bytes: u64,
    block_read_bytes: u64,
    block_write_bytes: u64,
    pids: u64,
}

pub struct DockerCollector {
    log_engine: Option<crate::engines::logging::LogEngine>,
    prev_states: Arc<Mutex<HashMap<String, ContainerState>>>,
    flags: CollectorFlags,
    first_collect: Arc<Mutex<bool>>,
}

impl DockerCollector {
    pub fn new(flags: CollectorFlags) -> Self {
        Self {
            log_engine: None,
            prev_states: Arc::new(Mutex::new(HashMap::new())),
            flags,
            first_collect: Arc::new(Mutex::new(true)),
        }
    }

    pub fn with_log_engine(
        engine: crate::engines::logging::LogEngine,
        flags: CollectorFlags,
    ) -> Self {
        Self {
            log_engine: Some(engine),
            prev_states: Arc::new(Mutex::new(HashMap::new())),
            flags,
            first_collect: Arc::new(Mutex::new(true)),
        }
    }

    async fn log_diagnostics(&self, label: &str, msg: &str) {
        if let Some(ref le) = self.log_engine {
            let _ = le.info(label, msg).await;
        }
        info!("[docker] {msg}");
    }

    async fn log_diag_warn(&self, label: &str, msg: &str) {
        if let Some(ref le) = self.log_engine {
            let _ = le.warn(label, msg).await;
        }
        warn!("[docker] {msg}");
    }
}

#[async_trait]
impl Collector for DockerCollector {
    fn name(&self) -> &'static str {
        "docker"
    }

    async fn collect(&self) -> Result<Value> {
        // Check if Docker collector is enabled at runtime (dynamic toggle)
        {
            let flags = self.flags.read().await;
            if !flags.get("docker").copied().unwrap_or(true) {
                return Ok(json!({
                    "total_containers": 0,
                    "state_counts": {},
                    "containers": [],
                    "collector_disabled": true,
                }));
            }
        }

        let containers = query_docker_containers().await;

        match &containers {
            Ok(list) => {
                debug!("[docker] collect: {} containers found", list.len());
                if list.is_empty() {
                    self.log_diagnostics(
                        "docker_engine",
                        "No containers found (docker ps returned empty)",
                    )
                    .await;
                }
            }
            Err(e) => {
                self.log_diag_warn("docker_engine", &format!("Docker query failed: {e}"))
                    .await;
            }
        }

        let container_list = containers.unwrap_or_default();

        // Dump field names on first collect to help diagnose format issues
        {
            let mut first = self.first_collect.lock().await;
            if *first {
                *first = false;
                if let Some(first_container) = container_list.first() {
                    let keys: Vec<String> = first_container
                        .as_object()
                        .map(|obj| obj.keys().cloned().collect())
                        .unwrap_or_default();
                    info!("[docker] First collect — available JSON fields: {:?}", keys);
                    self.log_diagnostics(
                        "docker_engine",
                        &format!("Available JSON fields: {:?}", keys),
                    )
                    .await;
                } else {
                    self.log_diagnostics("docker_engine", "No containers on first collect — will retry format detection when containers appear").await;
                }
            }
        }

        let stats = match query_docker_stats().await {
            Ok(data) => {
                debug!(
                    "[docker] collect: resource stats for {} container(s)",
                    data.len()
                );
                data
            }
            Err(e) => {
                self.log_diag_warn("docker_engine", &format!("Docker stats query failed: {e}"))
                    .await;
                Vec::new()
            }
        };

        let metric = aggregate_containers(&container_list, &stats);

        // Log state distribution for diagnostics
        let sc = metric["state_counts"]
            .as_object()
            .map(|o| {
                o.iter()
                    .map(|(k, v)| format!("{}={}", k, v.as_u64().unwrap_or(0)))
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default();
        debug!("[docker] state distribution: {sc}");
        self.log_diagnostics("docker_engine", &format!("State distribution: {sc}"))
            .await;

        // Emit logs for state changes (with fixed lock pattern)
        self.emit_state_change_logs(&container_list).await;

        Ok(metric)
    }
}

// ─── Docker query with multiple fallback strategies ───────────────────────

async fn run_cmd(args: &[&str]) -> Result<(String, String)> {
    let output = tokio::process::Command::new("docker")
        .args(args)
        .output()
        .await?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        anyhow::bail!(
            "docker {} failed (exit={}): stderr={}",
            args.join(" "),
            output.status,
            stderr
        );
    }
    Ok((stdout, stderr))
}

async fn query_docker_containers() -> Result<Vec<Value>> {
    // Strategy 1: docker inspect for full state details
    match query_docker_inspect().await {
        Ok(containers) if !containers.is_empty() => {
            debug!(
                "[docker] using docker inspect ({} containers)",
                containers.len()
            );
            return Ok(containers);
        }
        Ok(_) => { /* empty — fall through */ }
        Err(e) => {
            debug!("[docker] docker inspect failed: {e} — falling back to docker ps");
        }
    }

    // Strategy 2: docker ps --format '{{json .}}'
    match query_docker_ps().await {
        Ok(containers) => {
            debug!("[docker] using docker ps ({} containers)", containers.len());
            Ok(containers)
        }
        Err(e) => {
            warn!("[docker] docker ps also failed: {e}");
            Err(e)
        }
    }
}

/// Strategy 1: Use `docker inspect $(docker ps -aq)` for detailed state.
async fn query_docker_inspect() -> Result<Vec<Value>> {
    // First get all container IDs
    let (ids_out, _) = run_cmd(&["ps", "-aq"]).await?;
    let ids: Vec<&str> = ids_out.lines().filter(|l| !l.is_empty()).collect();
    if ids.is_empty() {
        return Ok(vec![]);
    }

    // Build docker inspect args: inspect <id1> <id2> ...
    let mut args = vec!["inspect"];
    args.extend(ids.iter().copied());
    let (inspect_out, _) = run_cmd(&args).await?;

    let containers: Vec<Value> = serde_json::from_str(&inspect_out)
        .map_err(|e| anyhow::anyhow!("Failed to parse docker inspect JSON: {e}"))?;

    // Normalize docker inspect format to the standard container schema
    Ok(normalize_inspect_output(containers))
}

/// Normalize `docker inspect` output to match the flat field names
/// used by the rest of the collector.
fn normalize_inspect_output(inspected: Vec<Value>) -> Vec<Value> {
    inspected
        .into_iter()
        .map(|c| {
            // docker inspect wraps name with leading /
            let raw_name = c["Name"].as_str().unwrap_or("");
            let name = raw_name.trim_start_matches('/').to_string();

            let cid = c["Id"].as_str().unwrap_or("").to_string();
            let image = c["Config"]["Image"].as_str().unwrap_or("").to_string();
            let cmd = c["Config"]["Cmd"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str())
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .unwrap_or_default();
            let created = c["Created"].as_str().unwrap_or("").to_string();

            let state_obj = &c["State"];
            let state = state_obj["Status"]
                .as_str()
                .unwrap_or("unknown")
                .to_lowercase();

            let status_str = build_inspect_status_str(state_obj);

            let restart_count = state_obj["RestartCount"].as_u64().unwrap_or(0);
            let exit_code = state_obj["ExitCode"].as_i64().unwrap_or(0);
            let health = state_obj["Health"]["Status"]
                .as_str()
                .unwrap_or("")
                .to_string();

            // Ports
            let ports = c["NetworkSettings"]["Ports"]
                .as_object()
                .map(|p| p.keys().cloned().collect::<Vec<_>>().join(", "))
                .unwrap_or_default();

            // Mounts
            let mounts = c["Mounts"]
                .as_array()
                .map(|m| {
                    m.iter()
                        .filter_map(|m| m["Source"].as_str())
                        .collect::<Vec<_>>()
                        .join("; ")
                })
                .unwrap_or_default();

            // Networks
            let networks = c["NetworkSettings"]["Networks"]
                .as_object()
                .map(|n| n.keys().cloned().collect::<Vec<_>>().join(", "))
                .unwrap_or_default();

            // Labels
            let labels = c["Config"]["Labels"]
                .as_object()
                .map(|l| {
                    l.iter()
                        .map(|(k, v)| format!("{}={}", k, v.as_str().unwrap_or("")))
                        .collect::<Vec<_>>()
                        .join(",")
                })
                .unwrap_or_default();

            let platform = c["Platform"].as_str().unwrap_or("").to_string();

            json!({
                "ID": cid,
                "Names": name,
                "Image": image,
                "Command": cmd,
                "CreatedAt": created,
                "State": state,
                "Status": status_str,
                "Health": health,
                "RestartCount": restart_count.to_string(),
                "ExitCode": exit_code.to_string(),
                "Ports": ports,
                "Mounts": mounts,
                "Networks": networks,
                "Labels": labels,
                "Platform": platform,
            })
        })
        .collect()
}

fn build_inspect_status_str(state: &Value) -> String {
    let status = state["Status"].as_str().unwrap_or("unknown");
    let exit = state["ExitCode"].as_i64().unwrap_or(0);
    let started = state["StartedAt"].as_str().unwrap_or("");
    let finished = state["FinishedAt"].as_str().unwrap_or("");

    match status {
        "running" => {
            let health = state["Health"]["Status"].as_str().unwrap_or("");
            if health.is_empty() || health == "none" {
                format!("Up")
            } else {
                format!("Up ({})", health)
            }
        }
        "exited" => format!(
            "Exited ({}) {}",
            exit,
            if finished.len() > 10 {
                &finished[..10]
            } else {
                finished
            }
        ),
        "restarting" => format!("Restarting"),
        "paused" => format!("Paused"),
        "created" => format!("Created"),
        "dead" => format!("Dead"),
        _ => format!("{}", status),
    }
}

/// Strategy 2: Use `docker ps -a --format '{{json .}}'`
async fn query_docker_ps() -> Result<Vec<Value>> {
    let (stdout, _) = run_cmd(&["ps", "-a", "--format", "{{json .}}"]).await?;
    let containers: Vec<Value> = stdout
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();
    Ok(containers)
}

async fn query_docker_stats() -> Result<Vec<ContainerStats>> {
    let (stdout, _) = run_cmd(&["stats", "--no-stream", "--format", "{{json .}}"]).await?;
    let mut stats = Vec::new();
    for line in stdout.lines().filter(|l| !l.trim().is_empty()) {
        match serde_json::from_str::<Value>(line) {
            Ok(value) => {
                if let Some(entry) = parse_docker_stats_entry(&value) {
                    stats.push(entry);
                }
            }
            Err(e) => {
                debug!("[docker] failed to parse docker stats line: {line} ({e})");
            }
        }
    }
    Ok(stats)
}

fn parse_docker_stats_entry(value: &Value) -> Option<ContainerStats> {
    let id = value
        .get("ID")
        .and_then(|v| v.as_str())
        .or_else(|| value.get("Container").and_then(|v| v.as_str()))
        .map(|s| s.to_string())?;

    let name = value
        .get("Name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let cpu_percent = value
        .get("CPUPerc")
        .and_then(|v| v.as_str())
        .and_then(parse_percentage)
        .unwrap_or(0.0);

    let (memory_usage_bytes, memory_limit_bytes) = value
        .get("MemUsage")
        .and_then(|v| v.as_str())
        .and_then(parse_pair_bytes)
        .unwrap_or((0, 0));

    let memory_percent = value
        .get("MemPerc")
        .and_then(|v| v.as_str())
        .and_then(parse_percentage)
        .unwrap_or(0.0);

    let (network_rx_bytes, network_tx_bytes) = value
        .get("NetIO")
        .and_then(|v| v.as_str())
        .and_then(parse_pair_bytes)
        .unwrap_or((0, 0));

    let (block_read_bytes, block_write_bytes) = value
        .get("BlockIO")
        .and_then(|v| v.as_str())
        .and_then(parse_pair_bytes)
        .unwrap_or((0, 0));

    let pids = value.get("PIDs").and_then(parse_u64_value).unwrap_or(0);

    Some(ContainerStats {
        id,
        name,
        cpu_percent,
        memory_usage_bytes,
        memory_limit_bytes,
        memory_percent,
        network_rx_bytes,
        network_tx_bytes,
        block_read_bytes,
        block_write_bytes,
        pids,
    })
}

fn parse_u64_value(value: &Value) -> Option<u64> {
    match value {
        Value::Number(num) => num.as_u64(),
        Value::String(s) => s.trim().parse::<u64>().ok(),
        _ => None,
    }
}

fn parse_percentage(input: &str) -> Option<f64> {
    let trimmed = input.trim().trim_end_matches('%');
    trimmed.parse::<f64>().ok()
}

fn parse_pair_bytes(input: &str) -> Option<(u64, u64)> {
    let mut parts = input.split('/').map(|s| s.trim());
    let first = parts.next()?;
    let second = parts.next()?;
    Some((parse_byte_quantity(first)?, parse_byte_quantity(second)?))
}

fn parse_byte_quantity(input: &str) -> Option<u64> {
    let cleaned = input.trim();
    if cleaned.is_empty() || cleaned == "--" {
        return None;
    }

    let mut idx = cleaned.len();
    for (i, ch) in cleaned.char_indices() {
        if !(ch.is_ascii_digit() || ch == '.') {
            idx = i;
            break;
        }
    }

    let (number_str, unit_str) = cleaned.split_at(idx);
    let value = number_str.trim().parse::<f64>().ok()?;
    let unit = unit_str.trim().to_ascii_uppercase();

    let multiplier = match unit.as_str() {
        "" | "B" => 1.0,
        "KIB" => 1024.0,
        "MIB" => 1024.0_f64.powi(2),
        "GIB" => 1024.0_f64.powi(3),
        "TIB" => 1024.0_f64.powi(4),
        "PIB" => 1024.0_f64.powi(5),
        "KB" | "K" => 1_000.0,
        "MB" => 1_000_000.0,
        "GB" => 1_000_000_000.0,
        "TB" => 1_000_000_000_000.0,
        "PB" => 1_000_000_000_000_000.0,
        _ => {
            // Handle compound units like "MI" (without trailing B)
            if unit == "MI" {
                1024.0_f64.powi(2)
            } else if unit == "GI" {
                1024.0_f64.powi(3)
            } else if unit == "KI" {
                1024.0
            } else {
                return None;
            }
        }
    };

    Some((value * multiplier).round() as u64)
}

// ─── Field extractors ─────────────────────────────────────────────────────

fn get_container_state(container: &Value) -> String {
    // Try "State" field first (from docker inspect normalize or docker ps)
    if let Some(state) = container.get("State").and_then(|s| s.as_str()) {
        return state.to_lowercase();
    }
    // Fall back to parsing human-readable "Status" string
    if let Some(status) = container.get("Status").and_then(|s| s.as_str()) {
        return parse_state_from_status(status);
    }
    "unknown".to_string()
}

/// Parse container state from the human-readable Status string.
/// Examples: "Up 2 hours" → running, "Exited (0) 1 hour ago" → exited
fn parse_state_from_status(status: &str) -> String {
    let lower = status.to_lowercase();
    if lower.starts_with("up") {
        "running".to_string()
    } else if lower.starts_with("exited") {
        "exited".to_string()
    } else if lower.starts_with("restarting") {
        "restarting".to_string()
    } else if lower.starts_with("paused") {
        "paused".to_string()
    } else if lower.starts_with("created") || lower.starts_with("créé") {
        "created".to_string()
    } else if lower.starts_with("dead") {
        "dead".to_string()
    } else if lower.contains("removal") || lower.contains("removing") {
        "removing".to_string()
    } else {
        "unknown".to_string()
    }
}

fn get_container_name(container: &Value) -> String {
    container
        .get("Names")
        .and_then(|n| n.as_str())
        .unwrap_or("")
        .replace('/', "")
        .trim()
        .to_string()
}

fn get_container_id(container: &Value) -> String {
    container
        .get("ID")
        .and_then(|id| id.as_str())
        .unwrap_or("")
        .to_string()
}

fn get_container_status(container: &Value) -> String {
    container
        .get("Status")
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .to_string()
}

fn find_stats_for_container<'a>(
    stats: &'a [ContainerStats],
    container_id: &str,
    container_name: &str,
) -> Option<&'a ContainerStats> {
    if !container_id.is_empty() {
        let id_lower = container_id.to_ascii_lowercase();
        for stat in stats {
            if stat.id.is_empty() {
                continue;
            }
            let stat_id_lower = stat.id.to_ascii_lowercase();
            if stat_id_lower == id_lower
                || id_lower.starts_with(&stat_id_lower)
                || stat_id_lower.starts_with(&id_lower)
            {
                return Some(stat);
            }
        }
    }

    if !container_name.is_empty() {
        stats.iter().find(|s| s.name == container_name)
    } else {
        None
    }
}

// ─── Aggregation ──────────────────────────────────────────────────────────

fn aggregate_containers(containers: &[Value], stats: &[ContainerStats]) -> Value {
    let mut state_counts: HashMap<String, usize> = HashMap::new();
    for s in &[
        "created",
        "running",
        "paused",
        "restarting",
        "exited",
        "dead",
        "removing",
        "unknown",
    ] {
        state_counts.insert(s.to_string(), 0);
    }

    let mut container_details = Vec::with_capacity(containers.len());

    let mut cpu_percent_sum = 0.0;
    let mut memory_percent_sum = 0.0;
    let mut memory_usage_total = 0u64;
    let mut memory_limit_total = 0u64;
    let mut network_rx_total = 0u64;
    let mut network_tx_total = 0u64;
    let mut block_read_total = 0u64;
    let mut block_write_total = 0u64;
    let mut pids_total = 0u64;
    let mut reporting = 0u64;

    for c in containers {
        let state = get_container_state(c);
        *state_counts.entry(state.clone()).or_insert(0) += 1;

        let health = c
            .get("Health")
            .and_then(|h| h.as_str())
            .unwrap_or("")
            .to_string();
        let restart_count: u64 = c
            .get("RestartCount")
            .and_then(|r| r.as_str())
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let exit_code: i64 = c
            .get("ExitCode")
            .and_then(|e| e.as_str())
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let ports = c
            .get("Ports")
            .and_then(|p| p.as_str())
            .unwrap_or("")
            .to_string();
        let image = c
            .get("Image")
            .and_then(|i| i.as_str())
            .unwrap_or("")
            .to_string();
        let command = c
            .get("Command")
            .and_then(|cmd| cmd.as_str())
            .unwrap_or("")
            .to_string();
        let created = c
            .get("CreatedAt")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string();
        let mounts = c
            .get("Mounts")
            .and_then(|m| m.as_str())
            .unwrap_or("")
            .to_string();
        let networks = c
            .get("Networks")
            .and_then(|n| n.as_str())
            .unwrap_or("")
            .to_string();
        let labels_raw = c
            .get("Labels")
            .and_then(|l| l.as_str())
            .unwrap_or("")
            .to_string();
        let platform = c
            .get("Platform")
            .and_then(|p| p.as_str())
            .unwrap_or("")
            .to_string();

        let mut detail = json!({
            "id": get_container_id(c),
            "name": get_container_name(c),
            "state": state,
            "status": get_container_status(c),
            "health": health,
            "restart_count": restart_count,
            "exit_code": exit_code,
            "image": image,
            "command": command,
            "created_at": created,
            "ports": ports,
            "mounts": mounts,
            "networks": networks,
            "labels": labels_raw,
            "platform": platform,
        });

        if let Some(stat) = find_stats_for_container(
            stats,
            detail["id"].as_str().unwrap_or(""),
            detail["name"].as_str().unwrap_or(""),
        ) {
            if let Some(obj) = detail.as_object_mut() {
                obj.insert("cpu_percent".to_string(), json!(stat.cpu_percent));
                obj.insert(
                    "memory_usage_bytes".to_string(),
                    json!(stat.memory_usage_bytes),
                );
                obj.insert(
                    "memory_limit_bytes".to_string(),
                    json!(stat.memory_limit_bytes),
                );
                obj.insert("memory_percent".to_string(), json!(stat.memory_percent));
                obj.insert("network_rx_bytes".to_string(), json!(stat.network_rx_bytes));
                obj.insert("network_tx_bytes".to_string(), json!(stat.network_tx_bytes));
                obj.insert("block_read_bytes".to_string(), json!(stat.block_read_bytes));
                obj.insert(
                    "block_write_bytes".to_string(),
                    json!(stat.block_write_bytes),
                );
                obj.insert("pids".to_string(), json!(stat.pids));
            }

            cpu_percent_sum += stat.cpu_percent;
            memory_percent_sum += stat.memory_percent;
            memory_usage_total += stat.memory_usage_bytes;
            memory_limit_total += stat.memory_limit_bytes;
            network_rx_total += stat.network_rx_bytes;
            network_tx_total += stat.network_tx_bytes;
            block_read_total += stat.block_read_bytes;
            block_write_total += stat.block_write_bytes;
            pids_total += stat.pids;
            reporting += 1;
        } else if let Some(obj) = detail.as_object_mut() {
            obj.insert("cpu_percent".to_string(), Value::Null);
            obj.insert("memory_usage_bytes".to_string(), Value::Null);
            obj.insert("memory_limit_bytes".to_string(), Value::Null);
            obj.insert("memory_percent".to_string(), Value::Null);
            obj.insert("network_rx_bytes".to_string(), Value::Null);
            obj.insert("network_tx_bytes".to_string(), Value::Null);
            obj.insert("block_read_bytes".to_string(), Value::Null);
            obj.insert("block_write_bytes".to_string(), Value::Null);
            obj.insert("pids".to_string(), Value::Null);
        }

        container_details.push(detail);
    }

    let resource_totals = if reporting > 0 {
        json!({
            "containers_reporting": reporting,
            "cpu_percent_sum": cpu_percent_sum,
            "cpu_percent_avg": cpu_percent_sum / reporting as f64,
            "memory_usage_bytes_sum": memory_usage_total,
            "memory_limit_bytes_sum": memory_limit_total,
            "memory_percent_avg": memory_percent_sum / reporting as f64,
            "network_rx_bytes_sum": network_rx_total,
            "network_tx_bytes_sum": network_tx_total,
            "block_read_bytes_sum": block_read_total,
            "block_write_bytes_sum": block_write_total,
            "pids_sum": pids_total,
        })
    } else {
        Value::Null
    };

    json!({
        "total_containers": containers.len(),
        "state_counts": state_counts,
        "running_containers": state_counts.get("running").copied().unwrap_or(0),
        "stopped_containers": state_counts.get("exited").copied().unwrap_or(0)
            + state_counts.get("dead").copied().unwrap_or(0),
        "paused_containers": state_counts.get("paused").copied().unwrap_or(0),
        "restarting_containers": state_counts.get("restarting").copied().unwrap_or(0),
        "created_containers": state_counts.get("created").copied().unwrap_or(0),
        "dead_containers": state_counts.get("dead").copied().unwrap_or(0),
        "removing_containers": state_counts.get("removing").copied().unwrap_or(0),
        "unknown_containers": state_counts.get("unknown").copied().unwrap_or(0),
        "containers": container_details,
        "resource_totals": resource_totals,
    })
}

// ─── Log emission with fixed lock pattern ─────────────────────────────────

impl DockerCollector {
    async fn emit_state_change_logs(&self, containers: &[Value]) {
        let log_engine = match &self.log_engine {
            Some(e) => e,
            None => return,
        };

        // BUILD current states WITHOUT holding prev_states lock
        let current_states: HashMap<String, ContainerState> = containers
            .iter()
            .map(|c| {
                let id = get_container_id(c);
                let name = get_container_name(c);
                let state = get_container_state(c);
                let status = get_container_status(c);
                (
                    id.clone(),
                    ContainerState {
                        id,
                        name,
                        state,
                        status,
                    },
                )
            })
            .collect();

        // LOCK: only for comparing and swapping prev states
        let diffs: Vec<LogAction> = {
            let mut prev = self.prev_states.lock().await;

            let mut actions = Vec::new();

            for (cid, cur) in &current_states {
                match prev.get(cid) {
                    Some(prev_state) if prev_state.state != cur.state => {
                        actions.push(LogAction::StateChange {
                            cid: cid.clone(),
                            name: cur.name.clone(),
                            status: cur.status.clone(),
                            old_state: prev_state.state.clone(),
                            new_state: cur.state.clone(),
                        });
                    }
                    None => {
                        actions.push(LogAction::NewContainer {
                            cid: cid.clone(),
                            name: cur.name.clone(),
                            state: cur.state.clone(),
                            status: cur.status.clone(),
                        });
                    }
                    _ => {}
                }
            }

            for (cid, prev_state) in prev.iter() {
                if !current_states.contains_key(cid) {
                    actions.push(LogAction::Removed {
                        cid: cid.clone(),
                        name: prev_state.name.clone(),
                    });
                }
            }

            *prev = current_states;
            actions
        }; // Lock released here — log_engine calls happen OUTSIDE the lock

        // EMIT logs without holding any lock
        if diffs.is_empty() {
            debug!("[docker] no state changes detected");
            return;
        }

        info!("[docker] {} state change(s) detected", diffs.len());
        let _ = log_engine
            .info(
                "docker_engine",
                &format!("{} state change(s) detected", diffs.len()),
            )
            .await;

        for action in diffs {
            match action {
                LogAction::StateChange {
                    cid,
                    name,
                    status,
                    old_state,
                    new_state,
                } => {
                    let short_id = &cid[..cid.len().min(12)];
                    let msg = format!("Container {name} ({short_id}) state changed: {old_state} -> {new_state} ({status})");
                    let (severity, event_type) = classify_state_change(&new_state, &status);
                    if let Err(e) = log_engine
                        .log_event("docker", severity, event_type, &msg)
                        .await
                    {
                        warn!("[docker] log_event failed for state change: {e}");
                        let _ = log_engine
                            .warn("docker_engine", &format!("log_event failed: {e}"))
                            .await;
                    }
                }
                LogAction::NewContainer {
                    cid,
                    name,
                    state,
                    status,
                } => {
                    let short_id = &cid[..cid.len().min(12)];
                    let msg = format!(
                        "New container detected: {name} ({short_id}) — {status} (state={state})"
                    );
                    if let Err(e) = log_engine
                        .log_event("docker", "Info", "container_created", &msg)
                        .await
                    {
                        warn!("[docker] log_event failed for new container: {e}");
                    }
                }
                LogAction::Removed { cid, name } => {
                    let short_id = &cid[..cid.len().min(12)];
                    let msg = format!("Container removed: {name} ({short_id})");
                    if let Err(e) = log_engine
                        .log_event("docker", "Info", "container_removed", &msg)
                        .await
                    {
                        warn!("[docker] log_event failed for removal: {e}");
                    }
                }
            }
        }
    }
}

enum LogAction {
    StateChange {
        cid: String,
        name: String,
        status: String,
        old_state: String,
        new_state: String,
    },
    NewContainer {
        cid: String,
        name: String,
        state: String,
        status: String,
    },
    Removed {
        cid: String,
        name: String,
    },
}

fn classify_state_change<'a>(state: &str, status: &str) -> (&'a str, &'a str) {
    match state {
        "running" => ("Info", "container_start"),
        "exited" | "dead" if status.contains("(0)") => ("Info", "container_stopped"),
        "exited" | "dead" => ("Error", "container_died"),
        "restarting" => ("Warning", "container_restart"),
        "created" => ("Info", "container_created"),
        "paused" => ("Warning", "container_paused"),
        "removing" => ("Warning", "container_removing"),
        _ => ("Info", "container_state_change"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_all_states() {
        let containers = vec![
            json!({"State": "running", "Names": "web", "ID": "abc", "Status": "Up 2 hours", "RestartCount": "0", "ExitCode": "", "Image": "nginx", "Command": "", "CreatedAt": "", "Ports": "", "Mounts": "", "Networks": "", "Labels": "", "Platform": ""}),
            json!({"State": "exited",  "Names": "db", "ID": "def", "Status": "Exited (0) 1 hour ago", "RestartCount": "2", "ExitCode": "0", "Image": "postgres", "Command": "", "CreatedAt": "", "Ports": "", "Mounts": "", "Networks": "", "Labels": "", "Platform": ""}),
            json!({"State": "running", "Names": "proxy", "ID": "ghi", "Status": "Up 30 minutes", "RestartCount": "1", "ExitCode": "", "Image": "haproxy", "Command": "", "CreatedAt": "", "Ports": "", "Mounts": "", "Networks": "", "Labels": "", "Platform": ""}),
            json!({"State": "restarting", "Names": "broken", "ID": "jkl", "Status": "Restarting (1) 5 seconds ago", "RestartCount": "5", "ExitCode": "1", "Image": "alpine", "Command": "", "CreatedAt": "", "Ports": "", "Mounts": "", "Networks": "", "Labels": "", "Platform": ""}),
            json!({"State": "paused", "Names": "paused-app", "ID": "mno", "Status": "Paused", "RestartCount": "0", "ExitCode": "", "Image": "ubuntu", "Command": "", "CreatedAt": "", "Ports": "", "Mounts": "", "Networks": "", "Labels": "", "Platform": ""}),
            json!({"State": "created", "Names": "new-app", "ID": "pqr", "Status": "Created", "RestartCount": "0", "ExitCode": "", "Image": "node", "Command": "", "CreatedAt": "", "Ports": "", "Mounts": "", "Networks": "", "Labels": "", "Platform": ""}),
            json!({"State": "dead", "Names": "dead-app", "ID": "stu", "Status": "Dead", "RestartCount": "10", "ExitCode": "137", "Image": "redis", "Command": "", "CreatedAt": "", "Ports": "", "Mounts": "", "Networks": "", "Labels": "", "Platform": ""}),
        ];
        let v = aggregate_containers(&containers, &[]);
        assert_eq!(v["total_containers"].as_u64().unwrap(), 7);
        assert_eq!(v["state_counts"]["running"].as_u64().unwrap(), 2);
        assert_eq!(v["state_counts"]["exited"].as_u64().unwrap(), 1);
        assert_eq!(v["state_counts"]["restarting"].as_u64().unwrap(), 1);
        assert_eq!(v["state_counts"]["paused"].as_u64().unwrap(), 1);
        assert_eq!(v["state_counts"]["created"].as_u64().unwrap(), 1);
        assert_eq!(v["state_counts"]["dead"].as_u64().unwrap(), 1);
    }

    #[test]
    fn empty_list_produces_zeros() {
        let v = aggregate_containers(&[], &[]);
        assert_eq!(v["total_containers"].as_u64().unwrap(), 0);
        assert_eq!(v["state_counts"]["running"].as_u64().unwrap(), 0);
    }

    #[test]
    fn container_details_include_all_fields() {
        let containers = vec![
            json!({"State": "running", "Names": "web", "ID": "abc123", "Status": "Up 2 hours", "RestartCount": "0", "ExitCode": "", "Image": "nginx:latest", "Command": "\"nginx -g 'daemon off;'\"", "CreatedAt": "2024-01-01 00:00:00", "Ports": "0.0.0.0:80->80/tcp", "Mounts": "/data", "Networks": "bridge", "Labels": "com.docker.compose.project=test", "Platform": "linux"}),
        ];
        let v = aggregate_containers(&containers, &[]);
        let c = &v["containers"][0];
        assert_eq!(c["id"], "abc123");
        assert_eq!(c["name"], "web");
        assert_eq!(c["state"], "running");
        assert_eq!(c["image"], "nginx:latest");
        assert_eq!(c["ports"], "0.0.0.0:80->80/tcp");
    }

    #[test]
    fn parse_state_from_status_variants() {
        assert_eq!(parse_state_from_status("Up 2 hours"), "running");
        assert_eq!(parse_state_from_status("Up 2 days"), "running");
        assert_eq!(parse_state_from_status("Exited (0) 1 hour ago"), "exited");
        assert_eq!(
            parse_state_from_status("Exited (137) 5 minutes ago"),
            "exited"
        );
        assert_eq!(
            parse_state_from_status("Restarting (1) 5 seconds ago"),
            "restarting"
        );
        assert_eq!(parse_state_from_status("Paused"), "paused");
        assert_eq!(parse_state_from_status("Created"), "created");
        assert_eq!(parse_state_from_status("Dead"), "dead");
        assert_eq!(parse_state_from_status("Removal In Progress"), "removing");
        assert_eq!(parse_state_from_status("Some garbage"), "unknown");
    }

    #[test]
    fn get_container_state_prefers_state_field() {
        let c = json!({"State": "running", "Status": "Up 2 hours"});
        assert_eq!(get_container_state(&c), "running");
    }

    #[test]
    fn get_container_state_falls_back_to_status() {
        let c = json!({"Status": "Exited (0) 1 hour ago"});
        assert_eq!(get_container_state(&c), "exited");
    }

    #[test]
    fn get_container_state_unknown_when_both_missing() {
        let c = json!({});
        assert_eq!(get_container_state(&c), "unknown");
    }

    #[test]
    fn parse_byte_quantity_handles_common_units() {
        assert_eq!(parse_byte_quantity("1KiB").unwrap(), 1024);
        assert_eq!(parse_byte_quantity("1MiB").unwrap(), 1024_u64.pow(2));
        assert_eq!(parse_byte_quantity("1GiB").unwrap(), 1024_u64.pow(3));
        assert_eq!(parse_byte_quantity("1MB").unwrap(), 1_000_000);
        assert_eq!(parse_byte_quantity("1.5kB").unwrap(), 1500);
        assert_eq!(parse_byte_quantity("0B").unwrap(), 0);
    }

    #[test]
    fn aggregate_containers_merges_stats() {
        let containers = vec![json!({
            "State": "running",
            "Names": "web",
            "ID": "abcdef1234567890",
            "Status": "Up",
            "RestartCount": "0",
            "ExitCode": "0",
            "Image": "nginx",
            "Command": "",
            "CreatedAt": "",
            "Ports": "",
            "Mounts": "",
            "Networks": "",
            "Labels": "",
            "Platform": "linux",
        })];

        let stats = vec![ContainerStats {
            id: "abcdef123456".to_string(),
            name: "web".to_string(),
            cpu_percent: 12.5,
            memory_usage_bytes: 2048,
            memory_limit_bytes: 4096,
            memory_percent: 50.0,
            network_rx_bytes: 1000,
            network_tx_bytes: 2000,
            block_read_bytes: 3000,
            block_write_bytes: 4000,
            pids: 6,
        }];

        let v = aggregate_containers(&containers, &stats);
        let totals = v["resource_totals"].as_object().unwrap();
        assert_eq!(totals["containers_reporting"].as_u64().unwrap(), 1);
        assert!((totals["cpu_percent_sum"].as_f64().unwrap() - 12.5).abs() < f64::EPSILON);
        let detail = &v["containers"][0];
        assert_eq!(detail["cpu_percent"].as_f64().unwrap(), 12.5);
        assert_eq!(detail["memory_usage_bytes"].as_u64().unwrap(), 2048);
        assert_eq!(detail["network_tx_bytes"].as_u64().unwrap(), 2000);
    }

    #[test]
    fn normalize_inspect_basic() {
        let input = vec![json!({
            "Id": "abc123",
            "Name": "/web",
            "Config": {
                "Image": "nginx:latest",
                "Cmd": ["nginx", "-g", "daemon off;"],
                "Labels": {"app": "web"}
            },
            "Created": "2024-01-01T00:00:00Z",
            "State": {
                "Status": "running",
                "Running": true,
                "ExitCode": 0,
                "RestartCount": 1,
                "StartedAt": "2024-01-01T00:00:00Z",
                "FinishedAt": "0001-01-01T00:00:00Z",
                "Health": {"Status": "healthy"}
            },
            "NetworkSettings": {
                "Ports": {"80/tcp": null},
                "Networks": {"bridge": {}}
            },
            "Mounts": [{"Source": "/data"}],
            "Platform": "linux"
        })];
        let normalized = normalize_inspect_output(input);
        assert_eq!(normalized.len(), 1);
        let n = &normalized[0];
        assert_eq!(n["Names"], "web");
        assert_eq!(n["State"], "running");
        assert_eq!(n["RestartCount"], "1");
        assert_eq!(n["Health"], "healthy");
    }
}
