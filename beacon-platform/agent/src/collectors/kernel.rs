// collectors/kernel.rs — Kernel Collector (SRP + Collector trait)

use anyhow::Result;
use async_trait::async_trait;
use serde_json::{json, Value};
use sysinfo::System;
use std::fs;

use super::trait_collector::Collector;
use crate::engines::identity::AgentIdentity;

pub struct KernelCollector {
    identity: AgentIdentity,
}

impl KernelCollector {
    pub fn new(identity: AgentIdentity) -> Self { Self { identity } }
}

#[async_trait]
impl Collector for KernelCollector {
    fn name(&self) -> &'static str { "kernel" }

    async fn collect(&self) -> Result<Value> {
        Ok(collect_from(&self.identity))
    }
}

pub fn collect_from(identity: &AgentIdentity) -> Value {
    let kernel_version = System::kernel_version().unwrap_or_else(|| "unknown".into());
    let os_version     = System::os_version().unwrap_or_else(|| "unknown".into());
    let hostname       = System::host_name().unwrap_or_else(|| identity.hostname.clone());
    let uptime_secs    = System::uptime();
    let boot_time      = System::boot_time();
    let arch           = std::env::consts::ARCH.to_string();

    let proc_version = fs::read_to_string("/proc/version")
        .unwrap_or_default().trim().to_string();
    let os_type      = fs::read_to_string("/proc/sys/kernel/ostype")
        .unwrap_or_else(|_| "Linux\n".into()).trim().to_string();
    let cmdline      = fs::read_to_string("/proc/cmdline")
        .unwrap_or_default().trim().replace('\0', " ").to_string();
    let cpu_count    = fs::read_to_string("/proc/cpuinfo")
        .unwrap_or_default().lines()
        .filter(|l| l.starts_with("processor"))
        .count();

    json!({
        "kernel_version": kernel_version,
        "os_version":     os_version,
        "os_type":        os_type,
        "hostname":       hostname,
        "architecture":   arch,
        "uptime_secs":    uptime_secs,
        "boot_time_unix": boot_time,
        "cpu_count":      cpu_count,
        "proc_version":   proc_version,
        "cmdline":        cmdline,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy_identity() -> AgentIdentity {
        AgentIdentity {
            agent_id: "test-agent".into(),
            hostname:  "test-host".into(),
            os:        "linux".into(),
            arch:      "x86_64".into(),
        }
    }

    #[test]
    fn collect_from_returns_required_keys() {
        let identity = dummy_identity();
        let v = collect_from(&identity);
        for key in &["kernel_version", "os_version", "hostname",
                     "architecture", "uptime_secs", "cpu_count"] {
            assert!(v.get(key).is_some(), "missing: {key}");
        }
    }
}
