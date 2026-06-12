import { request } from './client'
import type {
  LogEntry,
  LogQueryParams,
  LogSeverity,
  AuditLog,
  AuditQueryParams,
  FleetHealth,
  AgentHealth,
  ServerConfig,
  RetentionPolicy,
} from '@/types'

// ─── Logs ─────────────────────────────────────────────────────────────────────

export const logsApi = {
  query: (params: LogQueryParams) =>
    request<LogEntry[]>({ method: 'GET', url: '/logs/', params }),

  clear: (params?: { agent_id?: string; severity?: LogSeverity }) =>
    request<{ deleted: number }>({
      method: 'POST',
      url: '/logs/clear/',
      data: params ?? {},
    }),
}

// ─── Audit ────────────────────────────────────────────────────────────────────

export const auditApi = {
  query: (params?: AuditQueryParams) =>
    request<AuditLog[]>({ method: 'GET', url: '/audit/', params }),
}

// ─── Health ───────────────────────────────────────────────────────────────────

export const healthApi = {
  fleet: () =>
    request<FleetHealth>({ method: 'GET', url: '/health/' }),

  agent: (agentId: string) =>
    request<AgentHealth>({
      method: 'GET',
      url: `/health/agents/${encodeURIComponent(agentId)}/`,
    }),
}

// ─── Config ───────────────────────────────────────────────────────────────────

export const configApi = {
  list: () =>
    request<ServerConfig[]>({ method: 'GET', url: '/config/' }),

  get: (key: string) =>
    request<ServerConfig>({ method: 'GET', url: `/config/${key}/` }),

  set: (key: string, value: unknown, description?: string) =>
    request<ServerConfig>({
      method: 'PUT',
      url: `/config/${key}/`,
      data: { value, description },
    }),

  delete: (key: string) =>
    request<void>({ method: 'DELETE', url: `/config/${key}/` }),

  getRetention: () =>
    request<RetentionPolicy>({ method: 'GET', url: '/config/retention/' }),

  setRetention: (policy: RetentionPolicy) =>
    request<RetentionPolicy>({
      method: 'PUT',
      url: '/config/retention/',
      data: policy,
    }),
}

// ─── Server liveness ─────────────────────────────────────────────────────────

export const serverApi = {
  ping: () =>
    fetch('/health/')
      .then((r) => r.ok)
      .catch(() => false),
}
