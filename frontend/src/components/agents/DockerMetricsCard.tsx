import { useMemo, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Maximize2, X as CloseIcon } from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────
interface Container {
  id: string; name: string; image: string; state: string; restarts: number;
}
interface CpuSample { container_id: string; cpu_percent: number; cpu_system_usage: number; throttled_periods: number; throttled_time: number; }
interface MemSample { container_id: string; memory_usage: number; memory_limit: number; memory_percent: number; }
interface NetSample { container_id: string; interfaces: Array<{ name: string; rx_bytes: number; tx_bytes: number }>; }
interface DiskSample { container_id: string; read_bytes: number; write_bytes: number; }
interface HealthStatus { container_id: string; health_status: string; }
interface LogEntryData { timestamp: string; stream: string; message: string; }
interface LogSample { container_id: string; entries: LogEntryData[]; }
interface SecurityProfile { container_id: string; privileged: boolean; readonly_rootfs: boolean; host_network: boolean; host_pid: boolean; docker_socket_mounted: boolean; user: string; capabilities: string[]; seccomp_profile: string; apparmor_profile: string; }
interface ProcessEntry { pid: number; command: string; cpu_percent: number; memory_bytes: number; }
interface ProcessSample { container_id: string; capped: boolean; processes: ProcessEntry[]; }
interface TopologyNetwork { network_name: string; ip_address: string; gateway: string; ports: Array<{ private_port: number; public_port?: number; protocol: string }>; }
interface TopologySample { container_id: string; networks: TopologyNetwork[]; }
interface Image { image_id: string; repo_tags: string[]; repo_digests: string[]; }
interface InventoryContainer { container_id: string; name: string; image: string; state: string; restart_count: number; created: string; }
interface DockerData {
  inventory: { containers: InventoryContainer[] };
  summary: { total_containers: number; state_counts: Record<string, number>; last_event: string; resource_totals: { cpu_percent_avg: number; cpu_system_usage_sum: number; cpu_throttled_periods_sum: number; cpu_throttled_time_sum: number; memory_usage_bytes_sum: number; memory_limit_bytes_sum: number; memory_percent_avg: number; network_rx_bytes_sum: number; network_tx_bytes_sum: number; block_read_bytes_sum: number; block_write_bytes_sum: number; pids_sum: number; } | null };
  host: { metrics: { hostname: string; cpu_percent: number; memory_used: number; memory_total: number; disk_used: number; disk_total: number; load_1: number; load_5: number; load_15: number; uptime: number; } };
  metrics: { cpu: { samples: CpuSample[] }; memory: { samples: MemSample[] }; disk: { samples: DiskSample[] }; network: { samples: NetSample[] } };
  health: { statuses: HealthStatus[] };
  lifecycle: { events: Array<{ timestamp: string; container_id: string; event: string; attributes: Record<string, string> }> };
  logs: { samples: LogSample[] };
  security: { profiles: SecurityProfile[] };
  processes: { samples: ProcessSample[] };
  filesystem: { samples: unknown[] };
  topology: { samples: TopologySample[] };
  images: { images: Image[] };
  collector_disabled: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function formatBytes(b: number): string {
  if (b == null || isNaN(b)) return "–";
  if (b === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(Math.abs(b)) / Math.log(1024));
  return (b / Math.pow(1024, i)).toFixed(1) + " " + units[i];
}
function timeAgo(ts: string): string {
  if (!ts) return "–";
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }
function rng(lo: number, hi: number): number { return lo + Math.random() * (hi - lo); }

// ─── Mock data generator ─────────────────────────────────────────────────────
function generateMockData(): DockerData {
  const containers: Container[] = [
    { id: "a1b2c3d4e5f6", name: "api-gateway",   image: "nginx:alpine",          state: "running", restarts: 0 },
    { id: "b2c3d4e5f6a1", name: "postgres-db",   image: "postgres:15",           state: "running", restarts: 1 },
    { id: "c3d4e5f6a1b2", name: "redis-cache",   image: "redis:7-alpine",        state: "running", restarts: 0 },
    { id: "d4e5f6a1b2c3", name: "worker-queue",  image: "python:3.12-slim",      state: "running", restarts: 3 },
    { id: "e5f6a1b2c3d4", name: "prometheus",    image: "prom/prometheus:v2.47", state: "running", restarts: 0 },
    { id: "f6a1b2c3d4e5", name: "old-migrator",  image: "node:18",               state: "exited",  restarts: 0 },
  ];
  const cpuSamples: CpuSample[]  = containers.map(c => ({ container_id: c.id, cpu_percent: c.state === "running" ? rng(0.5, 45) : 0, cpu_system_usage: Math.floor(rng(1e9, 9e9)), throttled_periods: Math.floor(rng(0, 20)), throttled_time: Math.floor(rng(0, 1e7)) }));
  const memSamples: MemSample[]  = containers.map(c => ({ container_id: c.id, memory_usage: c.state === "running" ? Math.floor(rng(50e6, 800e6)) : 0, memory_limit: 2 * 1024 * 1024 * 1024, memory_percent: c.state === "running" ? rng(2, 38) : 0 }));
  const netSamples: NetSample[]  = containers.map(c => ({ container_id: c.id, interfaces: [{ name: "eth0", rx_bytes: Math.floor(rng(1e6, 500e6)), tx_bytes: Math.floor(rng(1e6, 200e6)) }] }));
  const diskSamples: DiskSample[] = containers.map(c => ({ container_id: c.id, read_bytes: Math.floor(rng(0, 100e6)), write_bytes: Math.floor(rng(0, 50e6)) }));
  const healthStatuses: HealthStatus[] = containers.filter(c => c.state === "running").map(c => ({ container_id: c.id, health_status: Math.random() > 0.15 ? "healthy" : "unhealthy" }));
  const events: Array<{ timestamp: string; container_id: string; event: string; attributes: Record<string, string> }> = [
    { timestamp: new Date(Date.now() - 2  * 60000).toISOString(), container_id: "a1b2c3d4e5f6", event: "start",         attributes: { exitCode: "0" } },
    { timestamp: new Date(Date.now() - 8  * 60000).toISOString(), container_id: "d4e5f6a1b2c3", event: "restart",       attributes: {} },
    { timestamp: new Date(Date.now() - 15 * 60000).toISOString(), container_id: "f6a1b2c3d4e5", event: "die",           attributes: { exitCode: "0" } },
    { timestamp: new Date(Date.now() - 22 * 60000).toISOString(), container_id: "b2c3d4e5f6a1", event: "health_status", attributes: { status: "healthy" } },
    { timestamp: new Date(Date.now() - 45 * 60000).toISOString(), container_id: "c3d4e5f6a1b2", event: "start",         attributes: {} },
  ];
  const logSamples: LogSample[] = containers.slice(0, 4).map(c => ({ container_id: c.id, entries: [
    { timestamp: new Date(Date.now() - Math.floor(rng(1000, 600000))).toISOString(),   stream: Math.random() > 0.8 ? "stderr" : "stdout", message: `[INFO] ${c.name} heartbeat ok` },
    { timestamp: new Date(Date.now() - Math.floor(rng(600000, 3600000))).toISOString(), stream: "stdout", message: `[INFO] Connection pool size=10` },
  ]}));
  const securityProfiles: SecurityProfile[] = containers.slice(0, 4).map(c => ({ container_id: c.id, privileged: false, readonly_rootfs: Math.random() > 0.5, host_network: false, host_pid: false, docker_socket_mounted: false, user: "1000", capabilities: Math.random() > 0.5 ? ["NET_BIND_SERVICE"] : [], seccomp_profile: "runtime/default", apparmor_profile: "docker-default" }));
  const processSamples: ProcessSample[] = containers.filter(c => c.state === "running").slice(0, 3).map(c => ({ container_id: c.id, capped: false, processes: [
    { pid: Math.floor(rng(100, 999)),  command: c.name,  cpu_percent: rng(0.1, 5), memory_bytes: Math.floor(rng(10e6, 200e6)) },
    { pid: Math.floor(rng(1000, 9999)), command: "/bin/sh", cpu_percent: 0,          memory_bytes: Math.floor(rng(1e6, 5e6)) },
  ]}));
  const topologySamples: TopologySample[] = containers.filter(c => c.state === "running").slice(0, 3).map((c, i) => ({ container_id: c.id, networks: [{ network_name: "app-network", ip_address: `172.18.0.${i + 2}`, gateway: "172.18.0.1", ports: i === 0 ? [{ private_port: 80, public_port: 8080, protocol: "tcp" }] : [] }] }));
  const images: Image[] = containers.map(c => ({ image_id: c.id, repo_tags: [c.image], repo_digests: [] }));
  const totalCpu = cpuSamples.reduce((s: number, x: CpuSample) => s + x.cpu_percent, 0) / cpuSamples.filter(x => x.cpu_percent > 0).length;
  const totalMem = memSamples.reduce((s: number, x: MemSample) => s + x.memory_usage, 0);
  const totalMemLimit = memSamples.reduce((s: number, x: MemSample) => s + x.memory_limit, 0);
  const totalRx = netSamples.reduce((s: number, x: NetSample) => s + x.interfaces.reduce((a: number, i) => a + i.rx_bytes, 0), 0);
  const totalTx = netSamples.reduce((s: number, x: NetSample) => s + x.interfaces.reduce((a: number, i) => a + i.tx_bytes, 0), 0);
  return {
    inventory: { containers: containers.map(c => ({ container_id: c.id, name: c.name, image: c.image, state: c.state, restart_count: c.restarts, created: new Date(Date.now() - rng(1e9, 9e9)).toISOString() })) },
    summary: { total_containers: containers.length, state_counts: { running: 5, exited: 1 }, last_event: events[0].timestamp, resource_totals: { cpu_percent_avg: totalCpu, cpu_system_usage_sum: cpuSamples.reduce((s: number, x: CpuSample) => s + x.cpu_system_usage, 0), cpu_throttled_periods_sum: cpuSamples.reduce((s: number, x: CpuSample) => s + x.throttled_periods, 0), cpu_throttled_time_sum: cpuSamples.reduce((s: number, x: CpuSample) => s + x.throttled_time, 0), memory_usage_bytes_sum: totalMem, memory_limit_bytes_sum: totalMemLimit, memory_percent_avg: (totalMem / totalMemLimit) * 100, network_rx_bytes_sum: totalRx, network_tx_bytes_sum: totalTx, block_read_bytes_sum: diskSamples.reduce((s: number, x: DiskSample) => s + x.read_bytes, 0), block_write_bytes_sum: diskSamples.reduce((s: number, x: DiskSample) => s + x.write_bytes, 0), pids_sum: 42 } },
    host: { metrics: { hostname: "prod-host-01", cpu_percent: 24.7, memory_used: 6.2 * 1024 * 1024 * 1024, memory_total: 16 * 1024 * 1024 * 1024, disk_used: 48 * 1024 * 1024 * 1024, disk_total: 256 * 1024 * 1024 * 1024, load_1: 1.42, load_5: 1.18, load_15: 0.97, uptime: 432000 } },
    metrics: { cpu: { samples: cpuSamples }, memory: { samples: memSamples }, disk: { samples: diskSamples }, network: { samples: netSamples } },
    health: { statuses: healthStatuses },
    lifecycle: { events },
    logs: { samples: logSamples },
    security: { profiles: securityProfiles },
    processes: { samples: processSamples },
    filesystem: { samples: [] },
    topology: { samples: topologySamples },
    images: { images },
    collector_disabled: false,
  } as DockerData;
}

// ─── CSS variable tokens ──────────────────────────────────────────────────────
const C: Record<string, string> = {
  bg:           "var(--color-bg, #0b0d10)",
  surface:      "var(--color-surface, rgba(255,255,255,0.02))",
  surface2:     "var(--color-surface-2, rgba(255,255,255,0.04))",
  border:       "var(--color-border, rgba(255,255,255,0.08))",
  borderStrong: "var(--color-border-strong, rgba(255,255,255,0.14))",
  text:         "var(--color-text, #f1f5f9)",
  muted:        "var(--color-text-muted, rgba(255,255,255,0.45))",
  dim:          "var(--color-text-dim, rgba(255,255,255,0.25))",
};

const STATE_COLOR: Record<string, string> = {
  running:    "#22c55e",
  exited:     "#6b7280",
  paused:     "#eab308",
  restarting: "#f97316",
  created:    "#3b82f6",
  dead:       "#ef4444",
  removing:   "#ef4444",
};

const HEALTH_COLOR: Record<string, string> = {
  healthy:   "#22c55e",
  unhealthy: "#ef4444",
  starting:  "#3b82f6",
  none:      "#6b7280",
};

// ─── Micro components ─────────────────────────────────────────────────────────
function Dot({ color }: { color: string }) {
  return (
    <span style={{
      display: "inline-block", width: 6, height: 6,
      borderRadius: "50%", background: color,
      marginRight: 6, flexShrink: 0,
    }} />
  );
}

function MiniGauge({ value, color }: { value: number; color: string }) {
  const pct = clamp(value ?? 0, 0, 100);
  return (
    <div style={{ position: "relative", height: 2, background: C.border, borderRadius: 999, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: "0 auto 0 0", width: `${pct}%`, background: color, borderRadius: 999, transition: "width .4s ease" }} />
    </div>
  );
}

function SectionLabel({ title, count }: { title: string; count?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
      <span style={{ fontSize: 10, fontWeight: 600, color: C.dim, fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.1em" }}>{title}</span>
      {count != null && (
        <span style={{ marginLeft: "auto", fontSize: 9, background: C.surface2, color: C.dim, border: `1px solid ${C.border}`, borderRadius: 20, padding: "1px 7px", fontFamily: "monospace" }}>{count}</span>
      )}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", minWidth: 0 }}>
      <div style={{ fontSize: 9, color: C.dim, fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: C.text, fontFamily: "monospace", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: C.dim, marginTop: 2, fontFamily: "monospace" }}>{sub}</div>}
    </div>
  );
}

// ─── Tiles ───────────────────────────────────────────────────────────────────
function TileHostSnapshot({ data }: { data: DockerData }) {
  const m = data.host.metrics;
  const cpuPct  = m.cpu_percent;
  const memPct  = (m.memory_used  / m.memory_total) * 100;
  const diskPct = (m.disk_used    / m.disk_total)   * 100;
  const rows = [
    { label: "CPU",    pct: cpuPct,  val: cpuPct.toFixed(1) + "%",                                              color: cpuPct  > 80 ? "#ef4444" : cpuPct  > 50 ? "#f97316" : "#22c55e" },
    { label: "Memory", pct: memPct,  val: formatBytes(m.memory_used) + " / " + formatBytes(m.memory_total),     color: memPct  > 85 ? "#ef4444" : "#22c55e" },
    { label: "Disk",   pct: diskPct, val: formatBytes(m.disk_used)   + " / " + formatBytes(m.disk_total),       color: diskPct > 90 ? "#ef4444" : "#22c55e" },
  ];
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <SectionLabel title="Host" />
      <div style={{ fontSize: 12, fontWeight: 600, color: C.text, fontFamily: "monospace", marginBottom: 2 }}>{m.hostname}</div>
      <div style={{ fontSize: 10, color: C.dim, fontFamily: "monospace", marginBottom: 16 }}>
        Up {Math.round(m.uptime / 3600)}h &nbsp;·&nbsp; load {m.load_1.toFixed(2)} / {m.load_5.toFixed(2)} / {m.load_15.toFixed(2)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
        {rows.map(r => (
          <div key={r.label}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
              <span style={{ fontSize: 9, color: C.dim, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "monospace" }}>{r.label}</span>
              <span style={{ fontSize: 9, color: r.color, fontFamily: "monospace", fontWeight: 600 }}>{r.val}</span>
            </div>
            <MiniGauge value={r.pct} color={r.color} />
          </div>
        ))}
      </div>
    </div>
  );
}

function TileSummary({ data }: { data: DockerData }) {
  const { summary } = data;
  const t = summary.resource_totals;
  const cpuAvgValue = typeof t?.cpu_percent_avg === "number" ? `${t.cpu_percent_avg.toFixed(1)}%` : "–";
  const cpuThrottleSub = typeof t?.cpu_throttled_periods_sum === "number" ? `${t.cpu_throttled_periods_sum} throttled` : "No throttle data";
  const memValue = typeof t?.memory_usage_bytes_sum === "number" ? formatBytes(t.memory_usage_bytes_sum) : "–";
  const memSub = typeof t?.memory_limit_bytes_sum === "number" ? `/ ${formatBytes(t.memory_limit_bytes_sum)}` : "limit n/a";
  const netSum = typeof t?.network_rx_bytes_sum === "number" && typeof t?.network_tx_bytes_sum === "number" ? t.network_rx_bytes_sum + t.network_tx_bytes_sum : null;
  const netValue = netSum != null ? formatBytes(netSum) : "–";
  const netSub = typeof t?.pids_sum === "number" ? `${t.pids_sum} PIDs` : "PIDs n/a";
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <SectionLabel title="Cluster" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, flex: 1 }}>
        <StatCard label="Containers" value={String(summary.total_containers)}              sub={`${summary.state_counts.running ?? 0} running`} />
        <StatCard label="CPU avg"    value={cpuAvgValue}    sub={cpuThrottleSub} />
        <StatCard label="Memory"     value={memValue} sub={memSub} />
        <StatCard label="Net I/O"    value={netValue} sub={netSub} />
      </div>
      <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 5 }}>
        {Object.entries(summary.state_counts).map(([state, count]) => (
          <div key={state} style={{ display: "flex", alignItems: "center", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20, padding: "3px 9px", gap: 5 }}>
            <Dot color={STATE_COLOR[state] ?? "#888"} />
            <span style={{ fontSize: 10, color: C.muted, fontFamily: "monospace" }}>{state}</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: C.text, fontFamily: "monospace" }}>{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TileInventory({ data }: { data: DockerData }) {
  const containers = data.inventory.containers;
  const cpuMap    = useMemo(() => new Map(data.metrics.cpu.samples.map(s    => [s.container_id, s])), [data]);
  const memMap    = useMemo(() => new Map(data.metrics.memory.samples.map(s => [s.container_id, s])), [data]);
  const healthMap = useMemo(() => new Map(data.health.statuses.map(s         => [s.container_id, s])), [data]);
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <SectionLabel title="Containers" count={containers.length} />
      <div style={{ flex: 1, overflow: "auto", marginRight: -4, paddingRight: 4 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {containers.map(c => {
            const cpu    = cpuMap.get(c.container_id) as CpuSample | undefined;
            const mem    = memMap.get(c.container_id) as MemSample | undefined;
            const health = healthMap.get(c.container_id) as HealthStatus | undefined;
            const cpuVal = cpu?.cpu_percent ?? 0;
            const memPct = mem?.memory_percent ?? 0;
            const hStatus = health?.health_status ?? "none";
            return (
              <div key={c.container_id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <Dot color={STATE_COLOR[c.state] ?? "#888"} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: C.text, fontFamily: "monospace", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                  {health && <span style={{ fontSize: 9, color: HEALTH_COLOR[hStatus] ?? "#888", fontFamily: "monospace", flexShrink: 0 }}>{hStatus}</span>}
                  {c.restart_count > 0 && (
                    <span style={{ fontSize: 9, color: "#f87171", fontFamily: "monospace", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 4, padding: "1px 5px", flexShrink: 0 }}>
                      r:{c.restart_count}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 9, color: C.dim, fontFamily: "monospace", marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.image}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {[
                    { label: "CPU", pct: cpuVal, val: cpuVal.toFixed(1) + "%", color: cpuVal > 70 ? "#f97316" : "#22c55e" },
                    { label: "MEM", pct: memPct, val: memPct.toFixed(1) + "%", color: memPct  > 80 ? "#ef4444" : "#22c55e" },
                  ].map(r => (
                    <div key={r.label}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontSize: 9, color: C.dim, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "monospace" }}>{r.label}</span>
                        <span style={{ fontSize: 9, fontFamily: "monospace", color: r.color }}>{r.val}</span>
                      </div>
                      <MiniGauge value={r.pct} color={r.color} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TileLogs({ data }: { data: DockerData }) {
  const nameMap = useMemo(() => { const m: Record<string, string> = {}; data.inventory.containers.forEach(c => { m[c.container_id] = c.name; }); return m; }, [data]);
  const entries = useMemo(() => {
    const all: Array<LogEntryData & { cid: string }> = data.logs.samples.flatMap(s => s.entries.map(e => ({ ...e, cid: s.container_id })));
    return all.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 20);
  }, [data]);
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <SectionLabel title="Logs" count={entries.length} />
      <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
        {entries.map((e, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "52px 80px 30px 1fr", gap: 6, alignItems: "start", paddingTop: 6, paddingBottom: 6, borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 9, color: C.dim, fontFamily: "monospace", paddingTop: 1 }}>{timeAgo(e.timestamp)}</span>
            <span style={{ fontSize: 9, color: C.muted, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingTop: 1 }}>{nameMap[e.cid] ?? e.cid.slice(0, 8)}</span>
            <span style={{ fontSize: 9, fontFamily: "monospace", color: e.stream === "stderr" ? "#f87171" : "#4ade80", textTransform: "uppercase", paddingTop: 1 }}>{e.stream === "stderr" ? "ERR" : "OUT"}</span>
            <span style={{ fontSize: 9, color: C.muted, fontFamily: "monospace", wordBreak: "break-all" }}>{e.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TileSecurity({ data }: { data: DockerData }) {
  const nameMap = useMemo(() => { const m: Record<string, string> = {}; data.inventory.containers.forEach(c => { m[c.container_id] = c.name; }); return m; }, [data]);
  const profiles = data.security.profiles;
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <SectionLabel title="Security" count={profiles.length} />
      <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {profiles.map(p => {
          const issues: string[] = [p.privileged && "privileged", !p.readonly_rootfs && "rw-fs", p.host_network && "host-net", p.host_pid && "host-pid", p.docker_socket_mounted && "sock-mount"].filter(Boolean) as string[];
          return (
            <div key={p.container_id} style={{ background: C.surface, border: `1px solid ${issues.length ? "rgba(239,68,68,0.18)" : C.border}`, borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: C.text, fontFamily: "monospace" }}>{nameMap[p.container_id] ?? p.container_id.slice(0, 12)}</span>
                <span style={{ fontSize: 9, color: issues.length ? "#ef4444" : "#22c55e", fontFamily: "monospace" }}>
                  {issues.length ? `${issues.length} risk${issues.length > 1 ? "s" : ""}` : "clean"}
                </span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {[
                  { label: p.privileged ? "privileged" : "rootless",      ok: !p.privileged },
                  { label: p.readonly_rootfs ? "read-only fs" : "rw fs", ok: p.readonly_rootfs },
                  { label: p.host_network ? "host-net" : "bridge",        ok: !p.host_network },
                  ...(p.capabilities.length ? [{ label: `caps:${p.capabilities.join(",")}`, ok: false }] : []),
                ].map((tag, i) => (
                  <span key={i} style={{ fontSize: 9, fontFamily: "monospace", background: tag.ok ? "rgba(34,197,94,0.07)" : "rgba(239,68,68,0.07)", color: tag.ok ? "#4ade80" : "#f87171", border: `1px solid ${tag.ok ? "rgba(34,197,94,0.18)" : "rgba(239,68,68,0.18)"}`, borderRadius: 4, padding: "2px 6px" }}>{tag.label}</span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TileNetwork({ data }: { data: DockerData }) {
  const nameMap = useMemo(() => { const m: Record<string, string> = {}; data.inventory.containers.forEach(c => { m[c.container_id] = c.name; }); return m; }, [data]);
  const netMap  = useMemo(() => new Map(data.metrics.network.samples.map(s => [s.container_id, s])), [data]);
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <SectionLabel title="Network" />
      <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {data.topology.samples.map(s => {
          const net = netMap.get(s.container_id) as NetSample | undefined;
          const rx  = net?.interfaces.reduce((a: number, i) => a + i.rx_bytes, 0) ?? 0;
          const tx  = net?.interfaces.reduce((a: number, i) => a + i.tx_bytes, 0) ?? 0;
          return (
            <div key={s.container_id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: C.text, marginBottom: 8, fontFamily: "monospace" }}>{nameMap[s.container_id] ?? s.container_id.slice(0, 12)}</div>
              {s.networks.map((n, i) => (
                <div key={i} style={{ marginBottom: 6 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontSize: 9, fontFamily: "monospace", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 4, padding: "1px 5px" }}>{n.network_name}</span>
                    <span style={{ fontSize: 9, color: C.dim, fontFamily: "monospace" }}>{n.ip_address}</span>
                  </div>
                  {n.ports.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                      {n.ports.map((p, j) => (
                        <span key={j} style={{ fontSize: 9, fontFamily: "monospace", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 4, padding: "1px 5px" }}>
                          {p.private_port}{p.public_port ? `→${p.public_port}` : ""}/{p.protocol}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 9, color: C.dim, fontFamily: "monospace" }}>rx {formatBytes(rx)}</div>
                <div style={{ fontSize: 9, color: C.dim, fontFamily: "monospace" }}>tx {formatBytes(tx)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TileProcesses({ data }: { data: DockerData }) {
  const nameMap = useMemo(() => { const m: Record<string, string> = {}; data.inventory.containers.forEach(c => { m[c.container_id] = c.name; }); return m; }, [data]);
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <SectionLabel title="Processes" />
      <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {data.processes.samples.map(s => (
          <div key={s.container_id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: C.text, marginBottom: 8, fontFamily: "monospace" }}>{nameMap[s.container_id] ?? s.container_id.slice(0, 12)}</div>
            <div style={{ display: "grid", gridTemplateColumns: "40px 1fr 46px 60px", gap: 4 }}>
              {["PID", "CMD", "CPU", "MEM"].map(h => (
                <div key={h} style={{ fontSize: 9, color: C.dim, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "monospace", paddingBottom: 5 }}>{h}</div>
              ))}
              {s.processes.map(p => [
                <div key={`${p.pid}-pid`} style={{ fontSize: 9, color: C.muted, fontFamily: "monospace" }}>{p.pid}</div>,
                <div key={`${p.pid}-cmd`} style={{ fontSize: 9, color: C.text, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.command}</div>,
                <div key={`${p.pid}-cpu`} style={{ fontSize: 9, color: C.muted, fontFamily: "monospace", textAlign: "right" }}>{p.cpu_percent.toFixed(1)}%</div>,
                <div key={`${p.pid}-mem`} style={{ fontSize: 9, color: C.muted, fontFamily: "monospace", textAlign: "right" }}>{formatBytes(p.memory_bytes)}</div>,
              ])}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TileImages({ data }: { data: DockerData }) {
  const images = Array.isArray(data.images?.images) ? data.images.images : [];
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <SectionLabel title="Images" count={images.length} />
      <div style={{ flex: 1, overflow: "auto", display: "flex", flexWrap: "wrap", alignContent: "flex-start", gap: 6 }}>
        {images.map((img: Image) => {
          const label = img.repo_tags[0] ?? img.image_id.slice(0, 12);
          const [name, tag] = label.includes(":") ? label.split(":") : [label, "latest"];
          return (
            <div key={img.image_id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 10px", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 10, color: C.muted, fontFamily: "monospace" }}>{name}</span>
              <span style={{ fontSize: 9, color: C.dim, fontFamily: "monospace", borderLeft: `1px solid ${C.border}`, paddingLeft: 6 }}>{tag}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Tile registry ────────────────────────────────────────────────────────────
const TILE_DEFS: Array<{ id: string; label: string; component: React.ComponentType<{ data: DockerData }>; defaultSpan: { col: number; row: number } }> = [
  { id: "summary",   label: "Cluster Summary", component: TileSummary,      defaultSpan: { col: 2, row: 1 } },
  { id: "host",      label: "Host Snapshot",   component: TileHostSnapshot, defaultSpan: { col: 1, row: 1 } },
  { id: "inventory", label: "Containers",      component: TileInventory,    defaultSpan: { col: 1, row: 2 } },
  { id: "logs",      label: "Logs",            component: TileLogs,         defaultSpan: { col: 2, row: 1 } },
  { id: "security",  label: "Security",        component: TileSecurity,     defaultSpan: { col: 1, row: 1 } },
  { id: "network",   label: "Network",         component: TileNetwork,      defaultSpan: { col: 1, row: 1 } },
  { id: "processes", label: "Processes",       component: TileProcesses,    defaultSpan: { col: 1, row: 1 } },
  { id: "images",    label: "Images",          component: TileImages,       defaultSpan: { col: 2, row: 1 } },
];

// ─── Bento Grid ───────────────────────────────────────────────────────────────
function BentoGrid({ data }: { data: DockerData }) {
  const [order, setOrder]   = useState<string[]>(TILE_DEFS.map(t => t.id));
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const dragSrc = useRef<string | null>(null);

  const visibleOrder = order.filter(id => !hidden.has(id));

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => { dragSrc.current = id; setDragging(id); e.dataTransfer.effectAllowed = "move"; }, []);
  const handleDragOver  = useCallback((e: React.DragEvent, id: string) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dragSrc.current !== id) setDragOver(id); }, []);
  const handleDrop      = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const src = dragSrc.current;
    if (!src || src === targetId) return;
    setOrder(prev => {
      const next = [...prev];
      const si = next.indexOf(src), ti = next.indexOf(targetId);
      next.splice(si, 1); next.splice(ti, 0, src);
      return next;
    });
    setDragging(null); setDragOver(null); dragSrc.current = null;
  }, []);
  const handleDragEnd = useCallback(() => { setDragging(null); setDragOver(null); dragSrc.current = null; }, []);
  const toggleHide    = useCallback((id: string) => { setHidden(prev => { const next = new Set(prev); if (next.has(id)) { next.delete(id); } else { next.add(id); } return next; }); }, []);

  const COLS  = 3;
  const ROW_H = 240;
  const GAP   = 12;

  return (
    <div style={{ fontFamily: "monospace", minHeight: "100vh", background: C.bg, color: C.text, padding: "24px" }}>

      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, paddingBottom: 20, borderBottom: `1px solid ${C.border}` }}>
        <div>
          <p style={{ fontSize: 10, fontFamily: "monospace", color: C.dim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Docker Monitor</p>
          <h1 style={{ fontSize: 15, fontFamily: "monospace", fontWeight: 600, color: C.text, marginBottom: 4 }}>Container Dashboard</h1>
          <p style={{ fontSize: 10, color: C.dim, fontFamily: "monospace" }}>Drag tiles to reorder · click ✕ to hide</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 4 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e" }} />
          <span style={{ fontSize: 10, color: C.dim, fontFamily: "monospace" }}>live</span>
          {hidden.size > 0 && (
            <button
              onClick={() => setHidden(new Set())}
              style={{ marginLeft: 4, fontSize: 10, fontFamily: "monospace", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, padding: "3px 10px", cursor: "pointer" }}
            >
              show all ({hidden.size})
            </button>
          )}
        </div>
      </div>

      {/* Hidden tile chips */}
      {hidden.size > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
          {[...hidden].map((id: string) => {
            const def = TILE_DEFS.find(t => t.id === id);
            return (
              <button key={id} onClick={() => toggleHide(id)} style={{ fontSize: 10, fontFamily: "monospace", background: "transparent", border: `1px dashed ${C.borderStrong}`, borderRadius: 20, color: C.muted, padding: "3px 10px", cursor: "pointer" }}>
                + {def?.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Bento grid */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`, gridAutoRows: `minmax(${ROW_H}px, auto)`, gridAutoFlow: "row dense", gap: GAP, alignItems: "stretch" }}>
        {visibleOrder.map(id => {
          const def  = TILE_DEFS.find(t => t.id === id);
          if (!def) return null;
          const Comp           = def.component;
          const span           = def.defaultSpan;
          const isDraggingThis = dragging === id;
          const isTarget       = dragOver  === id;

          return (
            <div
              key={id}
              draggable
              onDragStart={e => handleDragStart(e, id)}
              onDragOver={e  => handleDragOver(e, id)}
              onDrop={e      => handleDrop(e, id)}
              onDragEnd={handleDragEnd}
              style={{
                gridColumn: `span ${Math.min(span.col, COLS)}`,
                gridRow:    `span ${span.row}`,
                minHeight:  ROW_H * span.row + GAP * (span.row - 1),
                background: C.surface,
                border:     `1px solid ${isTarget ? C.borderStrong : C.border}`,
                borderRadius: 10,
                padding:    "16px 18px",
                cursor:     "grab",
                transition: "opacity .2s, border-color .15s",
                opacity:    isDraggingThis ? 0.3 : 1,
                position:   "relative",
              }}
            >
              <div style={{ position: "absolute", top: 10, right: 10, display: "flex", gap: 6, zIndex: 2 }}>
                <button
                  onClick={(e: React.MouseEvent) => { e.stopPropagation(); setExpanded(id); }}
                  title="Expand"
                  style={{
                    width: 24, height: 24, borderRadius: 6,
                    background: "transparent", border: `1px solid ${C.border}`,
                    color: C.dim, cursor: "pointer", fontSize: 10,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: "monospace", lineHeight: 1,
                  }}
                >
                  <Maximize2 size={12} />
                </button>
                <button
                  onClick={(e: React.MouseEvent) => { e.stopPropagation(); toggleHide(id); }}
                  title="Hide tile"
                  style={{
                    width: 24, height: 24, borderRadius: 6,
                    background: "transparent", border: `1px solid ${C.border}`,
                    color: C.dim, cursor: "pointer", fontSize: 10,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: "monospace", lineHeight: 1,
                  }}
                >
                  <CloseIcon size={12} />
                </button>
              </div>

              <div style={{ position: "relative", height: "100%" }}>
                <Comp data={data} />
              </div>
            </div>
          );
        })}
      </div>

      {expanded && (() => {
        const def = TILE_DEFS.find(t => t.id === expanded);
        if (!def) return null;
        const Comp = def.component;
        return createPortal(
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18, zIndex: 99 }}>
            <div style={{ position: "relative", background: C.surface, border: `1px solid ${C.borderStrong}`, borderRadius: 12, padding: "18px 20px", maxWidth: "60vw", maxHeight: "75vh", width: "fit-content", height: "fit-content", overflow: "auto", boxShadow: "0 25px 80px rgba(0,0,0,0.45)" }}>
              <button
                onClick={() => setExpanded(null)}
                title="Close"
                style={{ position: "absolute", top: 10, right: 10, width: 28, height: 28, borderRadius: 8, background: "transparent", border: `1px solid ${C.border}`, color: C.dim, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <CloseIcon size={14} />
              </button>
              <div>
                <Comp data={data} />
              </div>
            </div>
          </div>,
          document.body,
        );
      })()}

      {/* Footer */}
      <div style={{ marginTop: 24, paddingTop: 14, borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 10, color: C.dim, fontFamily: "monospace" }}>
          {data.inventory.containers.length} containers · {data.images.images.length} images · {data.host.metrics.hostname}
        </span>
        <span style={{ fontSize: 10, color: C.dim, fontFamily: "monospace" }}>
          last event {timeAgo(data.summary.last_event)}
        </span>
      </div>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function DockerDashboard({ data: propData }: { data?: unknown }) {
  const mockData = useMemo(() => generateMockData(), []);
  const data = (propData ?? mockData) as DockerData;

  if (!data || data.collector_disabled) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", color: C.dim, fontFamily: "monospace", fontSize: 12 }}>
        No Docker data available.
      </div>
    );
  }

  return <BentoGrid data={data} />;
}
