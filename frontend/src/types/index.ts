// ─── Enums ────────────────────────────────────────────────────────────────────

export type Role = 'viewer' | 'administrator'

export type AgentStatus =
  | 'BOOTING'
  | 'INITIALIZING'
  | 'ONLINE'
  | 'DEGRADED'
  | 'OFFLINE_BUFFERING'
  | 'RECOVERING'
  | 'FAILED'
  | 'SHUTTING_DOWN'
  | 'OFFLINE'

export type CollectorStatus = 'Healthy' | 'Degraded' | 'Failed' | 'Disabled'

export type MetricType =
  | 'cpu'
  | 'ram'
  | 'storage'
  | 'network'
  | 'process'
  | 'systemd'
  | 'docker'
  | 'kubernetes'
  | 'kernel'
  | 'temperature'
  | 'power'

export type MetricResolution = 'raw' | '1min' | '1hour'

export type LogSeverity = 'Trace' | 'Debug' | 'Info' | 'Warning' | 'Error' | 'Critical'

export type LogSource =
  | 'systemd-journald'
  | 'syslog'
  | 'kernel'
  | 'docker'
  | 'kubernetes'
  | 'internal'

export type WsChannel = 'metrics' | 'logs' | 'telemetry' | 'health'

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface TokenPair {
  access: string
  refresh: string
}

export interface JwtPayload {
  token_type: string
  user_id: number
  username: string
  role: Role
  jti: string
  exp: number
  iat: number
}

// ─── User ─────────────────────────────────────────────────────────────────────

export interface User {
  id: number
  username: string
  email: string
  role: Role
  is_active: boolean
  created_at: string
  last_login: string | null
}

// ─── Agent ────────────────────────────────────────────────────────────────────

export interface CollectorHealth {
  collector: string
  status: CollectorStatus
  last_run: string | null
  last_success: string | null
  last_failure: string | null
  failure_count: number
  updated_at: string
}

