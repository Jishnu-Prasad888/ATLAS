use anyhow::Result;
use async_trait::async_trait;
use chrono::Utc;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{debug, info, warn};

use crate::config::CollectorFlags;

use super::trait_collector::Collector;

const INVENTORY_INTERVAL: u64 = 30;
const CPU_INTERVAL: u64 = 5;
const MEMORY_INTERVAL: u64 = 5;
const NETWORK_INTERVAL: u64 = 5;
const DISK_INTERVAL: u64 = 10;
const LOGS_TAIL: usize = 50;
const EVENTS_WINDOW_SECS: u64 = 60;
const HEALTH_INTERVAL: u64 = 10;
const TOPOLOGY_INTERVAL: u64 = 60;
const SECURITY_INTERVAL: u64 = 60;
const IMAGES_INTERVAL: u64 = 300;
const PROCESS_INTERVAL: u64 = 15;
const FILESYSTEM_INTERVAL: u64 = 60;

// ─── Data model (mirrors TypeScript DockerData interface) ─────────────────

#[derive(Debug, Serialize)]
struct DockerDataPayload {
    generated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    collector_disabled: Option<bool>,
    summary: Value,
    inventory: Value,
    lifecycle: Value,
    metrics: MetricsBlock,
    filesystem: Value,
    processes: Value,
    logs: Value,
    health: Value,
    topology: Value,
    security: Value,
    images: Value,
    host: Value,
    cgroups: Value,
}

#[derive(Debug, Serialize)]
struct MetricsBlock {
    cpu: Value,
    memory: Value,
    disk: Value,
    network: Value,
}

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
    last_event_ts: Arc<Mutex<Option<i64>>>,
    last_inventory_ts: Arc<Mutex<Option<i64>>>,
    last_images_ts: Arc<Mutex<Option<i64>>>,
}

