// collectors/process.rs — Process Collector (SRP + Collector trait)

use anyhow::Result;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::{fs, sync::Mutex};
use sysinfo::{ProcessRefreshKind, RefreshKind, System};

use super::trait_collector::Collector;

pub struct ProcessCollector {
    sys: Mutex<System>,
    boot_id: String,
    max_processes: usize,
}

impl ProcessCollector {
    pub fn new(max_processes: usize) -> Self {
        Self {
            sys: Mutex::new(System::new_with_specifics(
                RefreshKind::new().with_processes(ProcessRefreshKind::everything()),
            )),
            boot_id: read_boot_id(),
            max_processes,
        }
    }
}

#[async_trait]
impl Collector for ProcessCollector {
    fn name(&self) -> &'static str {
        "process"
    }

    async fn collect(&self) -> Result<Value> {
        let mut sys = self.sys.lock().unwrap();
        sys.refresh_processes();
        Ok(collect_from(&sys, &self.boot_id, self.max_processes))
    }
}

pub fn collect_from(sys: &System, boot_id: &str, max_processes: usize) -> Value {
    let mut procs: Vec<_> = sys.processes().values().collect();
    procs.sort_by(|a, b| {
        b.cpu_usage()
            .partial_cmp(&a.cpu_usage())
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    procs.truncate(max_processes);

    let process_list: Vec<Value> = procs
        .iter()
        .map(|p| {
            json!({
                "pid":         p.pid().as_u32(),
                "boot_id":     boot_id,
                "start_time":  p.start_time(),
                "name":        p.name(),
                "exe":         p.exe().map(|e| e.display().to_string()),
                "cpu_pct":     p.cpu_usage(),
                "mem_bytes":   p.memory(),
                "virtual_mem": p.virtual_memory(),
                "status":      format!("{:?}", p.status()),
                "parent_pid":  p.parent().map(|pp| pp.as_u32()),
                "threads":     p.tasks().map(|t| t.len()),
            })
        })
        .collect();

    let total = sys.processes().len();
    json!({
        "total_processes": total,
        "collected":       process_list.len(),
        "capped":          total > max_processes,
        "processes":       process_list,
    })
}

fn read_boot_id() -> String {
    fs::read_to_string("/proc/sys/kernel/random/boot_id")
        .unwrap_or_default()
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn max_processes_cap_is_respected() {
        let mut sys = System::new_with_specifics(
            RefreshKind::new().with_processes(ProcessRefreshKind::everything()),
        );
        sys.refresh_processes();

        let total = sys.processes().len();
        if total < 2 {
            return;
        } // skip if no processes on this host

        let cap = 1;
        let v = collect_from(&sys, "test-boot-id", cap);
        assert_eq!(v["collected"].as_u64().unwrap(), cap as u64);
        assert_eq!(v["capped"].as_bool().unwrap(), total > cap);
    }

    #[test]
    fn no_cap_collects_all() {
        let mut sys = System::new_with_specifics(
            RefreshKind::new().with_processes(ProcessRefreshKind::everything()),
        );
        sys.refresh_processes();
        let total = sys.processes().len();
        let v = collect_from(&sys, "boot", usize::MAX);
        assert_eq!(v["total_processes"].as_u64().unwrap(), total as u64);
        assert_eq!(v["capped"].as_bool().unwrap(), false);
    }
}
