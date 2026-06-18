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

export interface StoragePartition {
  device: string
  name: string
  mount_point: string
  fs_type: string
  total_bytes: number
  used_bytes: number
  free_bytes: number
  usage_pct: number
  is_removable: boolean
  parent_disk?: string | null
}

export type StorageFilesystem = StoragePartition

export interface StorageDisk {
  device: string
  name: string
  fs_type: string
  total_bytes: number
  used_bytes: number
  free_bytes: number
  usage_pct: number
  is_removable: boolean
  mount_points: string[]
  partition_count: number
  partitions?: StoragePartition[]
  is_os_disk?: boolean
}

export interface StorageData {
  partitions: StoragePartition[]
  filesystems: StoragePartition[]
  disks: StorageDisk[]
  os_disk?: StorageDisk
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
  sha256?: string | null
  timestamp: string
  user: string
  ip_address: string | null
  action: string
  resource: string
  resource_id: string
  request_id?: string | number | null
  details: Record<string, unknown>
  success: boolean
}

// ─── Docker Metrics ───────────────────────────────────────────────────────────

export type DockerStateCounts = Record<string, number>

export interface DockerResourceTotals {
  containers_reporting: number
  cpu_percent_sum: number
  cpu_percent_avg: number
  cpu_system_usage_sum: number
  cpu_throttled_periods_sum: number
  cpu_throttled_time_sum: number
  memory_usage_bytes_sum: number
  memory_limit_bytes_sum: number
  memory_percent_avg: number
  memory_failcnt_sum: number
  network_rx_bytes_sum: number
  network_tx_bytes_sum: number
  block_read_bytes_sum: number
  block_write_bytes_sum: number
  block_read_ops_sum: number
  block_write_ops_sum: number
  pids_sum: number
}

export interface DockerSummary {
  total_containers: number
  state_counts: DockerStateCounts
  running: number
  stopped: number
  paused: number
  restarting: number
  failures: number
  last_event: string | null
  resource_totals: DockerResourceTotals | null
}

export interface ContainerInventoryItem {
  container_id: string
  name: string
  image: string
  image_id: string
  created_at: string | null
  started_at: string | null
  finished_at: string | null
  state: string
  status: string
  restart_count: number
  labels: Record<string, string>
  env: string[]
  hostname: string | null
  platform: string | null
  runtime: string | null
  pid: number | null
}

export interface DockerInventory {
  refresh_interval_seconds: number
  last_collected: string | null
  containers: ContainerInventoryItem[]
}

export interface ContainerLifecycleEvent {
  timestamp: string
  container_id: string
  event: string
  actor: string
  attributes: Record<string, string>
}

export interface DockerLifecycle {
  window_seconds: number
  last_collected: string | null
  events: ContainerLifecycleEvent[]
}

export interface ContainerCpuSample {
  container_id: string
  cpu_total_usage: number
  cpu_system_usage: number
  cpu_online_cores: number
  cpu_percent: number
  cpu_user_time: number
  cpu_kernel_time: number
  cpu_throttled_periods: number
  cpu_throttled_time: number
}

export interface DockerCpuMetrics {
  interval_seconds: number
  last_collected: string | null
  samples: ContainerCpuSample[]
}

export interface ContainerMemorySample {
  container_id: string
  memory_usage: number
  memory_limit: number
  memory_percent: number
  memory_cache: number
  memory_rss: number
  memory_swap: number
  memory_failcnt: number
  oom_events: number
}

export interface DockerMemoryMetrics {
  interval_seconds: number
  last_collected: string | null
  samples: ContainerMemorySample[]
}

export interface ContainerDiskSample {
  container_id: string
  read_bytes: number
  write_bytes: number
  read_ops: number
  write_ops: number
}

export interface DockerDiskMetrics {
  interval_seconds: number
  last_collected: string | null
  samples: ContainerDiskSample[]
}

export interface ContainerNetworkInterfaceSample {
  name: string
  rx_bytes: number
  tx_bytes: number
  rx_packets: number
  tx_packets: number
  rx_errors: number
  tx_errors: number
  rx_dropped: number
  tx_dropped: number
}

export interface ContainerNetworkSample {
  container_id: string
  interfaces: ContainerNetworkInterfaceSample[]
}