export interface Agent {
  id: number
  agent_id: string
  hostname: string
  os: string
  architecture: string
  version: string
  tags: string[]
  status: AgentStatus
  is_active: boolean
  registered_at: string
  last_seen: string | null
  is_stale: boolean
  metadata: Record<string, unknown>
  collector_health: CollectorHealth[]
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

export interface Metric {
  id: number
  agent_id: string
  metric_type: MetricType
  resolution: MetricResolution
  timestamp: string
  data: Record<string, unknown>
  schema_version: string
}

export interface CpuData {
  usage_pct: number
  core_count: number
  load_avg_1m: number
  load_avg_5m: number
  load_avg_15m: number
  interrupts: number
  context_switches: number
  per_core: Array<{ core: number; usage_pct: number; frequency: number; name: string }>
  temperatures_c: Array<{ zone: number; type: string; temp_c: number }>
}

export interface RamData {
  total_bytes: number
  used_bytes: number
  free_bytes: number
  available_bytes: number
  usage_pct: number
  cached_bytes: number
  buffers_bytes: number
  slab_bytes: number
  dirty_bytes: number
  mapped_bytes: number
  swap: { total_bytes: number; used_bytes: number; free_bytes: number; usage_pct: number }
  hugepages: { total: number; free: number; size_kb: number }
}

export interface StorageFilesystem {
  name: string
  mount_point: string
  fs_type: string
  total_bytes: number
  used_bytes: number
  free_bytes: number
  usage_pct: number
  is_removable: boolean
}

export interface StorageData {
  filesystems: StorageFilesystem[]
  io_stats: Array<{
    device: string
    reads_total: number
    writes_total: number
    read_delta: number
    write_delta: number
  }>
}

export interface NetworkInterface {
  name: string
  rx_bytes: number
  tx_bytes: number
  rx_packets: number
  tx_packets: number
  rx_errors: number
  tx_errors: number
  rx_bytes_rate: number
  tx_bytes_rate: number
}

export interface NetworkData {
  interfaces: NetworkInterface[]
  tcp: { established: number; time_wait: number; close_wait: number; listening: number }
  udp: { sockets: number }
}

export interface ProcessData {
  total_processes: number
  collected: number
  capped: boolean
  processes: Array<{
    pid: number
    boot_id: string
    start_time: number
    name: string
    exe: string | null
    cpu_pct: number
    mem_bytes: number
    virtual_mem: number
    status: string
    parent_pid: number | null
    threads: number | null
  }>
}

export interface SystemdData {
  total_services: number
  running_services: number
  failed_services: number
  services: Array<{ name: string; load: string; active: string; sub: string; desc: string }>
}

export interface KernelData {
  kernel_version: string
  os_version: string
  os_type: string
  hostname: string
  architecture: string
  uptime_secs: number
  boot_time_unix: number
  cpu_count: number
  proc_version: string
  cmdline: string
}

export interface MetricConfig {
  agent_id: string
  cpu_enabled: boolean
  ram_enabled: boolean
  storage_enabled: boolean
  network_enabled: boolean
  process_enabled: boolean
  systemd_enabled: boolean
  docker_enabled: boolean
  kubernetes_enabled: boolean
  temperature_enabled: boolean
  power_enabled: boolean
  interval_seconds: number
  retention_days: number
  updated_at: string
}

// ─── Logs ─────────────────────────────────────────────────────────────────────

export interface LogEntry {
  id: number
  agent_id: string
  source: LogSource
  severity: LogSeverity
  message: string
  timestamp: string
  schema_version: string
  sequence_number: number | null
  extra: Record<string, unknown>
}

// ─── Audit ────────────────────────────────────────────────────────────────────

export interface AuditLog {
  id: number
  timestamp: string
  user: string
  ip_address: string | null
  action: string
  resource: string
  resource_id: string
  details: Record<string, unknown>
  success: boolean
}

// ─── Health ───────────────────────────────────────────────────────────────────

export interface FleetHealth {
  server_status: string
  timestamp: string
  agents: {
    total: number
    online: number
    degraded: number
    offline: number
  }
  latest_snapshot: Record<string, unknown>
}

export interface AgentHealth {
  agent_id: string
  hostname: string
  status: AgentStatus
  last_seen: string | null
  is_stale: boolean
  collectors: Record<
    string,
    {
      status: CollectorStatus
      last_run: string | null
      last_success: string | null
      failure_count: number
    }
  >
}

// ─── Config ───────────────────────────────────────────────────────────────────

export interface ServerConfig {
  key: string
  value: unknown
  encrypted: boolean
  updated_by: string
  updated_at: string
  description: string
}

export interface RetentionPolicy {
  raw_hours: number
  rollup_1m_days: number
  rollup_1h_days: number
}

// ─── WebSocket ────────────────────────────────────────────────────────────────

export interface WsEnvelope<T = unknown> {
  channel: WsChannel
  data: T
}

export interface WsSubscribeMessage {
  action: 'subscribe' | 'unsubscribe'
  channel: WsChannel
  agent_id: string
}

// ─── API Params ───────────────────────────────────────────────────────────────

export interface TelemetryQueryParams {
  agent_id?: string
  metric_type?: MetricType
  resolution?: MetricResolution
  start?: string
  end?: string
  limit?: number
}

export interface LogQueryParams {
  agent_id?: string
  source?: LogSource
  severity?: LogSeverity
  search?: string
  start?: string
  end?: string
  limit?: number
}

export interface AuditQueryParams {
  user?: string
  action?: string
  resource?: string
  start?: string
  end?: string
  limit?: number
}

export interface AgentListParams {
  tag?: string
  status?: AgentStatus
}

// ─── API Error ────────────────────────────────────────────────────────────────

export interface ApiErrorBody {
  detail?: string
  [field: string]: string | string[] | undefined
}
