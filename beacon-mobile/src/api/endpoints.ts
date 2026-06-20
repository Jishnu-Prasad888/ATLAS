import { getApiClient } from './client'
import {
  User, Role, Agent, AgentListParams, AgentHealth,
  FleetHealth, Metric, MetricType, MetricConfig,
  TelemetryQueryParams, LogEntry, LogQueryParams,
  LogSource, LogSeverity,
  AuditLog, AuditQueryParams, ServerConfig, RetentionPolicy,
} from '@/types'

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const authApi = {
  login: (username: string, password: string) =>
    getApiClient().post<{ access: string; refresh: string }>('/auth/login/', { username, password }),

  logout: (refresh: string) =>
    getApiClient().post('/auth/logout/', { refresh }),

  refresh: (refresh: string) =>
    getApiClient().post<{ access: string; refresh?: string }>('/auth/refresh/', { refresh }),

  whoami: () => getApiClient().get<User>('/auth/whoami/'),

  changePassword: (old_password: string, new_password: string) =>
    getApiClient().post('/auth/password/change/', { old_password, new_password }),

  recover: (username: string, recovery_key: string, new_password: string) =>
    getApiClient().post<{ detail: string; new_recovery_key: string }>('/auth/password/recover/', { username, recovery_key, new_password }),

  generateRecoveryKey: () =>
    getApiClient().post<{ recovery_key: string; warning: string }>('/auth/recovery-key/generate/'),
}

// ─── Agents ───────────────────────────────────────────────────────────────────

export const agentsApi = {
  list: (params?: AgentListParams) =>
    getApiClient().get<Agent[]>('/agents/', { params }),

  register: (data: { agent_id: string; hostname: string; os?: string; arch?: string; version?: string; tags?: string[]; metadata?: Record<string, unknown>; secret?: string }) =>
    getApiClient().post<Agent>('/agents/register/', data),

  get: (agentId: string) =>
    getApiClient().get<Agent>(`/agents/${agentId}/`),

  delete: (agentId: string) =>
    getApiClient().delete(`/agents/${agentId}/`),

  heartbeat: (agentId: string, status?: string) =>
    getApiClient().post(`/agents/${agentId}/heartbeat/`, { status }),

  rename: (agentId: string, hostname: string) =>
    getApiClient().post<Agent>(`/agents/${agentId}/rename/`, { hostname }),

  regenerateId: (agentId: string) =>
    getApiClient().post<{ agent_id: string }>(`/agents/${agentId}/regenerate-id/`),

  enable: (agentId: string) =>
    getApiClient().post<Agent>(`/agents/${agentId}/enable/`),

  disable: (agentId: string) =>
    getApiClient().post<Agent>(`/agents/${agentId}/disable/`),

  collectorsHealth: (agentId: string, data: { collector: string; status: string; last_run?: string; last_success?: string; last_failure?: string; failure_count?: number }) =>
    getApiClient().post(`/agents/${agentId}/collectors/health/`, data),
}

// ─── Health ───────────────────────────────────────────────────────────────────

export const healthApi = {
  overview: () =>
    getApiClient().get<FleetHealth>('/health/'),

  agent: (agentId: string) =>
    getApiClient().get<AgentHealth>(`/health/agents/${agentId}/`),
}

// ─── Telemetry ────────────────────────────────────────────────────────────────

export const telemetryApi = {
  list: (params?: TelemetryQueryParams) =>
    getApiClient().get<Metric[]>('/telemetry/', { params }),

  ingest: (data: { agent_id: string; metrics: { metric_type: MetricType; timestamp: string; data: unknown; schema_version?: string; sequence_number?: number }[] }) =>
    getApiClient().post<{ ingested: number }>('/telemetry/ingest/', data),

  latest: (agentId: string) =>
    getApiClient().get<Record<string, Metric>>(`/telemetry/latest/${agentId}/`),

  prune: () =>
    getApiClient().post<{ pruned: { raw_1s_24h: number; rollup_1m_30d: number; rollup_1h_365d: number } }>('/telemetry/prune/'),
}

// ─── Metrics Config ───────────────────────────────────────────────────────────

export const metricsConfigApi = {
  get: (agentId: string) =>
    getApiClient().get<MetricConfig>(`/metrics/config/${agentId}/`),

  update: (agentId: string, data: Partial<MetricConfig>) =>
    getApiClient().patch<MetricConfig>(`/metrics/config/${agentId}/`, data),
}

