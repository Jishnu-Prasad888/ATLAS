// collectors/ram.rs — RAM Collector (SRP + Collector trait)

use anyhow::Result;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::{collections::HashMap, fs};
use sysinfo::{MemoryRefreshKind, RefreshKind, System};

use super::trait_collector::Collector;

pub struct RamCollector {
    sys: std::sync::Mutex<System>,
}

impl RamCollector {
    pub fn new() -> Self {
        Self {
            sys: std::sync::Mutex::new(System::new_with_specifics(
                RefreshKind::new().with_memory(MemoryRefreshKind::everything()),
            )),
        }
    }
}

#[async_trait]
impl Collector for RamCollector {
    fn name(&self) -> &'static str {
        "ram"
    }

    async fn collect(&self) -> Result<Value> {
        let mut sys = self.sys.lock().unwrap();
        sys.refresh_memory();
        Ok(collect_from(&sys))
    }
}

/// Pure function — pass any `System` snapshot for unit testing.
pub fn collect_from(sys: &System) -> Value {
    let total = sys.total_memory();
    let used = sys.used_memory();
    let free = sys.free_memory();
    let avail = sys.available_memory();

    let swap_total = sys.total_swap();
    let swap_used = sys.used_swap();

    let usage_pct = if total > 0 {
        used as f64 / total as f64 * 100.0
    } else {
        0.0
    };
    let swap_pct = if swap_total > 0 {
        swap_used as f64 / swap_total as f64 * 100.0
    } else {
        0.0
    };

    let meminfo = read_meminfo();
    let kb = |k: &str| meminfo.get(k).copied().unwrap_or(0) * 1024;

    json!({
        "total_bytes":     total,
        "used_bytes":      used,
        "free_bytes":      free,
        "available_bytes": avail,
        "usage_pct":       usage_pct,
        "cached_bytes":    kb("Cached"),
        "buffers_bytes":   kb("Buffers"),
        "slab_bytes":      kb("Slab"),
        "swap": {
            "total_bytes": swap_total,
            "used_bytes":  swap_used,
            "free_bytes":  swap_total.saturating_sub(swap_used),
            "usage_pct":   swap_pct,
        },
        "hugepages": {
            "total":   meminfo.get("HugePages_Total").copied().unwrap_or(0),
            "free":    meminfo.get("HugePages_Free").copied().unwrap_or(0),
            "size_kb": meminfo.get("Hugepagesize").copied().unwrap_or(0),
        },
        "dirty_bytes":  kb("Dirty"),
        "mapped_bytes": kb("Mapped"),
    })
}

fn read_meminfo() -> HashMap<String, u64> {
    let mut map = HashMap::new();
    if let Ok(content) = fs::read_to_string("/proc/meminfo") {
        for line in content.lines() {
            if let Some((key, rest)) = line.split_once(':') {
                let val = rest
                    .split_whitespace()
                    .next()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0);
                map.insert(key.trim().to_string(), val);
            }
        }
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collect_from_has_required_fields() {
        let mut sys = System::new_with_specifics(
            RefreshKind::new().with_memory(MemoryRefreshKind::everything()),
        );
        sys.refresh_memory();
        let v = collect_from(&sys);
        for key in &["total_bytes", "used_bytes", "usage_pct", "swap"] {
            assert!(v.get(key).is_some(), "missing field: {key}");
        }
    }

    #[test]
    fn usage_pct_is_in_range() {
        let mut sys = System::new_with_specifics(
            RefreshKind::new().with_memory(MemoryRefreshKind::everything()),
        );
        sys.refresh_memory();
        let v = collect_from(&sys);
        let pct = v["usage_pct"].as_f64().unwrap();
        assert!((0.0..=100.0).contains(&pct));
    }
}
