// collectors/network.rs — Network Collector (SRP + Collector trait)

use anyhow::Result;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::process::Command;
use sysinfo::Networks;

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
    fn name(&self) -> &'static str {
        "network"
    }

    async fn collect(&self) -> Result<Value> {
        let mut networks = self.networks.lock().unwrap();
        networks.refresh_list();
        Ok(collect_from(&networks))
    }
}

pub fn collect_from(networks: &Networks) -> Value {
    let ip_meta = read_ip_addr_meta();
    let interfaces: Vec<Value> = networks
        .iter()
        .map(|(name, net)| {
            let meta = ip_meta.get(name);
            let sys_meta = read_sysfs_iface_meta(name);
            let addresses = meta
                .map(|m| m.addresses.clone())
                .unwrap_or_else(Vec::new);

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
                "mtu":           meta.and_then(|m| m.mtu).or(sys_meta.mtu),
                "state":         meta.and_then(|m| m.state.clone()).or(sys_meta.state),
                "mac":           sys_meta.mac,
                "qdisc":         meta.and_then(|m| m.qdisc.clone()).or(sys_meta.qdisc),
                "qlen":          meta.and_then(|m| m.qlen).or(sys_meta.qlen),
                "flags":         meta.map(|m| m.flags.clone()).unwrap_or_default(),
                "addresses":     addresses,
            })
        })
        .collect();

    let sockets = collect_kernel_sockets();
    let inode_map = build_inode_process_map(8192, 2048);
    let process_connections = build_process_connections(&sockets, &inode_map);
    let open_ports = build_open_ports(&sockets, &inode_map);

    json!({
        "interfaces": interfaces,
        "tcp":        read_tcp_stats(),
        "udp":        read_udp_stats(),
        "process_connections": process_connections,
        "open_ports": open_ports,
    })
}

// ─── /proc readers ────────────────────────────────────────────────────────────

fn count_tcp_states(
    content: &str,
    established: &mut u32,
    time_wait: &mut u32,
    close_wait: &mut u32,
    listen: &mut u32,
) {
    for line in content.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 4 {
            match parts[3] {
                "01" => *established += 1,
                "06" => *time_wait += 1,
                "08" => *close_wait += 1,
                "0A" => *listen += 1,
                _ => {}
            }
        }
    }
}

// ─── Socket + interface helpers ───────────────────────────────────────────────

#[derive(Debug, Clone, Default)]
struct IpAddrInfo {
    addresses: Vec<Value>,
    mtu: Option<u32>,
    state: Option<String>,
    qdisc: Option<String>,
    qlen: Option<u32>,
    flags: Vec<String>,
}

#[derive(Debug, Clone, Default)]
struct SysMeta {
    mtu: Option<u32>,
    state: Option<String>,
    mac: Option<String>,
    qdisc: Option<String>,
    qlen: Option<u32>,
}

#[derive(Debug, Clone)]
struct SocketEntry {
    proto: String,
    local_addr: String,
    local_port: u16,
    remote_addr: String,
    remote_port: u16,
    state: String,
    rx_queue: u64,
    tx_queue: u64,
    inode: u64,
}

#[derive(Debug, Clone)]
struct ProcInfo {
    pid: u32,
    name: String,
    exe: Option<String>,
}

fn read_ip_addr_meta() -> HashMap<String, IpAddrInfo> {
    let mut map = HashMap::new();
    let output = Command::new("ip").args(["-j", "addr"]).output();
    let Ok(output) = output else { return map; };
    if !output.status.success() {
        return map;
    }
    let content = String::from_utf8_lossy(&output.stdout);
    parse_ip_addr_json(&content, &mut map);
    map
}

