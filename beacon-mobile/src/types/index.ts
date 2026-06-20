// ─── Auth ─────────────────────────────────────────────────────────────────────

export type Role = 'viewer' | 'administrator'

export interface User {
  id: number
  username: string
  email: string
  role: Role
  is_active: boolean
  created_at: string
  last_login: string | null
}

export interface TokenPair {
  access: string
  refresh: string
}

export interface JwtPayload {
  token_type: 'access' | 'refresh'
  user_id: number
  username: string
  role: Role
  jti: string
  exp: number
  iat: number
}

export interface ApiErrorBody {
  detail?: string
  [key: string]: unknown
}

// ─── Agents ───────────────────────────────────────────────────────────────────

export type AgentStatus =
  | 'BOOTING' | 'INITIALIZING' | 'ONLINE' | 'DEGRADED'
  | 'OFFLINE_BUFFERING' | 'RECOVERING' | 'FAILED' | 'SHUTTING_DOWN' | 'OFFLINE'

export interface Agent {
  id: number
  agent_id: string
  hostname: string
  os: string | null
  architecture: string | null
  version: string | null
  tags: string[]
  status: AgentStatus
  is_active: boolean
  registered_at: string
  last_seen: string | null
  metadata: Record<string, unknown>
  collector_health: CollectorHealth[]
  is_stale: boolean
}

export interface AgentListParams {
  tag?: string
  status?: AgentStatus
  search?: string
  page?: number
  page_size?: number
}

// ─── Health ───────────────────────────────────────────────────────────────────

export interface CollectorHealth {
  collector: string
  status: string
  last_run: string | null
  last_success: string | null
  last_failure: string | null
  failure_count: number
}

export interface AgentHealth {
  agent_id: string
  hostname: string
  status: AgentStatus
  last_seen: string | null
  is_stale: boolean
  collectors: Record<string, CollectorHealth>
}

export interface FleetHealth {
  server_status: string
  timestamp: string
  agents: {
    total: number
    online: number
    degraded: number
    offline: number
  }
  latest_snapshot: Record<string, unknown> | null
}

// ─── Telemetry ────────────────────────────────────────────────────────────────

export type MetricType = 'cpu' | 'ram' | 'storage' | 'network' | 'process' | 'systemd' | 'docker' | 'kubernetes' | 'kernel' | 'temperature' | 'power'
export type MetricResolution = 'raw' | '1min' | '1hour'
export type WsChannel = 'metrics' | 'logs' | 'telemetry' | 'health'

export interface Metric {
  id: number
  agent_id: string
  metric_type: MetricType
  resolution: MetricResolution
  timestamp: string
  data: unknown
  schema_version: string
}

export interface CpuData {
  usage_pct: number
  per_core?: number[]
  freq_mhz?: number
  temp_c?: number | null
  load_1?: number
  load_5?: number
  load_15?: number
  ctx_switches?: number
  interrupts?: number
}

export interface RamData {
  total_bytes: number
  used_bytes: number
  free_bytes: number
  usage_pct: number
  swap_total?: number
  swap_used?: number
}

export interface NetworkInterface {
  name: string
  rx_bytes: number
  tx_bytes: number
  rx_bytes_rate: number
  tx_bytes_rate: number
  rx_packets?: number
  tx_packets?: number
  rx_errors?: number
  tx_errors?: number
}

export interface NetworkData {
  interfaces: NetworkInterface[]
}

export interface Disk {
  device: string
  mountpoint: string
  fstype: string
  total_bytes: number
  used_bytes: number
  free_bytes: number
  usage_pct: number
  read_bytes?: number
  write_bytes?: number
}

export interface StorageData {
  disks: Disk[]
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

export interface TelemetryQueryParams {
  agent_id?: string
  metric_type?: MetricType
  resolution?: MetricResolution
  start?: string
  end?: string
  limit?: number
  page?: number
}

// ─── Logs ─────────────────────────────────────────────────────────────────────

export type LogSource = 'systemd-journald' | 'syslog' | 'kernel' | 'docker' | 'kubernetes' | 'internal'
export type LogSeverity = 'Trace' | 'Debug' | 'Info' | 'Warning' | 'Error' | 'Critical'

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

export interface LogQueryParams {
  agent_id?: string
  source?: LogSource
  severity?: LogSeverity
  search?: string
  start?: string
  end?: string
  limit?: number
  page?: number
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

export interface AuditQueryParams {
  user?: string
  action?: string
  resource?: string
  start?: string
  end?: string
  limit?: number
  page?: number
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

// ─── App Settings ─────────────────────────────────────────────────────────────

export interface AppSettings {
  apiBaseUrl: string
  wsBaseUrl: string
  apiPrefix: string
  wsPath: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  apiBaseUrl: '',
  wsBaseUrl: '',
  apiPrefix: '/api/v1',
  wsPath: '/ws/subscribe/',
}
