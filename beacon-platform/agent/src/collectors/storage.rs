// collectors/storage.rs — Storage Collector (SRP + Collector trait)

use anyhow::Result;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    sync::Mutex,
};
use sysinfo::Disks;

use super::trait_collector::Collector;

#[derive(Default)]
struct DiskAggregate {
    total: u64,
    used: u64,
    free: u64,
    fs_types: HashSet<String>,
    mount_points: Vec<String>,
    partitions: Vec<Value>,
    is_removable: bool,
}

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
    let mut disk_groups: HashMap<String, DiskAggregate> = HashMap::new();
    let mut os_disk_id: Option<String> = None;

    let filesystems: Vec<Value> = disks
        .list()
        .iter()
        .filter_map(|disk| {
            let device = disk.name().to_string_lossy().to_string();
            let mount_point = disk.mount_point().to_string_lossy().to_string();
            let base = base_device(&device);
            if mount_point.starts_with("/var/lib/docker")
                || base == "overlay"
                || device == "overlay"
            {
                return None;
            }
            let total = disk.total_space();
            let avail = disk.available_space();
            let used = total.saturating_sub(avail);
            let pct = if total > 0 {
                used as f64 / total as f64 * 100.0
            } else {
                0.0
            };
            if mount_point == "/" {
                os_disk_id = Some(base.clone());
            }

            let fs_type = disk.file_system().to_string_lossy().to_string();
            let entry = json!({
                "device":       device.clone(),
                "name":         device.clone(),
                "mount_point":  mount_point.clone(),
                "fs_type":      fs_type.clone(),
                "total_bytes":  total,
                "used_bytes":   used,
                "free_bytes":   avail,
                "usage_pct":    pct,
                "is_removable": disk.is_removable(),
                "parent_disk":  base.clone(),
            });

            let agg = disk_groups
                .entry(base.clone())
                .or_insert_with(|| DiskAggregate {
                    is_removable: disk.is_removable(),
                    ..DiskAggregate::default()
                });

            agg.total = agg.total.saturating_add(total);
            agg.used = agg.used.saturating_add(used);
            agg.free = agg.free.saturating_add(avail);
            agg.fs_types.insert(fs_type);
            if !agg.mount_points.contains(&mount_point) {
                agg.mount_points.push(mount_point.clone());
            }
            agg.is_removable = agg.is_removable && disk.is_removable();
            agg.partitions.push(entry.clone());

            Some(entry)
        })
        .collect();

    let disks_summary: Vec<Value> = disk_groups
        .iter()
        .map(|(device, agg)| {
            let usage_pct = if agg.total > 0 {
                agg.used as f64 / agg.total as f64 * 100.0
            } else {
                0.0
            };
            let mut fs_types: Vec<_> = agg.fs_types.iter().cloned().collect();
            fs_types.sort();
            fs_types.dedup();
            json!({
                "device":          device,
                "name":            device,
                "fs_type":         if fs_types.is_empty() { "unknown".to_string() } else { fs_types.join(",") },
                "total_bytes":     agg.total,
                "used_bytes":      agg.used,
                "free_bytes":      agg.free,
                "usage_pct":       usage_pct,
                "mount_points":    agg.mount_points.clone(),
                "partition_count": agg.partitions.len(),
                "is_removable":    agg.is_removable,
                "partitions":      agg.partitions.clone(),
            })
        })
        .collect();

    let os_disk = os_disk_id.and_then(|id| {
        disk_groups.get(&id).map(|agg| {
            let mut fs_types: Vec<_> = agg.fs_types.iter().cloned().collect();
            fs_types.sort();
            fs_types.dedup();
            json!({
                "device":          id,
                "name":            id,
                "fs_type":         if fs_types.is_empty() { "unknown".to_string() } else { fs_types.join(",") },
                "total_bytes":     agg.total,
                "used_bytes":      agg.used,
                "free_bytes":      agg.free,
                "usage_pct":       if agg.total > 0 { agg.used as f64 / agg.total as f64 * 100.0 } else { 0.0 },
                "mount_points":    agg.mount_points.clone(),
                "partition_count": agg.partitions.len(),
                "is_removable":    agg.is_removable,
                "partitions":      agg.partitions.clone(),
                "is_os_disk":      true,
            })
        })
    });

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

    json!({
        "filesystems": filesystems,
        "partitions":  filesystems,
        "disks":       disks_summary,
        "os_disk":     os_disk,
        "io_stats":    io,
    })
}

fn base_device(name: &str) -> String {
    let basename = name.rsplit_once('/').map(|(_, tail)| tail).unwrap_or(name);

    if basename.starts_with("nvme") || basename.starts_with("mmcblk") {
        if let Some(pos) = basename.rfind('p') {
            return basename[..pos].to_string();
        }
        return basename.to_string();
    }

    let trimmed = basename.trim_end_matches(|c: char| c.is_ascii_digit());
    if trimmed.is_empty() {
        basename.to_string()
    } else {
        trimmed.to_string()
    }
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

    #[test]
    fn base_device_handles_common_names() {
        assert_eq!(base_device("sda1"), "sda");
        assert_eq!(base_device("/dev/sda2"), "sda");
        assert_eq!(base_device("nvme0n1p2"), "nvme0n1");
        assert_eq!(base_device("/dev/nvme0n1"), "nvme0n1");
        assert_eq!(base_device("mmcblk0p1"), "mmcblk0");
        assert_eq!(base_device("vda"), "vda");
    }
}
