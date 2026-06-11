// collectors/cpu.rs — CPU Collector (SRP + Collector trait)
//
// `CpuCollector` owns only CPU data collection.
// The `collect()` method is pure: it reads system state and returns `Value`.
// Scheduling, error logging, and enqueueing live in the trait default `run()`.
//
// Testing strategy:
//   * Call `collect_from()` directly with a pre-populated `sysinfo::System`
//     to assert on the returned JSON without touching hardware.

use anyhow::Result;
use async_trait::async_trait;
use serde_json::{json, Value};
use sysinfo::{CpuRefreshKind, RefreshKind, System};
use std::fs;

use super::trait_collector::Collector;

pub struct CpuCollector {
    sys: std::sync::Mutex<System>,
}

impl CpuCollector {
    pub fn new() -> Self {
        let mut sys = System::new_with_specifics(
            RefreshKind::new().with_cpu(CpuRefreshKind::everything()),
        );
        sys.refresh_cpu_all();
        Self { sys: std::sync::Mutex::new(sys) }
    }
}

#[async_trait]
impl Collector for CpuCollector {
    fn name(&self) -> &'static str { "cpu" }

    async fn collect(&self) -> Result<Value> {
        let mut sys = self.sys.lock().unwrap();
        sys.refresh_cpu_all();
        // First call after construction gives a baseline; sleep for accuracy
        // is intentionally omitted here — callers control the interval.
        Ok(collect_from(&sys))
    }
}

/// Pure function — testable without `CpuCollector`.
pub fn collect_from(sys: &System) -> Value {
    let cpus       = sys.cpus();
    let core_count = cpus.len();
    let usage_total = if core_count > 0 {
        cpus.iter().map(|c| c.cpu_usage() as f64).sum::<f64>() / core_count as f64
    } else {
        0.0
    };

    let per_core: Vec<Value> = cpus.iter().enumerate().map(|(i, cpu)| {
        json!({
            "core":      i,
            "usage_pct": cpu.cpu_usage(),
            "frequency": cpu.frequency(),
            "name":      cpu.name(),
        })
    }).collect();

    let load_avg  = read_loadavg();
    let (interrupts, ctx) = read_stat();
    let temperatures      = read_temperatures();

    json!({
        "usage_pct":        usage_total,
        "core_count":       core_count,
        "per_core":         per_core,
        "load_avg_1m":      load_avg.0,
        "load_avg_5m":      load_avg.1,
        "load_avg_15m":     load_avg.2,
        "interrupts":       interrupts,
        "context_switches": ctx,
        "temperatures_c":   temperatures,
    })
}

// ─── /proc readers (SRP: reading only, no side-effects) ──────────────────────

fn read_loadavg() -> (f64, f64, f64) {
    match fs::read_to_string("/proc/loadavg") {
        Ok(c) => {
            let p: Vec<&str> = c.split_whitespace().collect();
            let v = |s: Option<&&str>| s.and_then(|x| x.parse().ok()).unwrap_or(0.0);
            (v(p.get(0)), v(p.get(1)), v(p.get(2)))
        }
        Err(_) => (0.0, 0.0, 0.0),
    }
}

fn read_stat() -> (u64, u64) {
    let content = match fs::read_to_string("/proc/stat") {
        Ok(c)  => c,
        Err(_) => return (0, 0),
    };
    let mut intr = 0u64;
    let mut ctx  = 0u64;
    for line in content.lines() {
        if line.starts_with("intr ") {
            intr = line.split_whitespace().nth(1).and_then(|s| s.parse().ok()).unwrap_or(0);
        }
        if line.starts_with("ctxt ") {
            ctx  = line.split_whitespace().nth(1).and_then(|s| s.parse().ok()).unwrap_or(0);
        }
    }
    (intr, ctx)
}

fn read_temperatures() -> Vec<Value> {
    (0..8).filter_map(|i| {
        let path      = format!("/sys/class/thermal/thermal_zone{i}/temp");
        let type_path = format!("/sys/class/thermal/thermal_zone{i}/type");
        let raw: f64  = fs::read_to_string(&path).ok()?.trim().parse().ok()?;
        let celsius   = raw / 1000.0;
        if !(-50.0..=200.0).contains(&celsius) { return None; }
        let zone_type = fs::read_to_string(&type_path)
            .unwrap_or_else(|_| format!("zone{i}"));
        Some(json!({ "zone": i, "type": zone_type.trim(), "temp_c": celsius }))
    }).collect()
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collect_from_returns_required_keys() {
        let sys = System::new_with_specifics(
            RefreshKind::new().with_cpu(CpuRefreshKind::everything()),
        );
        let v = collect_from(&sys);
        assert!(v.get("usage_pct").is_some());
        assert!(v.get("core_count").is_some());
        assert!(v.get("per_core").is_some());
        assert!(v.get("load_avg_1m").is_some());
    }

    #[test]
    fn usage_pct_is_non_negative() {
        let sys = System::new_with_specifics(
            RefreshKind::new().with_cpu(CpuRefreshKind::everything()),
        );
        let v = collect_from(&sys);
        assert!(v["usage_pct"].as_f64().unwrap() >= 0.0);
    }
}
