import type { LogSeverity } from '@/types'

export interface LandingStat {
  label: string
  value: string
  detail: string
  accent: string
}

export interface LandingMetric {
  label: string
  value: number
  detail: string
  history: number[]
  accent: string
}

export interface LandingSignal {
  id: string
  time: string
  severity: LogSeverity
  source: string
  message: string
}

export const fleetStats: LandingStat[] = [
  { label: 'Fleet online', value: '39/42', detail: '2 degraded, 1 offline', accent: '#34d399' },
  { label: 'Live ingest', value: '128.4/s', detail: 'metrics arriving over WebSocket', accent: '#60a5fa' },
  { label: 'Queue replay', value: '18.2k', detail: 'events recovered after reconnect', accent: '#5eead4' },
  { label: 'Audit events', value: '9.8k', detail: 'immutable operational trail', accent: '#a78bfa' },
]

export const activeAgent = {
  hostname: 'prod-edge-07',
  id: 'sha256:8f42...d91c',
  os: 'Ubuntu 24.04 LTS',
  architecture: 'x86_64',
  version: 'beacon-agent v1.0.0',
  status: 'ONLINE',
  lastSeen: '12s ago',
  tags: ['edge', 'docker', 'gpu', 'k3s'],
}

export const metrics: LandingMetric[] = [
  { label: 'CPU', value: 37, detail: '16 cores, load 2.14', history: [22, 28, 31, 26, 39, 42, 37], accent: '#34d399' },
  { label: 'RAM', value: 61, detail: '38.7 GB / 64 GB', history: [45, 48, 52, 57, 59, 62, 61], accent: '#60a5fa' },
  { label: 'OS disk', value: 48, detail: '931 GB NVMe volume', history: [44, 45, 45, 46, 47, 48, 48], accent: '#5eead4' },
  { label: 'GPU', value: 72, detail: '2 devices, 41% memory', history: [34, 46, 58, 66, 71, 76, 72], accent: '#a78bfa' },
]

export const network = {
  iface: 'eno1',
  rx: '48.2 MB/s',
  tx: '12.8 MB/s',
  rxHistory: [18, 26, 31, 29, 45, 49, 48],
  txHistory: [6, 8, 11, 10, 13, 12, 13],
}

export const healthSnapshot = [
  { label: 'Server', value: 'healthy' },
  { label: 'Logs/s', value: '22.7' },
  { label: 'DB size', value: '14.8 GB' },
  { label: 'Snapshot', value: '12s ago' },
]

export const signals: LandingSignal[] = [
  {
    id: 'sig-1',
    time: '14:32:08',
    severity: 'Info',
    source: 'docker',
    message: 'container payments-api recovered after health retry',
  },
  {
    id: 'sig-2',
    time: '14:31:54',
    severity: 'Warning',
    source: 'kubernetes',
    message: 'k3s pod inventory-sync restarted on prod-edge-07',
  },
  {
    id: 'sig-3',
    time: '14:31:21',
    severity: 'Info',
    source: 'internal',
    message: 'offline queue replay completed, 18.2k events acknowledged',
  },
  {
    id: 'sig-4',
    time: '14:30:43',
    severity: 'Warning',
    source: 'kernel',
    message: 'nvme temperature normalized after fan curve change',
  },
  {
    id: 'sig-5',
    time: '14:29:58',
    severity: 'Info',
    source: 'systemd-journald',
    message: 'audit recorded retention policy update by ops-admin',
  },
]

export const featureGroups = [
  {
    title: 'Rust agents that keep working',
    eyebrow: 'Telemetry',
    body: 'Collect CPU, RAM, disk, network, process, systemd, Docker, Kubernetes, kernel, GPU, and inventory signals from Linux hosts without turning every incident into a shell session.',
  },
  {
    title: 'Designed for broken networks',
    eyebrow: 'Offline first',
    body: 'Agents buffer telemetry in local SQLite queues and replay cleanly when the connection returns, so edge sites and busy hosts do not disappear from the record.',
  },
  {
    title: 'Security built into the path',
    eyebrow: 'Control plane',
    body: 'TLS 1.3 transport, AES-256-GCM payload encryption, Argon2id credentials, JWT sessions, RBAC, and immutable audit trails keep operations observable without making them loose.',
  },
  {
    title: 'Incident analysis without the theater',
    eyebrow: 'ATLAS-AI',
    body: 'The analyst layer reads logs, metrics, health, and operations context to explain what changed, where it changed, and what to check next.',
  },
]

export const architectureHighlights = [
  {
    label: 'Transport',
    value: 'NATS JetStream',
    detail: 'Durable streams, replay, acknowledgements, retry handling, retention policies, and dead-letter queues between server and agents.',
  },
  {
    label: 'Scale target',
    value: '1 to 1000+ agents',
    detail: 'A single control plane is designed to supervise small labs and large Linux fleets without changing the architecture.',
  },
  {
    label: 'Execution model',
    value: 'Approved operations only',
    detail: 'No arbitrary shell strings. Work runs through typed, versioned namespaces with role requirements, timeouts, audit policy, and rollback policy.',
  },
  {
    label: 'Persistence',
    value: 'SQLite + PostgreSQL',
    detail: 'Agents keep local WAL-backed databases for config, metrics, logs, audit, and queue state; the server stores fleet history and audit centrally.',
  },
]

