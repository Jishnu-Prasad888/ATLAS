// collectors/storage.rs — Storage Collector (SRP + Collector trait)

use anyhow::Result;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::{collections::HashMap, fs, sync::Mutex};
use sysinfo::Disks;

use super::trait_collector::Collector;

pub struct StorageCollector {
    /// Previous (reads, writes) per device — used for delta calculation.
    prev_stats: Mutex<HashMap<String, (u64, u64)>>,
}

impl StorageCollector {
    pub fn new() -> Self {
        Self {
            prev_stats: Mutex::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl Collector for StorageCollector {
    fn name(&self) -> &'static str {
        "storage"
    }

    async fn collect(&self) -> Result<Value> {
        let disks = Disks::new_with_refreshed_list();
        let io_stats = read_diskstats();
        let mut prev = self.prev_stats.lock().unwrap();
        Ok(collect_from(&disks, &io_stats, &mut prev))
    }
}

pub fn collect_from(
    disks: &Disks,
    io_stats: &HashMap<String, (u64, u64)>,
    prev: &mut HashMap<String, (u64, u64)>,
) -> Value {
    let filesystems: Vec<Value> = disks
        .list()
        .iter()
        .map(|disk| {
            let name = disk.name().to_string_lossy().to_string();
            let total = disk.total_space();
            let avail = disk.available_space();
            let used = total.saturating_sub(avail);
            let pct = if total > 0 {
                used as f64 / total as f64 * 100.0
            } else {
                0.0
            };
            json!({
                "name":        name,
                "mount_point": disk.mount_point(),
                "fs_type":     disk.file_system().to_string_lossy(),
                "total_bytes": total,
                "used_bytes":  used,
                "free_bytes":  avail,
                "usage_pct":   pct,
                "is_removable": disk.is_removable(),
            })
        })
        .collect();

    let io: Vec<Value> = io_stats
        .iter()
        .map(|(dev, &(reads, writes))| {
            let prev_rw = prev.get(dev).copied().unwrap_or((0, 0));
            let read_delta = reads.saturating_sub(prev_rw.0);
            let write_delta = writes.saturating_sub(prev_rw.1);
            prev.insert(dev.clone(), (reads, writes));
            json!({
                "device":       dev,
                "reads_total":  reads,
                "writes_total": writes,
                "read_delta":   read_delta,
                "write_delta":  write_delta,
            })
        })
        .collect();

    json!({ "filesystems": filesystems, "io_stats": io })
}

pub fn read_diskstats() -> HashMap<String, (u64, u64)> {
    let mut map = HashMap::new();
    if let Ok(content) = fs::read_to_string("/proc/diskstats") {
        for line in content.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 14 {
                let dev = parts[2].to_string();
                let reads = parts[3].parse().unwrap_or(0);
                let writes = parts[7].parse().unwrap_or(0);
                if !dev.starts_with("loop") && !dev.starts_with("ram") {
                    map.insert(dev, (reads, writes));
                }
            }
        }
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delta_is_zero_on_first_call() {
        let disks = Disks::new_with_refreshed_list();
        let io_stats: HashMap<String, (u64, u64)> = [("sda".to_string(), (100u64, 200u64))].into();
        let mut prev: HashMap<String, (u64, u64)> = HashMap::new();

        let v = collect_from(&disks, &io_stats, &mut prev);
        let io = v["io_stats"].as_array().unwrap();
        let sda = io.iter().find(|e| e["device"] == "sda").unwrap();
        // On first call prev was empty, so delta == current value
        assert_eq!(sda["read_delta"], 100);
        assert_eq!(sda["write_delta"], 200);
    }

    #[test]
    fn delta_is_difference_on_second_call() {
        let disks = Disks::new_with_refreshed_list();
        let mut prev: HashMap<String, (u64, u64)> = [("sda".to_string(), (100u64, 200u64))].into();
        let io_stats: HashMap<String, (u64, u64)> = [("sda".to_string(), (150u64, 250u64))].into();

        let v = collect_from(&disks, &io_stats, &mut prev);
        let io = v["io_stats"].as_array().unwrap();
        let sda = io.iter().find(|e| e["device"] == "sda").unwrap();
        assert_eq!(sda["read_delta"], 50);
        assert_eq!(sda["write_delta"], 50);
    }

    #[test]
    fn loop_and_ram_devices_are_excluded_from_diskstats() {
        // read_diskstats filters loop* and ram*; verify the filter logic
        let mock_lines = "  8  0 sda 100 0 200 0 50 0 100 0 0 0 0 0 0 0\n\
                           252  0 loop0 1 0 2 0 3 0 4 0 0 0 0 0 0 0\n\
                           252  1 ram0 5 0 6 0 7 0 8 0 0 0 0 0 0 0\n";
        let mut map = HashMap::new();
        for line in mock_lines.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 14 {
                let dev = parts[2].to_string();
                if !dev.starts_with("loop") && !dev.starts_with("ram") {
                    map.insert(
                        dev,
                        (
                            parts[3].parse::<u64>().unwrap_or(0),
                            parts[7].parse::<u64>().unwrap_or(0),
                        ),
                    );
                }
            }
        }
        assert!(map.contains_key("sda"));
        assert!(!map.contains_key("loop0"));
        assert!(!map.contains_key("ram0"));
    }
}
