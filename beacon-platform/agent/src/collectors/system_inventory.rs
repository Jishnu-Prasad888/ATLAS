// collectors/system_inventory.rs — System Inventory Collector
// Collects relatively static host details (CPU model, shell, package counts,
// displays, users/groups, DNS/hosts, startup services, runtimes, batteries,
// Wi‑Fi/Bluetooth summaries). Heavy commands are throttled with a local cache
// (5 minute TTL) to avoid repeated work when the main agent interval is short.

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use super::trait_collector::Collector;
use crate::collectors::kernel::collect_from as collect_kernel;
use crate::engines::identity::AgentIdentity;

const CACHE_TTL: Duration = Duration::from_secs(300);

pub struct SystemInventoryCollector {
    identity: AgentIdentity,
    cache: Mutex<Option<(Instant, Value)>>,
}

impl SystemInventoryCollector {
    pub fn new(identity: AgentIdentity) -> Self {
        Self {
            identity,
            cache: Mutex::new(None),
        }
    }

    fn cached_or_collect(&self) -> Value {
        let mut guard = self.cache.lock().unwrap();
        let now = Instant::now();
        if let Some((ts, cached)) = &*guard {
            if now.duration_since(*ts) < CACHE_TTL {
                return cached.clone();
            }
        }

        let fresh = self.collect_now();
        *guard = Some((now, fresh.clone()));
        fresh
    }

    fn collect_now(&self) -> Value {
        json!({
            "identity": collect_kernel(&self.identity),
            "cpu_model": read_cpu_model(),
            "shell": resolve_shell(),
            "displays": detect_displays(),
            "users": read_passwd(),
            "groups": read_groups(),
            "dns": read_dns(),
            "hosts": read_hosts(),
            "startup_services": list_enabled_services(),
            "runtimes": runtime_versions(),
            "network_profiles": wifi_profiles(),
            "bluetooth": bluetooth_devices(),
            "battery": battery_status(),
        })
    }
}

#[async_trait]
impl Collector for SystemInventoryCollector {
    fn name(&self) -> &'static str {
        "system_inventory"
    }

    async fn collect(&self) -> Result<Value> {
        Ok(self.cached_or_collect())
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn read_cpu_model() -> Option<String> {
    if let Ok(data) = fs::read_to_string("/proc/cpuinfo") {
        for line in data.lines() {
            if let Some(rest) = line.strip_prefix("model name\t: ") {
                return Some(rest.trim().to_string());
            }
            if let Some(rest) = line.strip_prefix("Hardware\t: ") {
                return Some(rest.trim().to_string());
            }
        }
    }
    None
}

fn resolve_shell() -> Option<String> {
    if let Ok(s) = std::env::var("SHELL") {
        if !s.is_empty() {
            return Some(s);
        }
    }
    if let Ok(user) = std::env::var("USER") {
        if let Ok(passwd) = fs::read_to_string("/etc/passwd") {
            for line in passwd.lines() {
                let parts: Vec<&str> = line.split(':').collect();
                if parts.len() >= 7 && parts[0] == user {
                    return Some(parts[6].to_string());
                }
            }
        }
    }
    None
}

fn detect_displays() -> Value {
    // xrandr (X11) — check exit status so failing xrandr doesn't block DRM fallback
    match Command::new("xrandr").arg("--listmonitors").output() {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let monitor_count = stdout
                .lines()
                .filter(|l| {
                    l.trim()
                        .chars()
                        .next()
                        .map(|c| c.is_numeric())
                        .unwrap_or(false)
                })
                .count();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            return json!({
                "monitors": monitor_count,
                "raw": stdout.to_string(),
                "err": non_empty(stderr),
            });
        }
        _ => {}
    }

    // Fallback: count connected DRM connectors (works on Wayland/headless)
    let drm = Path::new("/sys/class/drm");
    if let Ok(entries) = drm.read_dir() {
        let mut connected = 0;
        for entry in entries.flatten() {
            let status_path = entry.path().join("status");
            if let Ok(status) = fs::read_to_string(status_path) {
                if status.trim().eq_ignore_ascii_case("connected") {
                    connected += 1;
                }
            }
        }
        return json!({ "monitors": connected, "source": "drm" });
    }

    json!({ "monitors": 0, "err": "no display info" })
}

fn read_passwd() -> Value {
    match fs::read_to_string("/etc/passwd") {
        Ok(c) => {
            let mut users = Vec::new();
            for line in c.lines() {
                let parts: Vec<&str> = line.split(':').collect();
                if parts.len() < 7 {
                    continue;
                }
                let user = parts[0];
                let uid = parts[2].parse::<u32>().unwrap_or(0);
                let shell = parts[6];

                // Skip system/service accounts without a real shell
                if shell.contains("nologin") || shell.contains("false") {
                    continue;
                }

                // Include normal users (uid >= 1000) and root
                if uid >= 1000 || user == "root" {
                    users.push(format!("{} ({})", user, shell));
                }
            }
            json!(users)
        }
        Err(_) => json!([]),
    }
}

