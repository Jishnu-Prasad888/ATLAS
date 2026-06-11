// collectors/systemd.rs — Systemd Collector (SRP + Collector trait)

use anyhow::Result;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::process::Command;
use tracing::warn;

use super::trait_collector::Collector;

pub struct SystemdCollector;

impl SystemdCollector {
    pub fn new() -> Self { Self }
}

#[async_trait]
impl Collector for SystemdCollector {
    fn name(&self) -> &'static str { "systemd" }

    async fn collect(&self) -> Result<Value> {
        let raw = run_systemctl();
        Ok(aggregate_services(&raw))
    }
}

fn run_systemctl() -> Vec<Value> {
    let output = Command::new("systemctl")
        .args(["list-units", "--type=service", "--no-pager", "--plain", "--no-legend"])
        .output();
    match output {
        Ok(out) => parse_systemctl_output(&String::from_utf8_lossy(&out.stdout)),
        Err(e)  => { warn!("systemctl unavailable: {e}"); vec![] }
    }
}

/// Pure — accepts raw text; no process or I/O side effects.
pub fn parse_systemctl_output(output: &str) -> Vec<Value> {
    output.lines().filter_map(|line| {
        let p: Vec<&str> = line.split_whitespace().collect();
        if p.len() >= 4 {
            Some(json!({
                "name":   p[0],
                "load":   p[1],
                "active": p[2],
                "sub":    p[3],
                "desc":   p[4..].join(" "),
            }))
        } else {
            None
        }
    }).take(256).collect()
}

/// Pure — builds summary from already-parsed services.
pub fn aggregate_services(services: &[Value]) -> Value {
    let sub = |v: &Value, s: &str| v.get("sub").and_then(|x| x.as_str()) == Some(s);
    let failed  = services.iter().filter(|v| sub(v, "failed")).count();
    let running = services.iter().filter(|v| sub(v, "running")).count();
    json!({
        "total_services":   services.len(),
        "running_services": running,
        "failed_services":  failed,
        "services":         services,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "\
sshd.service          loaded active running OpenSSH server daemon
cron.service          loaded active running Regular background program
nginx.service         loaded failed failed  A high performance web server
";

    #[test]
    fn parses_correct_service_count() {
        let services = parse_systemctl_output(SAMPLE);
        assert_eq!(services.len(), 3);
    }

    #[test]
    fn counts_running_and_failed() {
        let services  = parse_systemctl_output(SAMPLE);
        let aggregate = aggregate_services(&services);
        assert_eq!(aggregate["running_services"].as_u64().unwrap(), 2);
        assert_eq!(aggregate["failed_services"].as_u64().unwrap(),  1);
    }

    #[test]
    fn empty_output_returns_empty() {
        let services = parse_systemctl_output("");
        assert!(services.is_empty());
    }

    #[test]
    fn short_lines_are_skipped() {
        let input    = "only three words\n";
        let services = parse_systemctl_output(input);
        assert!(services.is_empty());
    }
}