// ─── Logs ─────────────────────────────────────────────────────────────────────

export const logsApi = {
  list: (params?: LogQueryParams) =>
    getApiClient().get<LogEntry[]>('/logs/', { params }),

  ingest: (data: { agent_id: string; logs: { source: LogSource; severity: LogSeverity; message: string; timestamp: string; schema_version?: string; extra?: Record<string, unknown>; sequence_number?: number }[] }) =>
    getApiClient().post<{ ingested: number }>('/logs/ingest/', data),

  export: (params?: { agent_id?: string; severity?: LogSeverity }) =>
    getApiClient().get('/logs/export/', { params, responseType: 'blob' }),

  clear: (data?: { agent_id?: string; severity?: LogSeverity }) =>
    getApiClient().post<{ deleted: number }>('/logs/clear/', data ?? {}),
}

// ─── Audit ────────────────────────────────────────────────────────────────────

export const auditApi = {
  list: (params?: AuditQueryParams) =>
    getApiClient().get<AuditLog[]>('/audit/', { params }),

  export: (params?: { user?: string; action?: string; resource?: string; start?: string; end?: string; limit?: number }) =>
    getApiClient().get('/audit/export/', { params, responseType: 'blob' }),
}

// ─── Users ────────────────────────────────────────────────────────────────────

export const usersApi = {
  list: () =>
    getApiClient().get<User[]>('/users/'),

  get: (id: number) =>
    getApiClient().get<User>(`/users/${id}/`),

  create: (data: { username: string; email?: string; password: string; role?: Role }) =>
    getApiClient().post<User>('/users/', data),

  update: (id: number, data: Partial<User>) =>
    getApiClient().patch<User>(`/users/${id}/`, data),

  delete: (id: number) =>
    getApiClient().delete(`/users/${id}/`),

  setRole: (id: number, role: Role) =>
    getApiClient().post<User>(`/users/${id}/role/`, { role }),

  enable: (id: number) =>
    getApiClient().post<User>(`/users/${id}/enable/`),

  disable: (id: number) =>
    getApiClient().post<User>(`/users/${id}/disable/`),
}

// ─── Config ───────────────────────────────────────────────────────────────────

export const configApi = {
  list: () =>
    getApiClient().get<ServerConfig[]>('/config/'),

  get: (key: string) =>
    getApiClient().get<ServerConfig>(`/config/${key}/`),

  create: (data: { key: string; value: unknown; encrypted?: boolean; description?: string }) =>
    getApiClient().post<ServerConfig>('/config/', data),

  update: (key: string, data: { value?: unknown; encrypted?: boolean; description?: string }) =>
    getApiClient().put<ServerConfig>(`/config/${key}/`, data),

  delete: (key: string) =>
    getApiClient().delete(`/config/${key}/`),

  retention: () =>
    getApiClient().get<RetentionPolicy>('/config/retention/'),

  updateRetention: (data: RetentionPolicy) =>
    getApiClient().put<RetentionPolicy>('/config/retention/', data),
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export interface DashboardSummary {
  agents: { total: number; online: number; offline: number; degraded: number; stale: number }
  metrics_last_hour: number
  logs_last_hour: number
}

export const dashboardApi = {
  summary: async (): Promise<DashboardSummary> => {
    const now = new Date()
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
    const nowIso = now.toISOString()

    const [healthRes, agentsRes, telemetryRes, logsRes] = await Promise.all([
      healthApi.overview(),
      agentsApi.list(),
      telemetryApi.list({ start: hourAgo, end: nowIso, limit: 1000 }),
      logsApi.list({ start: hourAgo, end: nowIso, limit: 1000 }),
    ])

    const health = healthRes.data
    const agents = agentsRes.data ?? []
    const telemetryCount = telemetryRes.data?.length ?? 0
    const logsCount = logsRes.data?.length ?? 0

    const stale = agents.filter(a => a.is_stale).length
    const offline = health.agents.offline ?? Math.max(health.agents.total - health.agents.online - (health.agents.degraded ?? 0), 0)

    return {
      agents: {
        total: health.agents.total,
        online: health.agents.online,
        offline,
        degraded: health.agents.degraded ?? 0,
        stale,
      },
      metrics_last_hour: telemetryCount,
      logs_last_hour: logsCount,
    }
  },
}