export interface DockerNetworkMetrics {
  interval_seconds: number
  last_collected: string | null
  samples: ContainerNetworkSample[]
}

export interface ContainerVolumeUsage {
  name: string
  destination: string
  source: string | null
  total_bytes: number | null
  used_bytes: number | null
  inode_usage: number | null
}

export interface ContainerFilesystemSample {
  container_id: string
  writable_layer_size: number | null
  total_volume_usage: number | null
  inode_usage: number | null
  volumes: ContainerVolumeUsage[]
}

export interface DockerFilesystemUsage {
  interval_seconds: number
  last_collected: string | null
  samples: ContainerFilesystemSample[]
}

export interface ContainerProcessEntry {
  pid: number
  ppid: number
  command: string
  cpu_percent: number
  memory_bytes: number
  state: string
}

export interface ContainerProcessSample {
  container_id: string
  processes: ContainerProcessEntry[]
  capped: boolean
}

export interface DockerProcessMetrics {
  interval_seconds: number
  last_collected: string | null
  samples: ContainerProcessSample[]
}

export interface ContainerLogEntry {
  timestamp: string
  stream: 'stdout' | 'stderr'
  message: string
}

export interface ContainerLogSample {
  container_id: string
  tail_limit: number
  entries: ContainerLogEntry[]
}

export interface DockerLogMetrics {
  last_collected: string | null
  streaming: boolean
  samples: ContainerLogSample[]
}

export interface ContainerHealthStatus {
  container_id: string
  health_status: string
  failing_streak: number
  last_check: string | null
  last_output: string | null
}

export interface DockerHealthMetrics {
  interval_seconds: number
  last_collected: string | null
  statuses: ContainerHealthStatus[]
}

export interface ContainerPortMapping {
  ip?: string | null
  private_port: number
  public_port?: number | null
  protocol: string
}

export interface ContainerNetworkAttachment {
  network_name: string
  ip_address: string
  gateway: string
  aliases: string[]
  ports: ContainerPortMapping[]
}

export interface ContainerTopologySample {
  container_id: string
  networks: ContainerNetworkAttachment[]
}

export interface DockerTopologyMetrics {
  interval_seconds: number
  last_collected: string | null
  samples: ContainerTopologySample[]
}

export interface ContainerSecurityProfile {
  container_id: string
  privileged: boolean
  readonly_rootfs: boolean
  user: string
  capabilities: string[]
  seccomp_profile: string
  apparmor_profile: string
  host_network: boolean
  host_pid: boolean
  docker_socket_mounted: boolean
}

export interface DockerSecurityMetrics {
  interval_seconds: number
  last_collected: string | null
  profiles: ContainerSecurityProfile[]
}

export interface DockerImageMetadata {
  image_id: string
  repo_tags: string[]
  repo_digests: string[]
  size: number
  created: string
  architecture: string
  os: string
}

export interface DockerImageMetrics {
  interval_seconds: number
  last_collected: string | null
  images: DockerImageMetadata[]
}

export interface DockerHostMetricsPayload {
  hostname: string
  cpu_percent: number
  memory_total: number
  memory_used: number
  disk_total: number
  disk_used: number
  load_1: number
  load_5: number
  load_15: number
  uptime: number
}

export interface DockerHostMetrics {
  interval_seconds: number
  last_collected: string | null
  metrics: DockerHostMetricsPayload | null
}

export interface ContainerCgroupMapping {
  container_id: string
  cgroup_path: string | null
}

export interface DockerCgroupMappings {
  last_collected: string | null
  mappings: ContainerCgroupMapping[]
}

export interface DockerData {
  generated_at: string
  collector_disabled?: boolean
  summary: DockerSummary
  inventory: DockerInventory
  lifecycle: DockerLifecycle
  metrics: {
    cpu: DockerCpuMetrics
    memory: DockerMemoryMetrics
    disk: DockerDiskMetrics
    network: DockerNetworkMetrics
  }
  filesystem: DockerFilesystemUsage
  processes: DockerProcessMetrics
  logs: DockerLogMetrics
  health: DockerHealthMetrics
  topology: DockerTopologyMetrics
  security: DockerSecurityMetrics
  images: DockerImageMetrics
  host: DockerHostMetrics
  cgroups: DockerCgroupMappings
}

