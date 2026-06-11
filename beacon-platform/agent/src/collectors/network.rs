// collectors/network.rs — Network Collector (SRP + Collector trait)

use anyhow::Result;
use async_trait::async_trait;
use serde_json::{json, Value};
use sysinfo::Networks;
use std::fs;

use super::trait_collector::Collector;

pub struct NetworkCollector {
    networks: std::sync::Mutex<Networks>,
}

impl NetworkCollector {
    pub fn new() -> Self {
        Self {
            networks: std::sync::Mutex::new(Networks::new_with_refreshed_list()),
        }
    }
}

#[async_trait]
impl Collector for NetworkCollector {
    fn name(&self) -> &'static str { "network" }

    async fn collect(&self) -> Result<Value> {
        let mut networks = self.networks.lock().unwrap();
        networks.refresh_list();
        Ok(collect_from(&networks))
    }
}

pub fn collect_from(networks: &Networks) -> Value {
    let interfaces: Vec<Value> = networks.iter().map(|(name, net)| {
        json!({
            "name":          name,
            "rx_bytes":      net.total_received(),
            "tx_bytes":      net.total_transmitted(),
            "rx_packets":    net.total_packets_received(),
            "tx_packets":    net.total_packets_transmitted(),
            "rx_errors":     net.total_errors_on_received(),
            "tx_errors":     net.total_errors_on_transmitted(),
            "rx_bytes_rate": net.received(),
            "tx_bytes_rate": net.transmitted(),
        })
    }).collect();

    json!({
        "interfaces": interfaces,
        "tcp":        read_tcp_stats(),
        "udp":        read_udp_stats(),
    })
}

// ─── /proc readers ────────────────────────────────────────────────────────────

fn count_tcp_states(content: &str, established: &mut u32, time_wait: &mut u32,
                    close_wait: &mut u32, listen: &mut u32) {
    for line in content.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 4 {
            match parts[3] {
                "01" => *established += 1,
                "06" => *time_wait   += 1,
                "08" => *close_wait  += 1,
                "0A" => *listen      += 1,
                _    => {}
            }
        }
    }
}

pub fn read_tcp_stats() -> Value {
    let (mut established, mut time_wait, mut close_wait, mut listen) = (0u32, 0u32, 0u32, 0u32);
    for path in &["/proc/net/tcp", "/proc/net/tcp6"] {
        if let Ok(c) = fs::read_to_string(path) {
            count_tcp_states(&c, &mut established, &mut time_wait, &mut close_wait, &mut listen);
        }
    }
    json!({ "established": established, "time_wait": time_wait,
             "close_wait": close_wait,  "listening": listen })
}

pub fn read_udp_stats() -> Value {
    let sockets: u32 = ["/proc/net/udp", "/proc/net/udp6"]
        .iter()
        .filter_map(|p| fs::read_to_string(p).ok())
        .map(|c| c.lines().skip(1).count() as u32)
        .sum();
    json!({ "sockets": sockets })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tcp_stat_parses_known_state_codes() {
        // /proc/net/tcp format: col[3] is the state hex
        let mock = "  sl  local_address rem_address   st\n\
                    0: 00000000:0016 00000000:0000 0A 00000000:00000000\n\
                    1: 0F02000A:BDB4 0202000A:0016 01 00000000:00000000\n";
        let (mut e, mut tw, mut cw, mut l) = (0u32, 0u32, 0u32, 0u32);
        count_tcp_states(mock, &mut e, &mut tw, &mut cw, &mut l);
        assert_eq!(l, 1, "LISTEN (0A) count");
        assert_eq!(e, 1, "ESTABLISHED (01) count");
    }

    #[test]
    fn collect_from_has_expected_shape() {
        let networks = Networks::new_with_refreshed_list();
        let v = collect_from(&networks);
        assert!(v.get("interfaces").is_some());
        assert!(v.get("tcp").is_some());
        assert!(v.get("udp").is_some());
    }
}