fn parse_ip_addr_json(content: &str, target: &mut HashMap<String, IpAddrInfo>) {
    let Ok(value) = serde_json::from_str::<Value>(content) else { return; };
    let Some(arr) = value.as_array() else { return; };
    for iface in arr {
        let name = iface.get("ifname").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if name.is_empty() { continue; }
        let mtu = iface.get("mtu").and_then(|v| v.as_u64()).map(|v| v as u32);
        let state = iface.get("operstate").and_then(|v| v.as_str()).map(|s| s.to_string());
        let qdisc = iface.get("qdisc").and_then(|v| v.as_str()).map(|s| s.to_string());
        let qlen = iface.get("txqlen").and_then(|v| v.as_u64()).map(|v| v as u32);
        let flags = iface
            .get("flags")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str())
                    .map(|s| s.to_string())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        let addresses = iface
            .get("addr_info")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .map(|a| {
                        json!({
                            "family":    a.get("family").and_then(|v| v.as_str()).unwrap_or(""),
                            "address":   a.get("local").and_then(|v| v.as_str()).unwrap_or(""),
                            "prefix":    a.get("prefixlen").and_then(|v| v.as_u64()).unwrap_or(0),
                            "scope":     a.get("scope").and_then(|v| v.as_str()).unwrap_or(""),
                            "broadcast": a.get("broadcast").and_then(|v| v.as_str()).unwrap_or(""),
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_else(Vec::new);

        target.insert(name, IpAddrInfo { addresses, mtu, state, qdisc, qlen, flags });
    }
}

fn read_sysfs_iface_meta(name: &str) -> SysMeta {
    let base = format!("/sys/class/net/{name}");
    let mtu = read_u32(Path::new(&base).join("mtu"));
    let state = read_string(Path::new(&base).join("operstate"));
    let mac = read_string(Path::new(&base).join("address"));
    let qlen = read_u32(Path::new(&base).join("tx_queue_len"));
    SysMeta {
        mtu,
        state,
        mac,
        qdisc: None,
        qlen,
    }
}

fn read_u32(path: impl AsRef<Path>) -> Option<u32> {
    fs::read_to_string(path).ok()?.trim().parse().ok()
}

fn read_string(path: impl AsRef<Path>) -> Option<String> {
    fs::read_to_string(path).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn collect_kernel_sockets() -> Vec<SocketEntry> {
    let mut sockets = Vec::new();
    sockets.extend(parse_socket_table("/proc/net/tcp", "tcp", false));
    sockets.extend(parse_socket_table("/proc/net/tcp6", "tcp6", true));
    sockets.extend(parse_socket_table("/proc/net/udp", "udp", false));
    sockets.extend(parse_socket_table("/proc/net/udp6", "udp6", true));
    sockets
}

fn parse_socket_table(path: &str, proto: &str, is_v6: bool) -> Vec<SocketEntry> {
    let Ok(content) = fs::read_to_string(path) else { return Vec::new(); };
    content
        .lines()
        .skip(1)
        .filter_map(|line| parse_socket_line(line, proto, is_v6))
        .collect()
}

fn parse_socket_line(line: &str, proto: &str, is_v6: bool) -> Option<SocketEntry> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 10 {
        return None;
    }
    let local = parts[1].split(':').collect::<Vec<_>>();
    let remote = parts[2].split(':').collect::<Vec<_>>();
    if local.len() != 2 || remote.len() != 2 {
        return None;
    }

    let local_addr = decode_addr(local[0], is_v6)?;
    let remote_addr = decode_addr(remote[0], is_v6)?;
    let local_port = u16::from_str_radix(local[1], 16).ok()?;
    let remote_port = u16::from_str_radix(remote[1], 16).ok()?;

    let queues = parts[4].split(':').collect::<Vec<_>>();
    if queues.len() != 2 {
        return None;
    }
    let tx_queue = u64::from_str_radix(queues[0], 16).unwrap_or(0);
    let rx_queue = u64::from_str_radix(queues[1], 16).unwrap_or(0);

    let state_hex = parts[3];
    let inode = parts[9].parse::<u64>().unwrap_or(0);

    Some(SocketEntry {
        proto: proto.to_string(),
        local_addr,
        local_port,
        remote_addr,
        remote_port,
        state: socket_state(state_hex),
        rx_queue,
        tx_queue,
        inode,
    })
}

fn socket_state(hex: &str) -> String {
    match hex {
        "01" => "ESTABLISHED",
        "02" => "SYN_SENT",
        "03" => "SYN_RECV",
        "04" => "FIN_WAIT1",
        "05" => "FIN_WAIT2",
        "06" => "TIME_WAIT",
        "07" => "CLOSE",
        "08" => "CLOSE_WAIT",
        "09" => "LAST_ACK",
        "0A" => "LISTEN",
        "0B" => "CLOSING",
        _ => hex,
    }
    .to_string()
}

fn decode_addr(hex: &str, is_v6: bool) -> Option<String> {
    if is_v6 {
        decode_ipv6(hex).map(|ip| ip.to_string())
    } else {
        let num = u32::from_str_radix(hex, 16).ok()?;
        Some(std::net::Ipv4Addr::from(u32::from_be(num)).to_string())
    }
}

fn decode_ipv6(hex: &str) -> Option<std::net::Ipv6Addr> {
    if hex.len() != 32 {
        return None;
    }
    let mut bytes = Vec::with_capacity(16);
    for i in (0..hex.len()).step_by(2) {
        bytes.push(u8::from_str_radix(&hex[i..i + 2], 16).ok()?);
    }
    // Addresses are little-endian per 32-bit block; reverse each 4-byte chunk
    for chunk in bytes.chunks_mut(4) {
        chunk.reverse();
    }
    Some(std::net::Ipv6Addr::from(<[u8; 16]>::try_from(bytes).ok()?))
}

fn build_inode_process_map(max_pids: usize, max_fds_per_pid: usize) -> HashMap<u64, ProcInfo> {
    let mut map = HashMap::new();
    let Ok(entries) = fs::read_dir("/proc") else { return map; };

    for (idx, entry) in entries.flatten().enumerate() {
        if idx >= max_pids { break; }
        let filename = entry.file_name();
        let pid_str = filename.to_string_lossy();
        if !pid_str.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let pid: u32 = match pid_str.parse() { Ok(p) => p, Err(_) => continue };
        let base = entry.path();
        let name = fs::read_to_string(base.join("comm")).unwrap_or_default().trim().to_string();
        let exe = fs::read_link(base.join("exe")).ok().map(|p| p.display().to_string());

        let fd_dir = fs::read_dir(base.join("fd"));
        let Ok(fd_iter) = fd_dir else { continue; };

        for (fd_idx, fd_entry) in fd_iter.flatten().enumerate() {
            if fd_idx >= max_fds_per_pid { break; }
            if let Ok(link) = fs::read_link(fd_entry.path()) {
                if let Some(inode) = link.to_string_lossy().strip_prefix("socket:[") {
                    if let Some(inode) = inode.strip_suffix(']') {
                        if let Ok(num) = inode.parse::<u64>() {
                            map.entry(num).or_insert(ProcInfo {
                                pid,
                                name: name.clone(),
                                exe: exe.clone(),
                            });
                        }
                    }
                }
            }
        }
    }

    map
}

fn build_process_connections(sockets: &[SocketEntry], inode_map: &HashMap<u64, ProcInfo>) -> Vec<Value> {
    sockets
        .iter()
        .filter_map(|s| {
            inode_map.get(&s.inode).map(|p| {
                json!({
                    "pid": p.pid,
                    "name": p.name,
                    "exe": p.exe,
                    "protocol": s.proto,
                    "local_addr": s.local_addr,
                    "local_port": s.local_port,
                    "remote_addr": s.remote_addr,
                    "remote_port": s.remote_port,
                    "state": s.state,
                    "rx_queue": s.rx_queue,
                    "tx_queue": s.tx_queue,
                })
            })
        })
        .collect()
}

fn build_open_ports(sockets: &[SocketEntry], inode_map: &HashMap<u64, ProcInfo>) -> Vec<Value> {
    sockets
        .iter()
        .filter(|s| {
            if s.proto.starts_with("tcp") {
                s.state == "LISTEN"
            } else {
                s.remote_port == 0 && (s.remote_addr == "0.0.0.0" || s.remote_addr == "::")
            }
        })
        .map(|s| {
            let proc = inode_map.get(&s.inode);
            json!({
                "protocol": s.proto,
                "local_addr": s.local_addr,
                "local_port": s.local_port,
                "state": s.state,
                "pid": proc.map(|p| p.pid),
                "name": proc.map(|p| p.name.clone()),
                "exe": proc.and_then(|p| p.exe.clone()),
            })
        })
        .collect()
}

pub fn read_tcp_stats() -> Value {
    let (mut established, mut time_wait, mut close_wait, mut listen) = (0u32, 0u32, 0u32, 0u32);
    for path in &["/proc/net/tcp", "/proc/net/tcp6"] {
        if let Ok(c) = fs::read_to_string(path) {
            count_tcp_states(
                &c,
                &mut established,
                &mut time_wait,
                &mut close_wait,
                &mut listen,
            );
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

    #[test]
    fn socket_line_parses_ipv4_listen() {
        let line = "  0: 0100007F:1770 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 55555 1";
        let s = parse_socket_line(line, "tcp", false).expect("parsed");
        assert_eq!(s.local_addr, "127.0.0.1");
        assert_eq!(s.local_port, 6000);
        assert_eq!(s.remote_addr, "0.0.0.0");
        assert_eq!(s.state, "LISTEN");
        assert_eq!(s.inode, 55555);
    }

    #[test]
    fn socket_line_parses_ipv6_mapped() {
        let line = "  1: 0000000000000000FFFF00000100007F:0016 00000000000000000000000000000000:0000 01 00000000:00000000 00:00000000 00000000 1000 0 424242 1";
        let s = parse_socket_line(line, "tcp6", true).expect("parsed");
        assert_eq!(s.local_addr, "::ffff:127.0.0.1");
        assert_eq!(s.local_port, 22);
        assert_eq!(s.remote_addr, "::");
        assert_eq!(s.state, "ESTABLISHED");
    }

    #[test]
    fn decode_ipv6_handles_chunks() {
        let ip = decode_ipv6("0000000000000000FFFF00000100007F").unwrap();
        assert_eq!(ip.to_string(), "::ffff:127.0.0.1");
    }

    #[test]
    fn parse_ip_addr_json_extracts_fields() {
        let sample = r#"[
          {
            "ifname": "wlp0s20f3",
            "mtu": 1500,
            "operstate": "UP",
            "qdisc": "noqueue",
            "txqlen": 1000,
            "flags": ["BROADCAST", "UP"],
            "addr_info": [
              {"family": "inet", "local": "10.0.0.2", "prefixlen": 24, "broadcast": "10.0.0.255", "scope": "global"},
              {"family": "inet6", "local": "fe80::1", "prefixlen": 64, "scope": "link"}
            ]
          }
        ]"#;
        let mut map = HashMap::new();
        parse_ip_addr_json(sample, &mut map);
        let meta = map.get("wlp0s20f3").expect("meta");
        assert_eq!(meta.mtu, Some(1500));
        assert_eq!(meta.state.as_deref(), Some("UP"));
        assert_eq!(meta.qdisc.as_deref(), Some("noqueue"));
        assert_eq!(meta.qlen, Some(1000));
        assert_eq!(meta.addresses.len(), 2);
    }
}