impl DockerCollector {
    pub fn new(flags: CollectorFlags) -> Self {
        Self {
            log_engine: None,
            prev_states: Arc::new(Mutex::new(HashMap::new())),
            flags,
            first_collect: Arc::new(Mutex::new(true)),
            last_event_ts: Arc::new(Mutex::new(None)),
            last_inventory_ts: Arc::new(Mutex::new(None)),
            last_images_ts: Arc::new(Mutex::new(None)),
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
            last_event_ts: Arc::new(Mutex::new(None)),
            last_inventory_ts: Arc::new(Mutex::new(None)),
            last_images_ts: Arc::new(Mutex::new(None)),
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

// ─── Disabled payload helper ───────────────────────────────────────────────

fn disabled_payload() -> Value {
    let now = Utc::now().to_rfc3339();
    json!({
        "generated_at": now,
        "collector_disabled": true,
        "summary": { "total_containers": 0, "state_counts": {}, "running": 0, "stopped": 0, "paused": 0, "restarting": 0, "failures": 0, "resource_totals": null, "last_event": null },
        "inventory": { "refresh_interval_seconds": INVENTORY_INTERVAL, "containers": [] },
        "lifecycle": { "window_seconds": EVENTS_WINDOW_SECS, "events": [] },
        "metrics": { "cpu": { "interval_seconds": CPU_INTERVAL, "samples": [] }, "memory": { "interval_seconds": MEMORY_INTERVAL, "samples": [] }, "disk": { "interval_seconds": DISK_INTERVAL, "samples": [] }, "network": { "interval_seconds": NETWORK_INTERVAL, "samples": [] } },
        "filesystem": { "interval_seconds": FILESYSTEM_INTERVAL, "samples": [] },
        "processes": { "interval_seconds": PROCESS_INTERVAL, "samples": [] },
        "logs": { "samples": [], "streaming": false },
        "health": { "interval_seconds": HEALTH_INTERVAL, "statuses": [] },
        "topology": { "interval_seconds": TOPOLOGY_INTERVAL, "samples": [] },
        "security": { "interval_seconds": SECURITY_INTERVAL, "profiles": [] },
        "images": { "interval_seconds": IMAGES_INTERVAL, "images": [] },
        "host": { "interval_seconds": 5, "metrics": null },
        "cgroups": { "mappings": [] }
    })
}

#[async_trait]
impl Collector for DockerCollector {
    fn name(&self) -> &'static str {
        "docker"
    }

    async fn collect(&self) -> Result<Value> {
        let flags = self.flags.read().await;
        if !flags.get("docker").copied().unwrap_or(true) {
            return Ok(disabled_payload());
        }
        drop(flags);

        let now = Utc::now();
        let now_ts = now.timestamp();

        // ── raw inspect ──────────────────────────────────────────────────
        let raw_inspect = query_raw_inspect().await.unwrap_or_default();
        let containers_normalized = normalize_inspect_output(raw_inspect.clone());

        // ── inventory ────────────────────────────────────────────────────
        let inventory_items: Vec<Value> = raw_inspect
            .iter()
            .map(|c| build_inventory_item(c))
            .collect();

        // ── stats ────────────────────────────────────────────────────────
        let stats = query_docker_stats().await.unwrap_or_default();

        // ── events (poll for last 60s) ───────────────────────────────────
        let events = {
            let mut last_ts = self.last_event_ts.lock().await;
            let since = last_ts.unwrap_or(now_ts - EVENTS_WINDOW_SECS as i64);
            let result = query_docker_events(since, now_ts).await;
            *last_ts = Some(now_ts);
            result.unwrap_or_default()
        };

        // ── processes ────────────────────────────────────────────────────
        let process_samples = query_docker_processes(&inventory_items).await;

        // ── logs ─────────────────────────────────────────────────────────
        let log_samples = query_docker_logs(&inventory_items).await;

        // ── images (throttled to 300s) ───────────────────────────────────
        let images_val = {
            let mut last_img_ts = self.last_images_ts.lock().await;
            if last_img_ts
                .map(|t| now_ts - t < IMAGES_INTERVAL as i64)
                .unwrap_or(false)
            {
                json!({ "interval_seconds": IMAGES_INTERVAL, "images": [] })
            } else {
                let result = query_docker_images().await.unwrap_or_default();
                *last_img_ts = Some(now_ts);
                json!({ "interval_seconds": IMAGES_INTERVAL, "images": result })
            }
        };

        // ── host metrics ─────────────────────────────────────────────────
        let host_val = collect_host_metrics();
        let cgroup_val = collect_cgroup_mappings(&raw_inspect);

        // ── assemble payload ────────────────────────────────────────────
        let now_str = now.to_rfc3339();
        let payload = build_payload(
            &now_str,
            &containers_normalized,
            &inventory_items,
            &raw_inspect,
            &stats,
            &events,
            &process_samples,
            &log_samples,
            &images_val,
            &host_val,
            &cgroup_val,
        );

        // ── state change logs ───────────────────────────────────────────
        self.emit_state_change_logs(&containers_normalized).await;

        Ok(payload)
    }
}

// ─── Docker CLI helpers ────────────────────────────────────────────────────

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

async fn query_raw_inspect() -> Result<Vec<Value>> {
    let (ids_out, _) = run_cmd(&["ps", "-aq"]).await?;
    let ids: Vec<&str> = ids_out.lines().filter(|l| !l.is_empty()).collect();
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let mut args = vec!["inspect"];
    args.extend(ids.iter().copied());
    let (inspect_out, _) = run_cmd(&args).await?;
    let containers: Vec<Value> = serde_json::from_str(&inspect_out)
        .map_err(|e| anyhow::anyhow!("Failed to parse docker inspect JSON: {e}"))?;
    Ok(containers)
}

fn normalize_inspect_output(inspected: Vec<Value>) -> Vec<Value> {
    inspected
        .into_iter()
        .map(|c| {
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
            let ports = c["NetworkSettings"]["Ports"]
                .as_object()
                .map(|p| p.keys().cloned().collect::<Vec<_>>().join(", "))
                .unwrap_or_default();
            let mounts = c["Mounts"]
                .as_array()
                .map(|m| {
                    m.iter()
                        .filter_map(|m| m["Source"].as_str())
                        .collect::<Vec<_>>()
                        .join("; ")
                })
                .unwrap_or_default();
            let networks = c["NetworkSettings"]["Networks"]
                .as_object()
                .map(|n| n.keys().cloned().collect::<Vec<_>>().join(", "))
                .unwrap_or_default();
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
    let _started = state["StartedAt"].as_str().unwrap_or("");
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

// ─── Build rich inventory item from raw inspect ────────────────────────────

fn build_inventory_item(c: &Value) -> Value {
    let cid = c["Id"].as_str().unwrap_or("").to_string();
    let name = c["Name"]
        .as_str()
        .unwrap_or("")
        .trim_start_matches('/')
        .to_string();
    let image = c["Config"]["Image"].as_str().unwrap_or("").to_string();
    let image_id = c["Image"].as_str().unwrap_or("").to_string();
    let created_at = normalize_ts(c["Created"].as_str());
    let state_obj = &c["State"];
    let started_at = normalize_ts(state_obj["StartedAt"].as_str());
    let finished_at = normalize_ts(state_obj["FinishedAt"].as_str());
    let state = state_obj["Status"]
        .as_str()
        .unwrap_or("unknown")
        .to_lowercase();
    let status = build_inspect_status_str(state_obj);
    let restart_count = state_obj["RestartCount"].as_i64().unwrap_or(0);
    let pid_val = state_obj["Pid"].as_i64().unwrap_or(0);

    let labels = c["Config"]["Labels"]
        .as_object()
        .map(|obj| {
            let mut m = serde_json::Map::new();
            for (k, v) in obj {
                m.insert(k.clone(), v.as_str().unwrap_or("").to_string().into());
            }
            Value::Object(m)
        })
        .unwrap_or(json!({}));

    let env: Vec<Value> = c["Config"]["Env"]
        .as_array()
        .map(|a| a.iter().map(|v| json!(v.as_str().unwrap_or(""))).collect())
        .unwrap_or_default();

    let hostname = c["Config"]["Hostname"].as_str().unwrap_or("").to_string();
    let platform = c["Platform"].as_str().unwrap_or("").to_string();
    let runtime = c["HostConfig"]["Runtime"]
        .as_str()
        .unwrap_or("")
        .to_string();

    json!({
        "container_id": cid,
        "name": name,
        "image": image,
        "image_id": image_id,
        "created_at": created_at,
        "started_at": started_at,
        "finished_at": finished_at,
        "state": state,
        "status": status,
        "restart_count": restart_count,
        "labels": labels,
        "env": env,
        "hostname": hostname,
        "platform": platform,
        "runtime": runtime,
        "pid": if pid_val > 0 { json!(pid_val) } else { Value::Null },
    })
}

fn normalize_ts(raw: Option<&str>) -> Value {
    match raw {
        Some(s) if !s.is_empty() && !s.starts_with("0001-01-01") => json!(s),
        _ => Value::Null,
    }
}

// ─── Stats parsing ─────────────────────────────────────────────────────────

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

    let pids = parse_u64_value(value.get("PIDs").unwrap_or(&Value::Null)).unwrap_or(0);

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

// ─── Events ────────────────────────────────────────────────────────────────

async fn query_docker_events(since: i64, until: i64) -> Result<Vec<Value>> {
    let (stdout, _) = run_cmd(&[
        "events",
        "--since",
        &since.to_string(),
        "--until",
        &until.to_string(),
        "--format",
        "{{json .}}",
    ])
    .await?;

    let events: Vec<Value> = stdout
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();

    Ok(events)
}

fn build_events_array(raw_events: &[Value]) -> Value {
    let items: Vec<Value> = raw_events
        .iter()
        .map(|e| {
            json!({
                "timestamp": e["time"].as_i64()
                    .and_then(|t| chrono::DateTime::from_timestamp(t, 0))
                    .map(|dt| dt.to_rfc3339())
                    .unwrap_or_else(|| Utc::now().to_rfc3339()),
                "container_id": e["id"].as_str().unwrap_or("").to_string(),
                "event": e["action"].as_str().unwrap_or("").to_string(),
                "actor": e["actor"]["attributes"]["name"].as_str()
                    .or_else(|| e["id"].as_str())
                    .unwrap_or("")
                    .to_string(),
                "attributes": e["actor"]["attributes"].as_object()
                    .map(|attrs| {
                        let mut m = serde_json::Map::new();
                        for (k, v) in attrs {
                            m.insert(k.clone(), v.clone());
                        }
                        Value::Object(m)
                    })
                    .unwrap_or(json!({}))
            })
        })
        .collect();

    json!(items)
}

// ─── Processes via `docker top` ────────────────────────────────────────────

async fn query_docker_processes(containers: &[Value]) -> Vec<Value> {
    let mut samples = Vec::new();
    for c in containers {
        let cid = c["container_id"].as_str().unwrap_or("");
        if cid.is_empty() {
            continue;
        }
        match run_cmd(&["top", cid, "axo", "pid,ppid,pcpu,rss,state,cmd"]).await {
            Ok((stdout, _)) => {
                let lines: Vec<&str> = stdout.lines().filter(|l| !l.is_empty()).collect();
                if lines.len() < 2 {
                    continue;
                }
                let processes: Vec<Value> = lines[1..]
                    .iter()
                    .filter_map(|line| {
                        let fields: Vec<&str> = line.split_whitespace().collect();
                        if fields.len() < 6 { return None; }
                        Some(json!({
                            "pid": fields[0].parse::<i64>().unwrap_or(0),
                            "ppid": fields[1].parse::<i64>().unwrap_or(0),
                            "cpu_percent": fields[2].trim_end_matches('%').parse::<f64>().unwrap_or(0.0),
                            "memory_bytes": (fields[3].parse::<f64>().unwrap_or(0.0) * 1024.0) as u64,
                            "state": fields[4],
                            "command": fields[5..].join(" "),
                        }))
                    })
                    .collect();

                samples.push(json!({
                    "container_id": cid,
                    "processes": processes,
                    "capped": false,
                }));
            }
            Err(e) => {
                debug!("[docker] top failed for {cid}: {e}");
            }
        }
    }
    samples
}

// ─── Logs via `docker logs --tail` ─────────────────────────────────────────

async fn query_docker_logs(containers: &[Value]) -> Vec<Value> {
    let mut samples = Vec::new();
    for c in containers {
        let cid = c["container_id"].as_str().unwrap_or("");
        if cid.is_empty() {
            continue;
        }
        match run_cmd(&[
            "logs",
            "--tail",
            &LOGS_TAIL.to_string(),
            "--timestamps",
            cid,
        ])
        .await
        {
            Ok((stdout, _)) => {
                let mut entries = Vec::new();
                for line in stdout.lines().filter(|l| !l.is_empty()) {
                    let timestamp = if line.len() > 30 {
                        let ts_end = line[..30].rfind(' ').unwrap_or(30);
                        line[..ts_end].trim().to_string()
                    } else {
                        String::new()
                    };
                    let message = if line.len() > 31 {
                        line[31..].to_string()
                    } else {
                        line.to_string()
                    };
                    entries.push(json!({
                        "timestamp": timestamp,
                        "stream": "stdout",
                        "message": message,
                    }));
                }
                samples.push(json!({
                    "container_id": cid,
                    "tail_limit": LOGS_TAIL,
                    "entries": entries,
                }));
            }
            Err(e) => {
                debug!("[docker] logs failed for {cid}: {e}");
            }
        }
    }
    samples
}

// ─── Images via `docker images` ────────────────────────────────────────────

async fn query_docker_images() -> Result<Value> {
    let (stdout, _) = run_cmd(&["images", "--format", "{{json .}}", "--no-trunc"]).await?;

    let images: Vec<Value> = stdout
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(|l| serde_json::from_str(l).ok())
        .map(|img: Value| {
            let size_bytes = parse_image_size(img["Size"].as_str().unwrap_or("0"));
            json!({
                "image_id": img["ID"].as_str().unwrap_or("").to_string(),
                "repo_tags": img["Repository"].as_str()
                    .zip(img["Tag"].as_str())
                    .map(|(r, t)| if t == "<none>" { vec![] } else { vec![format!("{}:{}", r, t)] })
                    .unwrap_or_default(),
                "repo_digests": img["Digest"].as_str()
                    .map(|d| if d == "<none>" { vec![] } else { vec![d.to_string()] })
                    .unwrap_or_default(),
                "size": size_bytes,
                "created": img["CreatedAt"].as_str().unwrap_or("").to_string(),
                "architecture": "",
                "os": "",
            })
        })
        .collect();

    Ok(json!({
        "interval_seconds": IMAGES_INTERVAL,
        "images": images,
    }))
}

fn parse_image_size(s: &str) -> u64 {
    let s = s.trim();
    if s.is_empty() || s == "0B" {
        return 0;
    }
    let (num_part, unit_part) = s.split_at(
        s.chars()
            .position(|c| !c.is_ascii_digit() && c != '.')
            .unwrap_or(s.len()),
    );
    let val = num_part.parse::<f64>().unwrap_or(0.0);
    let unit = unit_part.trim().to_uppercase();
    let mult = match unit.as_str() {
        "B" => 1.0,
        "KB" | "KIB" => 1024.0,
        "MB" | "MIB" => 1024.0_f64.powi(2),
        "GB" | "GIB" => 1024.0_f64.powi(3),
        "TB" | "TIB" => 1024.0_f64.powi(4),
        _ => 1.0,
    };
    (val * mult) as u64
}

// ─── Host metrics via sysinfo + /proc ─────────────────────────────────────

fn collect_host_metrics() -> Value {
    let hostname = std::fs::read_to_string("/proc/sys/kernel/hostname")
        .unwrap_or_default()
        .trim()
        .to_string();

    let (cpu_percent, load_1, load_5, load_15, uptime) = read_proc_stat();
    let (memory_total, memory_used) = read_proc_meminfo();
    let (disk_total, disk_used) = read_disk_usage();

    json!({
        "hostname": hostname,
        "cpu_percent": cpu_percent,
        "memory_total": memory_total,
        "memory_used": memory_used,
        "disk_total": disk_total,
        "disk_used": disk_used,
        "load_1": load_1,
        "load_5": load_5,
        "load_15": load_15,
        "uptime": uptime,
    })
}

fn read_proc_stat() -> (f64, f64, f64, f64, u64) {
    let content = std::fs::read_to_string("/proc/stat").unwrap_or_default();
    let load_content = std::fs::read_to_string("/proc/loadavg").unwrap_or_default();
    let uptime_content = std::fs::read_to_string("/proc/uptime").unwrap_or_default();

    let load_parts: Vec<f64> = load_content
        .split_whitespace()
        .take(3)
        .filter_map(|s| s.parse::<f64>().ok())
        .collect();
    let load_1 = load_parts.first().copied().unwrap_or(0.0);
    let load_5 = load_parts.get(1).copied().unwrap_or(0.0);
    let load_15 = load_parts.get(2).copied().unwrap_or(0.0);

    let uptime = uptime_content
        .split_whitespace()
        .next()
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0) as u64;

    let cpu_line = content.lines().next().unwrap_or("");
    let parts: Vec<&str> = cpu_line.split_whitespace().collect();
    if parts.len() >= 5 {
        let user: u64 = parts[1].parse().unwrap_or(0);
        let nice: u64 = parts[2].parse().unwrap_or(0);
        let system: u64 = parts[3].parse().unwrap_or(0);
        let idle: u64 = parts[4].parse().unwrap_or(0);
        let total = user + nice + system + idle;
        let busy = user + nice + system;
        let pct = if total > 0 {
            (busy as f64 / total as f64) * 100.0
        } else {
            0.0
        };
        (pct, load_1, load_5, load_15, uptime)
    } else {
        (0.0, load_1, load_5, load_15, uptime)
    }
}

fn read_proc_meminfo() -> (u64, u64) {
    let content = std::fs::read_to_string("/proc/meminfo").unwrap_or_default();
    let mut total = 0u64;
    let mut available = 0u64;
    for line in content.lines() {
        if line.starts_with("MemTotal:") {
            total = line
                .split_whitespace()
                .nth(1)
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(0)
                * 1024;
        } else if line.starts_with("MemAvailable:") {
            available = line
                .split_whitespace()
                .nth(1)
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(0)
                * 1024;
        }
    }
    let used = total.saturating_sub(available);
    (total, used)
}

fn read_disk_usage() -> (u64, u64) {
    // Use `df` for a quick aggregate
    match std::process::Command::new("df")
        .args(["-B1", "--total"])
        .output()
    {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if line.starts_with("total") {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 4 {
                        let total = parts[1].parse::<u64>().unwrap_or(0);
                        let used = parts[2].parse::<u64>().unwrap_or(0);
                        return (total, used);
                    }
                }
            }
            (0, 0)
        }
        Err(_) => (0, 0),
    }
}

// ─── cgroup mappings ──────────────────────────────────────────────────────

fn collect_cgroup_mappings(raw_inspect: &[Value]) -> Value {
    let mappings: Vec<Value> = raw_inspect
        .iter()
        .map(|c| {
            let cid = c["Id"].as_str().unwrap_or("").to_string();
            let pid = c["State"]["Pid"].as_i64().unwrap_or(0);
            let cgroup_path = if pid > 0 {
                let path = format!("/proc/{pid}/cgroup");
                std::fs::read_to_string(&path).ok().and_then(|content| {
                    content
                        .lines()
                        .filter_map(|line| line.rsplit(':').next())
                        .map(|s| s.trim().to_string())
                        .find(|s| !s.is_empty())
                })
            } else {
                None
            };
            json!({ "container_id": cid, "cgroup_path": cgroup_path })
        })
        .collect();

    json!({ "mappings": mappings })
}

// ─── Payload assembler ─────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
fn build_payload(
    now_str: &str,
    normalized: &[Value],
    inventory_items: &[Value],
    raw_inspect: &[Value],
    stats: &[ContainerStats],
    events: &[Value],
    process_samples: &[Value],
    log_samples: &[Value],
    images_val: &Value,
    host_val: &Value,
    cgroup_val: &Value,
) -> Value {
    // state counts & summary
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

    let mut running = 0u64;
    let mut stopped = 0u64;
    let mut paused = 0u64;
    let mut restarting = 0u64;
    let mut failures = 0u64;

    for c in normalized {
        let state = get_container_state(c);
        *state_counts.entry(state.clone()).or_insert(0) += 1;
        match state.as_str() {
            "running" => running += 1,
            "exited" | "dead" => {
                stopped += 1;
            }
            "paused" => paused += 1,
            "restarting" => restarting += 1,
            _ => {}
        }
    }

    // per-container detail rows (merged with stats)
    let mut container_details = Vec::with_capacity(normalized.len());
    let mut totals = json!({
        "containers_reporting": 0,
        "cpu_percent_avg": 0.0,
        "memory_percent_avg": 0.0,
        "network_rx_bytes_sum": 0,
        "network_tx_bytes_sum": 0,
        "block_read_bytes_sum": 0,
        "block_write_bytes_sum": 0,
        "pids_sum": 0,
    });

    let mut cpu_sum = 0.0f64;
    let mut mem_sum = 0.0f64;
    let mut mem_usage_sum = 0u64;
    let mut mem_limit_sum = 0u64;
    let mut net_rx_sum = 0u64;
    let mut net_tx_sum = 0u64;
    let mut blk_r_sum = 0u64;
    let mut blk_w_sum = 0u64;
    let mut pids_sum = 0u64;
    let mut reporting = 0u64;

    for c in normalized {
        let cid = get_container_id(c);
        let name = get_container_name(c);
        let state = get_container_state(c);
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
        let labels = c
            .get("Labels")
            .and_then(|l| l.as_str())
            .unwrap_or("")
            .to_string();
        let platform = c
            .get("Platform")
            .and_then(|p| p.as_str())
            .unwrap_or("")
            .to_string();

        if let Some(stat) = find_stats_for_container(stats, &cid, &name) {
            cpu_sum += stat.cpu_percent;
            mem_sum += stat.memory_percent;
            mem_usage_sum += stat.memory_usage_bytes;
            mem_limit_sum += stat.memory_limit_bytes;
            net_rx_sum += stat.network_rx_bytes;
            net_tx_sum += stat.network_tx_bytes;
            blk_r_sum += stat.block_read_bytes;
            blk_w_sum += stat.block_write_bytes;
            pids_sum += stat.pids;
            reporting += 1;
        }

        container_details.push(json!({
            "id": cid,
            "name": name,
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
            "labels": labels,
            "platform": platform,
        }));
    }

    if reporting > 0 {
        totals = json!({
            "containers_reporting": reporting,
            "cpu_percent_sum": cpu_sum,
            "cpu_percent_avg": cpu_sum / reporting as f64,
            "memory_usage_bytes_sum": mem_usage_sum,
            "memory_limit_bytes_sum": mem_limit_sum,
            "memory_percent_avg": mem_sum / reporting as f64,
            "network_rx_bytes_sum": net_rx_sum,
            "network_tx_bytes_sum": net_tx_sum,
            "block_read_bytes_sum": blk_r_sum,
            "block_write_bytes_sum": blk_w_sum,
            "pids_sum": pids_sum,
            "cpu_system_usage_sum": 0,
            "cpu_throttled_periods_sum": 0,
            "cpu_throttled_time_sum": 0,
            "block_read_ops_sum": 0,
            "block_write_ops_sum": 0,
            "memory_failcnt_sum": 0,
        });
    }

    // health statuses from raw inspect
    let health_statuses: Vec<Value> = raw_inspect
        .iter()
        .map(|c| {
            let cid = c["Id"].as_str().unwrap_or("");
            let state = &c["State"];
            let health = &state["Health"];
            let log_entries = health["Log"].as_array();
            let last_log = log_entries.and_then(|logs| logs.last());

            json!({
                "container_id": cid,
                "health_status": health["Status"].as_str().unwrap_or("none").to_string(),
                "failing_streak": health["FailingStreak"].as_u64().unwrap_or(0),
                "last_check": last_log.and_then(|l| {
                    let s = l["End"].as_str().unwrap_or("");
                    if s.is_empty() || s.starts_with("0001") { None } else { Some(s.to_string()) }
                }),
                "last_output": last_log.and_then(|l| {
                    let s = l["Output"].as_str().unwrap_or("");
                    if s.is_empty() { None } else { Some(s.to_string()) }
                }),
            })
        })
        .collect();

    // security profiles from raw inspect
    let security_profiles: Vec<Value> = raw_inspect.iter().map(|c| {
        let cid = c["Id"].as_str().unwrap_or("");
        let hc = &c["HostConfig"];
        let config = &c["Config"];
        let mounts_arr = c["Mounts"].as_array().map(|a| a.clone()).unwrap_or_default();

        let caps: Vec<&str> = hc["CapAdd"].as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str()).collect())
            .unwrap_or_default();
        let seccomp = hc["SecurityOpt"].as_array()
            .and_then(|opts| opts.iter().find_map(|v| {
                let s = v.as_str().unwrap_or("");
                if s.starts_with("seccomp") { Some(s.to_string()) }
                else if s == "no-new-privileges" { Some(s.to_string()) }
                else { None }
            }))
            .unwrap_or_else(|| "default".to_string());
        let docker_sock = mounts_arr.iter().any(|m| {
            m["Source"].as_str().map(|src| src.contains("docker.sock")).unwrap_or(false)
        });

        json!({
            "container_id": cid,
            "privileged": hc["Privileged"].as_bool().unwrap_or(false),
            "readonly_rootfs": hc["ReadonlyRootfs"].as_bool().unwrap_or(false),
            "user": config["User"].as_str().unwrap_or("").to_string(),
            "capabilities": caps,
            "seccomp_profile": seccomp,
            "apparmor_profile": if c["AppArmorProfile"].as_str().unwrap_or("").is_empty() { "default".to_string() } else { c["AppArmorProfile"].as_str().unwrap_or("default").to_string() },
            "host_network": hc["NetworkMode"].as_str().map(|m| m == "host").unwrap_or(false),
            "host_pid": hc["PidMode"].as_str().map(|m| m == "host").unwrap_or(false),
            "docker_socket_mounted": docker_sock,
        })
    }).collect();