export const operationFlow = [
  'Operator selects a namespace, group, tag, or agent target.',
  'Server validates RBAC, lock mode, limits, and namespace version.',
  'Command is signed, audited, queued, and dispatched over agent-scoped subjects.',
  'Agent executes the approved operation and reports per-agent outcome.',
]

export const resilienceDetails = [
  'Offline agents continue collecting metrics, writing logs, auditing actions, and queueing outbound data.',
  'Reconnects replay missed data in order; duplicates are handled by message identity.',
  'Collectors fail independently, report health, and degrade rather than taking down the agent.',
  'Executions are pinned to immutable namespace versions, so updates never alter a running operation.',
]

export const securityLayers = [
  'RBAC at REST, WebSocket, TUI, CLI, scheduler, database writes, and command dispatch.',
  'Agent identities use per-agent ACLs; agents publish and subscribe only to their allowed subjects.',
  'TLS 1.3, AES-256-GCM, Argon2id, JWT sessions, certificate pinning, and optional Vault PKI/Transit signing.',
  'Audit records are append-only: export, archive, compress, and verify are allowed; delete and rewrite are not.',
]

export const platformCapabilities = [
  'Namespace versioning',
  'Namespace groups',
  'Cron scheduling',
  'Maintenance windows',
  'Execution locks',
  'Dead-letter queues',
  'Prometheus/Grafana export path',
  'Signed plugins',
]

export type ExplorerPanelId = 'topology' | 'operations' | 'deployment' | 'roadmap'

export const proposalExplorerPanels: Record<ExplorerPanelId, {
  label: string
  eyebrow: string
  title: string
  body: string
}> = {
  topology: {
    label: 'Topology',
    eyebrow: 'Architecture summary',
    title: 'Agents, stream, control plane.',
    body: 'Operators enter through CLI, TUI, REST, or WebSocket. ATLAS handles auth, RBAC, namespaces, execution, scheduling, metrics, logs, audit, encryption, and queueing before state lands in PostgreSQL or agent SQLite.',
  },
  operations: {
    label: 'Operations',
    eyebrow: 'Fleet automation',
    title: 'Versioned workflows with guardrails.',
    body: 'Namespaces define approved operation chains. Groups compose them, tags target fleets, lock modes control concurrency, and maintenance windows hold risky work until the fleet is ready.',
  },
  deployment: {
    label: 'Deployment',
    eyebrow: 'Resource budget',
    title: 'Lean enough for one serious host.',
    body: 'The proposal budgets roughly 8.2 CPU cores and 5.7 GB memory for a 100-agent control plane, making a single 16 GB host a realistic starting point.',
  },
  roadmap: {
    label: 'Roadmap',
    eyebrow: 'Build path',
    title: 'Capability layers, not rewrites.',
    body: 'The roadmap grows from agent core to server transport, audit, scheduling, WebSocket/TUI, plugins, federation, and hardening at 1000+ agents without changing the main architecture.',
  },
}

export const topologyNodes = ['CLI', 'TUI', 'REST', 'WebSocket', 'ATLAS Server', 'NATS JetStream', 'Beacon Agents', 'PostgreSQL', 'SQLite']

export const operationBadges = [
  'Package operations',
  'Service operations',
  'File operations',
  'User/group operations',
  'Container operations',
  'Network operations',
  'Backup operations',
  'Custom plugin operations',
]

export const deploymentBudget = [
  { component: 'ATLAS Server', cpu: '2.0 cores', memory: '1 GB' },
  { component: 'PostgreSQL 16', cpu: '2.0 cores', memory: '2 GB' },
  { component: 'NATS JetStream', cpu: '1.0 core', memory: '512 MB' },
  { component: 'Prometheus', cpu: '1.0 core', memory: '1 GB' },
  { component: 'Vault + Redis + Nginx', cpu: '1.5 cores', memory: '640 MB' },
  { component: 'PgBouncer + Grafana', cpu: '0.7 cores', memory: '576 MB' },
]

export const roadmapPhases = [
  'Agent core',
  'Metrics & logging',
  'Server + NATS + REST',
  'Audit + encryption',
  'Scheduler + groups',
  'WebSocket + TUI',
  'Plugin system',
  'Federation + hardening',
]

export const comparisonSystems = [
  { name: 'Salt / Ansible', overlap: 'agent model and workflow execution' },
  { name: 'Rundeck', overlap: 'RBAC, scheduling, audit trails' },
  { name: 'Zabbix', overlap: 'agents, telemetry, alerting' },
  { name: 'Prometheus', overlap: 'time-series collection and retention' },
  { name: 'osquery', overlap: 'fleet visibility and host identity' },
]
