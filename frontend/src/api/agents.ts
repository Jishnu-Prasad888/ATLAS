import { request } from './client'
import type { Agent, AgentListParams, AgentStatus } from '@/types'

export const agentsApi = {
  list: (params?: AgentListParams) =>
    request<Agent[]>({ method: 'GET', url: '/agents/', params }),

  get: (agentId: string) =>
    request<Agent>({ method: 'GET', url: `/agents/${encodeURIComponent(agentId)}/` }),

  delete: (agentId: string) =>
    request<void>({ method: 'DELETE', url: `/agents/${encodeURIComponent(agentId)}/` }),

  enable: (agentId: string) =>
    request<Agent>({
      method: 'POST',
      url: `/agents/${encodeURIComponent(agentId)}/enable/`,
      data: {},
    }),

  disable: (agentId: string) =>
    request<Agent>({
      method: 'POST',
      url: `/agents/${encodeURIComponent(agentId)}/disable/`,
      data: {},
    }),

  rename: (agentId: string, hostname: string) =>
    request<Agent>({
      method: 'POST',
      url: `/agents/${encodeURIComponent(agentId)}/rename/`,
      data: { hostname },
    }),

  regenerateId: (agentId: string) =>
    request<{ agent_id: string; warning: string }>({
      method: 'POST',
      url: `/agents/${encodeURIComponent(agentId)}/regenerate-id/`,
      data: {},
    }),

  listByStatus: (status: AgentStatus) =>
    request<Agent[]>({ method: 'GET', url: '/agents/', params: { status } }),
}