    // topology from raw inspect
    let topology_samples: Vec<Value> = raw_inspect.iter().map(|c| {
        let cid = c["Id"].as_str().unwrap_or("");
        let net_settings = &c["NetworkSettings"];
        let networks_obj = net_settings["Networks"].as_object();

        let networks: Vec<Value> = networks_obj.map(|nets| {
            nets.iter().map(|(net_name, ep)| {
                let ports_obj = net_settings["Ports"].as_object();
                let ports: Vec<Value> = ports_obj.map(|p| {
                    p.iter().flat_map(|(key, bindings)| {
                        let parts: Vec<&str> = key.split('/').collect();
                        let private_port = parts.first().and_then(|s| s.parse::<u16>().ok()).unwrap_or(0);
                        let protocol = parts.get(1).copied().unwrap_or("tcp").to_string();
                        bindings.as_array().map(|b| b.iter().map(|binding| {
                            json!({
                                "ip": binding["HostIp"].as_str().map(|s| s.to_string()),
                                "private_port": private_port,
                                "public_port": binding["HostPort"].as_str().and_then(|s| s.parse::<u16>().ok()),
                                "protocol": protocol.clone(),
                            })
                        }).collect::<Vec<_>>()).unwrap_or_else(|| vec![json!({
                            "private_port": private_port, "protocol": protocol.clone()
                        })])
                    }).collect()
                }).unwrap_or_default();

                json!({
                    "network_name": net_name,
                    "ip_address": ep["IPAddress"].as_str().unwrap_or("").to_string(),
                    "gateway": ep["Gateway"].as_str().unwrap_or("").to_string(),
                    "aliases": ep["Aliases"].as_array()
                        .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect::<Vec<_>>())
                        .unwrap_or_default(),
                    "ports": ports,
                })
            }).collect()
        }).unwrap_or_default();

        json!({ "container_id": cid, "networks": networks })
    }).collect();

    // filesystem from raw inspect mounts
    let fs_samples: Vec<Value> = raw_inspect
        .iter()
        .map(|c| {
            let cid = c["Id"].as_str().unwrap_or("");
            let mounts_arr = c["Mounts"]
                .as_array()
                .map(|a| a.clone())
                .unwrap_or_default();
            let volumes: Vec<Value> = mounts_arr
                .iter()
                .map(|m| {
                    json!({
                        "name": m["Name"].as_str().unwrap_or("vol").to_string(),
                        "destination": m["Destination"].as_str().unwrap_or("").to_string(),
                        "source": m["Source"].as_str().map(|s| s.to_string()),
                        "total_bytes": null,
                        "used_bytes": null,
                        "inode_usage": null,
                    })
                })
                .collect();

            json!({
                "container_id": cid,
                "writable_layer_size": c["SizeRw"],
                "total_volume_usage": null,
                "inode_usage": null,
                "volumes": volumes,
            })
        })
        .collect();

    // inventory items (rich version)
    let inventory_val = json!({
        "refresh_interval_seconds": INVENTORY_INTERVAL,
        "containers": inventory_items,
    });

    // lifecycle events
    let lifecycle_val = json!({
        "window_seconds": EVENTS_WINDOW_SECS,
        "events": build_events_array(events),
    });

    // metrics (from docker stats)
    let cpu_samples: Vec<Value> = stats
        .iter()
        .map(|s| {
            json!({
                "container_id": s.id,
                "cpu_total_usage": 0,
                "cpu_system_usage": 0,
                "cpu_online_cores": 0,
                "cpu_percent": s.cpu_percent,
                "cpu_user_time": 0,
                "cpu_kernel_time": 0,
                "cpu_throttled_periods": 0,
                "cpu_throttled_time": 0,
            })
        })
        .collect();

    let mem_samples: Vec<Value> = stats
        .iter()
        .map(|s| {
            json!({
                "container_id": s.id,
                "memory_usage": s.memory_usage_bytes,
                "memory_limit": s.memory_limit_bytes,
                "memory_percent": s.memory_percent,
                "memory_cache": 0,
                "memory_rss": 0,
                "memory_swap": 0,
                "memory_failcnt": 0,
                "oom_events": 0,
            })
        })
        .collect();

    let disk_samples: Vec<Value> = stats
        .iter()
        .map(|s| {
            json!({
                "container_id": s.id,
                "read_bytes": s.block_read_bytes,
                "write_bytes": s.block_write_bytes,
                "read_ops": 0,
                "write_ops": 0,
            })
        })
        .collect();

    let net_samples: Vec<Value> = stats
        .iter()
        .map(|s| {
            json!({
                "container_id": s.id,
                "interfaces": [{
                    "name": "eth0",
                    "rx_bytes": s.network_rx_bytes,
                    "tx_bytes": s.network_tx_bytes,
                    "rx_packets": 0,
                    "tx_packets": 0,
                    "rx_errors": 0,
                    "tx_errors": 0,
                    "rx_dropped": 0,
                    "tx_dropped": 0,
                }],
            })
        })
        .collect();

    let metrics = json!({
        "cpu": { "interval_seconds": CPU_INTERVAL, "samples": cpu_samples },
        "memory": { "interval_seconds": MEMORY_INTERVAL, "samples": mem_samples },
        "disk": { "interval_seconds": DISK_INTERVAL, "samples": disk_samples },
        "network": { "interval_seconds": NETWORK_INTERVAL, "samples": net_samples },
    });

    // host
    let host_val_wrapped = json!({
        "interval_seconds": 5,
        "metrics": host_val,
    });

    // cgroups
    let cgroup_val_wrapped = json!({
        "mappings": cgroup_val["mappings"],
    });

    json!({
        "generated_at": now_str,
        "summary": {
            "total_containers": normalized.len(),
            "state_counts": state_counts,
            "running": running,
            "stopped": stopped,
            "paused": paused,
            "restarting": restarting,
            "failures": failures,
            "last_event": events.first()
                .and_then(|e| e["time"].as_i64())
                .and_then(|t| chrono::DateTime::from_timestamp(t, 0))
                .map(|dt| dt.to_rfc3339()),
            "resource_totals": if reporting > 0 { Some(totals) } else { None },
        },
        "inventory": inventory_val,
        "lifecycle": lifecycle_val,
        "metrics": metrics,
        "filesystem": { "interval_seconds": FILESYSTEM_INTERVAL, "samples": fs_samples },
        "processes": { "interval_seconds": PROCESS_INTERVAL, "samples": process_samples },
        "logs": { "samples": log_samples, "streaming": false },
        "health": { "interval_seconds": HEALTH_INTERVAL, "statuses": health_statuses },
        "topology": { "interval_seconds": TOPOLOGY_INTERVAL, "samples": topology_samples },
        "security": { "interval_seconds": SECURITY_INTERVAL, "profiles": security_profiles },
        "images": images_val,
        "host": host_val_wrapped,
        "cgroups": cgroup_val_wrapped,
    })
}

