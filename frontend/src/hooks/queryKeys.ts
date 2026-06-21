import type { AgentListParams, LogQueryParams, TelemetryQueryParams, AuditQueryParams } from '@/types'

export const queryKeys = {
  // Auth
  whoami: () => ['auth', 'whoami'] as const,

  // Fleet health
  fleetHealth: () => ['health', 'fleet'] as const,
  agentHealth: (agentId: string) => ['health', 'agent', agentId] as const,

  // Agents
  agents: (params?: AgentListParams) => ['agents', params] as const,
  agent: (agentId: string) => ['agents', agentId] as const,

  // Telemetry
  telemetry: (params: TelemetryQueryParams) => ['telemetry', params] as const,
  telemetryLatest: (agentId: string) => ['telemetry', 'latest', agentId] as const,
  metricConfig: (agentId: string) => ['metrics', 'config', agentId] as const,

  // Logs
  logs: (params: LogQueryParams) => ['logs', params] as const,

  // Audit
  audit: (params?: AuditQueryParams) => ['audit', params] as const,

  // Users
  users: () => ['users'] as const,
  user: (id: number) => ['users', id] as const,
  registrations: () => ['users', 'registrations'] as const,
  organizations: () => ['organizations'] as const,

  // Config
  config: () => ['config'] as const,
  configKey: (key: string) => ['config', key] as const,
  retention: () => ['config', 'retention'] as const,
} as const