fn read_groups() -> Value {
    match fs::read_to_string("/etc/group") {
        Ok(c) => json!(c.lines().take(100).collect::<Vec<_>>()),
        Err(_) => json!([]),
    }
}

fn read_dns() -> Value {
    json!({
        "resolv_conf": read_file_trimmed("/etc/resolv.conf", 4000),
    })
}

fn read_hosts() -> Value {
    json!({
        "hosts": read_file_trimmed("/etc/hosts", 4000),
    })
}

fn list_enabled_services() -> Value {
    if let Ok((stdout, stderr)) = run_cmd([
        "systemctl",
        "list-unit-files",
        "--type=service",
        "--state=enabled",
        "--no-legend",
        "--no-pager",
    ]) {
        return json!({
            "services": stdout.lines().take(200).map(|l| l.trim().to_string()).collect::<Vec<_>>(),
            "err": non_empty(stderr),
        });
    }
    json!({})
}

fn runtime_versions() -> Value {
    json!({
        "node": detect_node_version(),
        "python": run_version_cmds(&[
            &["python3", "--version"],
            &["python", "--version"],
            &["/usr/bin/python3", "--version"],
            &["/usr/local/bin/python3", "--version"],
            &["bash", "-lc", "python3 --version"],
        ]),
        "bun": run_version_cmds(&[
            &["bun", "--version"],
            &["/usr/local/bin/bun", "--version"],
            &["bash", "-lc", "bun --version"],
        ]),
        "deno": run_version_cmds(&[
            &["deno", "--version"],
            &["/usr/local/bin/deno", "--version"],
            &["bash", "-lc", "deno --version"],
        ]),
    })
}

fn detect_node_version() -> Option<String> {
    // 1) Direct PATH lookup
    if let Some(v) = try_node_at("node") {
        return Some(v);
    }

    // 2) Common absolute paths
    for path in ["/usr/local/bin/node", "/usr/bin/node", "/snap/bin/node"] {
        if let Some(v) = try_node_at(path) {
            return Some(v);
        }
    }

    // 3) User-scoped version managers (respect the invoking user even under sudo)
    if let Some(home) = home_dir() {
        if let Some(v) = find_nvm_node_in(&home).and_then(|p| try_node_at(&p)) {
            return Some(v);
        }
        if let Some(v) = find_fnm_node_in(&home).and_then(|p| try_node_at(&p)) {
            return Some(v);
        }
        let volta = home.join(".volta/bin/node");
        if volta.exists() {
            if let Some(v) = try_node_at(&volta.to_string_lossy()) {
                return Some(v);
            }
        }
        if let Some(v) = find_asdf_node_in(&home).and_then(|p| try_node_at(&p)) {
            return Some(v);
        }
    }

    // 4) Login shell as the original user (if invoked via sudo)
    if let Ok(sudo_user) = std::env::var("SUDO_USER") {
        if !sudo_user.is_empty() && sudo_user != "root" {
            if let Ok(out) = Command::new("sudo")
                .args([
                    "-u",
                    &sudo_user,
                    "-i",
                    "--",
                    "bash",
                    "-lc",
                    "command -v node && node --version",
                ])
                .output()
            {
                if out.status.success() {
                    let text = String::from_utf8_lossy(&out.stdout);
                    if let Some(last) = text.lines().last() {
                        let v = last.trim();
                        if !v.is_empty() {
                            return Some(v.to_string());
                        }
                    }
                }
            }
        }
    }

    None
}

fn wifi_profiles() -> Value {
    let base = Path::new("/etc/NetworkManager/system-connections");
    if !base.exists() {
        return json!({ "profiles": [] });
    }
    let mut ssids = Vec::new();
    if let Ok(entries) = fs::read_dir(base) {
        for entry in entries.flatten().take(50) {
            if let Ok(content) = fs::read_to_string(entry.path()) {
                for line in content.lines() {
                    if let Some(rest) = line.strip_prefix("ssid=") {
                        ssids.push(rest.trim().to_string());
                        break;
                    }
                }
            }
        }
    }
    json!({ "profiles": ssids })
}