// ─── Field extractors (legacy) ─────────────────────────────────────────────

fn get_container_state(container: &Value) -> String {
    if let Some(state) = container.get("State").and_then(|s| s.as_str()) {
        return state.to_lowercase();
    }
    if let Some(status) = container.get("Status").and_then(|s| s.as_str()) {
        return parse_state_from_status(status);
    }
    "unknown".to_string()
}

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

// ─── Log emission with fixed lock pattern ─────────────────────────────────

impl DockerCollector {
    async fn emit_state_change_logs(&self, containers: &[Value]) {
        let log_engine = match &self.log_engine {
            Some(e) => e,
            None => return,
        };

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
        };

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

// ─── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_all_states() {
        let containers = vec![
            json!({"Name": "/web", "Id": "abc", "Config": {"Image": "nginx", "Cmd": null, "Labels": {}}, "State": {"Status": "running", "RestartCount": 0, "ExitCode": 0, "Health": {"Status": ""}, "StartedAt": "2024-01-01T00:00:00Z", "FinishedAt": "0001-01-01T00:00:00Z"}, "Created": "2024-01-01T00:00:00Z", "NetworkSettings": {"Ports": {}, "Networks": {}}, "Mounts": [], "Platform": "linux"}),
            json!({"Name": "/db", "Id": "def", "Config": {"Image": "postgres", "Cmd": null, "Labels": {}}, "State": {"Status": "exited", "RestartCount": 2, "ExitCode": 0, "Health": {"Status": ""}, "StartedAt": "2024-01-01T00:00:00Z", "FinishedAt": "2024-01-01T01:00:00Z"}, "Created": "2024-01-01T00:00:00Z", "NetworkSettings": {"Ports": {}, "Networks": {}}, "Mounts": [], "Platform": "linux"}),
            json!({"Name": "/proxy", "Id": "ghi", "Config": {"Image": "haproxy", "Cmd": null, "Labels": {}}, "State": {"Status": "running", "RestartCount": 1, "ExitCode": 0, "Health": {"Status": "healthy"}, "StartedAt": "2024-01-01T00:30:00Z", "FinishedAt": "0001-01-01T00:00:00Z"}, "Created": "2024-01-01T00:00:00Z", "NetworkSettings": {"Ports": {}, "Networks": {}}, "Mounts": [], "Platform": "linux"}),
            json!({"Name": "/broken", "Id": "jkl", "Config": {"Image": "alpine", "Cmd": null, "Labels": {}}, "State": {"Status": "restarting", "RestartCount": 5, "ExitCode": 1, "Health": {"Status": ""}, "StartedAt": "0001-01-01T00:00:00Z", "FinishedAt": "0001-01-01T00:00:00Z"}, "Created": "2024-01-01T00:00:00Z", "NetworkSettings": {"Ports": {}, "Networks": {}}, "Mounts": [], "Platform": "linux"}),
            json!({"Name": "/paused-app", "Id": "mno", "Config": {"Image": "ubuntu", "Cmd": null, "Labels": {}}, "State": {"Status": "paused", "RestartCount": 0, "ExitCode": 0, "Health": {"Status": ""}, "StartedAt": "0001-01-01T00:00:00Z", "FinishedAt": "0001-01-01T00:00:00Z"}, "Created": "2024-01-01T00:00:00Z", "NetworkSettings": {"Ports": {}, "Networks": {}}, "Mounts": [], "Platform": "linux"}),
            json!({"Name": "/new-app", "Id": "pqr", "Config": {"Image": "node", "Cmd": null, "Labels": {}}, "State": {"Status": "created", "RestartCount": 0, "ExitCode": 0, "Health": {"Status": ""}, "StartedAt": "0001-01-01T00:00:00Z", "FinishedAt": "0001-01-01T00:00:00Z"}, "Created": "2024-01-01T00:00:00Z", "NetworkSettings": {"Ports": {}, "Networks": {}}, "Mounts": [], "Platform": "linux"}),
            json!({"Name": "/dead-app", "Id": "stu", "Config": {"Image": "redis", "Cmd": null, "Labels": {}}, "State": {"Status": "dead", "RestartCount": 10, "ExitCode": 137, "Health": {"Status": ""}, "StartedAt": "0001-01-01T00:00:00Z", "FinishedAt": "2024-01-01T00:00:00Z"}, "Created": "2024-01-01T00:00:00Z", "NetworkSettings": {"Ports": {}, "Networks": {}}, "Mounts": [], "Platform": "linux"}),
        ];
        let v = normalize_inspect_output(containers);
        assert_eq!(v.len(), 7);