// ─── Kubernetes Metrics ──────────────────────────────────────────────────────

export interface KubeNodeMetric {
  cpu_cores: number
  cpu_percent: number | null
  memory_bytes: number
  memory_percent: number | null
}

export interface KubeNode {
  name: string
  ready: boolean
  kubelet_version: string
  architecture: string
  os: string
  capacity_cpu: string
  capacity_memory: string
  allocatable_cpu: string
  allocatable_memory: string
  metrics: KubeNodeMetric | null
}

export interface KubeContainerState {
  type: string
  started_at?: string
  reason?: string
  message?: string
  exit_code?: number
  finished_at?: string
}

export interface KubeContainer {
  name: string
  image: string
  ready: boolean
  restarts: number
  state: KubeContainerState
  last_state: KubeContainerState
  image_id: string
  container_id: string
  started: boolean
}

export interface KubePodMetric {
  cpu_cores: number
  cpu_percent: number | null
  memory_bytes: number
  memory_percent: number | null
}

export interface KubePodCondition {
  type: string
  status: string
  reason: string
  message: string
  last_transition: string
}

export interface KubePod {
  name: string
  namespace: string
  phase: string
  node: string
  pod_ip: string
  host_ip: string
  qos_class: string
  reason: string
  start_time: string
  deletion_timestamp: string
  containers: KubeContainer[]
  init_containers: KubeContainer[]
  ephemeral_containers: KubeContainer[]
  conditions: KubePodCondition[]
  metrics: KubePodMetric | null
}

export interface KubeDeploymentCondition {
  type: string
  status: string
  reason: string
  message: string
  last_transition: string
}

export interface KubeDeployment {
  name: string
  namespace: string
  generation: number
  replicas: number
  updated_replicas: number
  ready_replicas: number
  available_replicas: number
  unavailable_replicas: number
  conditions: KubeDeploymentCondition[]
}

export interface KubeDaemonset {
  name: string
  namespace: string
  desired: number
  current: number
  ready: number
  available: number
  unavailable: number
  updated: number
  misscheduled: number
}

export interface KubeStatefulset {
  name: string
  namespace: string
  replicas: number
  ready_replicas: number
  current_replicas: number
  updated_replicas: number
  update_revision: string
}

export interface KubeServicePort {
  port: number
  target_port: number | string | null
  protocol: string
  node_port: number
}

export interface KubeService {
  name: string
  namespace: string
  type: string
  cluster_ip: string
  external_ips: string[]
  selector: string[]
  ports: KubeServicePort[]
}

export interface KubePVC {
  name: string
  namespace: string
  phase: string
  storage_class: string
  volume_name: string
  requested_storage: string
  capacity: string
  access_modes: string[]
}

export interface KubeEvent {
  name: string
  namespace: string
  creation_timestamp: string
  reason: string
  message: string
  type: string
  count: number
  last_timestamp: string
  first_timestamp: string
}

export interface KubeClusterResources {
  nodes_reporting: number
  cpu_usage_cores: number
  cpu_capacity_cores: number
  cpu_allocatable_cores: number
  cpu_percent_avg: number
  memory_usage_bytes: number
  memory_capacity_bytes: number
  memory_allocatable_bytes: number
}

export interface KubeWorkloads {
  deployments: KubeDeployment[]
  daemonsets: KubeDaemonset[]
  statefulsets: KubeStatefulset[]
  services: KubeService[]
  persistent_volume_claims: KubePVC[]
}

export interface KubernetesData {
  server_reachable: boolean
  nodes: KubeNode[]
  pods: KubePod[]
  events: KubeEvent[]
  node_count: number
  pod_count: number
  running_pods: number
  pending_pods: number
  failed_pods: number
  succeeded_pods: number
  unknown_pods: number
  crashloopbackoff_pods: number
  event_count: number
  node_metrics_available: boolean
  pod_metrics_available: boolean
  deployment_count: number
  daemonset_count: number
  statefulset_count: number
  service_count: number
  persistent_volume_claim_count: number
  cluster_resources: KubeClusterResources
  workloads: KubeWorkloads
  collector_disabled?: boolean
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