fn bluetooth_devices() -> Value {
    // Try bluetoothctl devices
    if let Ok((stdout, stderr)) = run_cmd(["bluetoothctl", "devices"]) {
        let devices: Vec<String> = stdout
            .lines()
            .filter_map(|l| l.strip_prefix("Device "))
            .map(|rest| rest.trim().to_string())
            .collect();
        if !devices.is_empty() {
            return json!({ "paired": devices, "err": non_empty(stderr) });
        }
    }

    // Fallback: read /var/lib/bluetooth/<adapter>/<device>/info
    let mut devices = Vec::new();
    let base = PathBuf::from("/var/lib/bluetooth");
    if let Ok(adapters) = base.read_dir() {
        for ad in adapters.flatten() {
            let ad_path = ad.path();
            if !ad_path.is_dir() {
                continue;
            }
            if let Ok(devs) = ad_path.read_dir() {
                for dev in devs.flatten() {
                    let info = dev.path().join("info");
                    if let Ok(content) = fs::read_to_string(info) {
                        let mut name = None;
                        for line in content.lines() {
                            if let Some(rest) = line.strip_prefix("Name=") {
                                name = Some(rest.trim().to_string());
                                break;
                            }
                        }
                        let entry = format!(
                            "{} ({})",
                            name.unwrap_or_else(|| "unknown".into()),
                            dev.file_name().to_string_lossy()
                        );
                        devices.push(entry);
                    }
                }
            }
        }
    }

    json!({ "paired": devices })
}

fn battery_status() -> Value {
    let power_path = Path::new("/sys/class/power_supply");
    if !power_path.exists() {
        return json!({ "present": false });
    }
    if let Ok(entries) = power_path.read_dir() {
        for entry in entries.flatten() {
            let name = entry.file_name();
            if let Some(n) = name.to_str() {
                if n.starts_with("BAT") {
                    let capacity = read_file_trimmed(entry.path().join("capacity"), 32)
                        .and_then(|s| s.parse::<u8>().ok());
                    let status = read_file_trimmed(entry.path().join("status"), 64);
                    return json!({
                        "present": true,
                        "capacity_pct": capacity,
                        "status": status,
                    });
                }
            }
        }
    }
    json!({ "present": false })
}

fn run_version(cmd: impl IntoIterator<Item = &'static str>) -> Option<String> {
    run_cmd(cmd).ok().map(|(out, _)| out.trim().to_string())
}

fn run_version_cmds(cmds: &[&[&'static str]]) -> Option<String> {
    for cmd in cmds {
        if let Some(v) = run_version(cmd.iter().copied()) {
            return Some(v);
        }
    }
    None
}

fn try_node_at(path: impl AsRef<str>) -> Option<String> {
    let out = Command::new(path.as_ref()).arg("--version").output().ok()?;
    if !out.status.success() {
        return None;
    }
    let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if v.is_empty() {
        None
    } else {
        Some(v)
    }
}

fn home_dir() -> Option<PathBuf> {
    if let Ok(sudo_user) = std::env::var("SUDO_USER") {
        if !sudo_user.is_empty() && sudo_user != "root" {
            if let Some(home) = home_from_passwd(&sudo_user) {
                if home.exists() {
                    return Some(home);
                }
            }
        }
    }

    std::env::var("HOME")
        .ok()
        .map(PathBuf::from)
        .filter(|p| p.exists())
}

fn home_from_passwd(user: &str) -> Option<PathBuf> {
    let passwd = fs::read_to_string("/etc/passwd").ok()?;
    for line in passwd.lines() {
        let parts: Vec<&str> = line.split(':').collect();
        if parts.len() >= 6 && parts[0] == user {
            return Some(PathBuf::from(parts[5]));
        }
    }
    None
}

fn find_nvm_node_in(home: &Path) -> Option<String> {
    latest_node_bin(&home.join(".nvm/versions/node"))
}

fn find_fnm_node_in(home: &Path) -> Option<String> {
    latest_node_bin(&home.join(".fnm/node-versions"))
}

fn find_asdf_node_in(home: &Path) -> Option<String> {
    latest_node_bin(&home.join(".asdf/installs/nodejs"))
}

fn latest_node_bin(base: &Path) -> Option<String> {
    if !base.exists() {
        return None;
    }
    let mut versions: Vec<PathBuf> = fs::read_dir(base)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    versions.sort();
    versions.reverse();
    for v in versions {
        let candidate = v.join("bin/node");
        if candidate.exists() {
            return Some(candidate.to_string_lossy().into());
        }
        let alt = v.join("installation/bin/node");
        if alt.exists() {
            return Some(alt.to_string_lossy().into());
        }
    }
    None
}

fn run_cmd<I, S>(cmd: I) -> Result<(String, String)>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let mut iter = cmd.into_iter();
    let program = iter.next().ok_or_else(|| anyhow!("empty command"))?.into();
    let args: Vec<String> = iter.map(|s| s.into()).collect();
    let output = Command::new(program).args(&args).output()?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    Ok((stdout, stderr))
}

fn read_file_trimmed<P: AsRef<Path>>(path: P, max_len: usize) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|s| s.trim().chars().take(max_len).collect())
        .filter(|s: &String| !s.is_empty())
}

fn non_empty(s: String) -> Option<String> {
    if s.trim().is_empty() {
        None
    } else {
        Some(s)
    }
}