        let mut state_counts: HashMap<String, usize> = HashMap::new();
        for c in &v {
            *state_counts.entry(get_container_state(c)).or_insert(0) += 1;
        }
        assert_eq!(*state_counts.get("running").unwrap_or(&0), 2);
        assert_eq!(*state_counts.get("exited").unwrap_or(&0), 1);
        assert_eq!(*state_counts.get("restarting").unwrap_or(&0), 1);
        assert_eq!(*state_counts.get("paused").unwrap_or(&0), 1);
        assert_eq!(*state_counts.get("created").unwrap_or(&0), 1);
        assert_eq!(*state_counts.get("dead").unwrap_or(&0), 1);
    }

    #[test]
    fn empty_list_produces_empty_inventory() {
        let items = build_events_array(&[]);
        assert_eq!(items.as_array().unwrap().len(), 0);
    }

    #[test]
    fn container_details_include_all_fields() {
        let containers = vec![
            json!({"Name": "/web", "Id": "abc123", "Config": {"Image": "nginx:latest", "Cmd": ["nginx", "-g", "daemon off;"], "Labels": {"com.docker.compose.project": "test"}}, "State": {"Status": "running", "RestartCount": 0, "ExitCode": 0, "Health": {"Status": ""}, "StartedAt": "2024-01-01T00:00:00Z", "FinishedAt": "0001-01-01T00:00:00Z"}, "Created": "2024-01-01T00:00:00Z", "NetworkSettings": {"Ports": {"80/tcp": [{"HostIp": "0.0.0.0", "HostPort": "80"}]}, "Networks": {"bridge": {"IPAddress": "", "Gateway": ""}}}, "Mounts": [{"Name": "data", "Source": "/data", "Destination": "/data"}], "Platform": "linux"}),
        ];
        let v = normalize_inspect_output(containers);
        let c = &v[0];
        assert_eq!(c["ID"], "abc123");
        assert_eq!(c["Names"], "web");
        assert_eq!(c["State"], "running");
        assert_eq!(c["Image"], "nginx:latest");
        assert_eq!(c["Ports"], "80/tcp");
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

    #[test]
    fn test_parse_image_size() {
        assert_eq!(parse_image_size("0B"), 0);
        assert_eq!(parse_image_size("1KB"), 1024);
        assert_eq!(parse_image_size("1MB"), 1_048_576);
        assert_eq!(parse_image_size("1GB"), 1_073_741_824);
        assert_eq!(parse_image_size("1.5MB"), 1_572_864);
    }
}
