import { getAccessToken } from '@/api/client'

export type Role = 'administrator' | 'moderator' | 'viewer' | 'guest'

export interface WhoAmI {
  id: number
  username: string
  email: string
  role: Role
  is_active: boolean
  approval_status?: string
  access_all_agents?: boolean
  agent_ids?: string[]
  organization_ids?: number[]
}

export interface AccessScope {
  access_all_agents: boolean
  agent_ids: string[]
  organization_ids: number[]
}

export interface BeaconContext {
  user: WhoAmI
  scope: AccessScope
}

export class BeaconError extends Error {
  constructor(public status: number, message: string, public body: unknown) {
    super(message)
  }
}

async function callBeacon<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAccessToken()
  const apiBase = (import.meta.env as Record<string, string>)['VITE_API_BASE_URL'] || ''
  const prefix = (import.meta.env as Record<string, string>)['VITE_API_PREFIX'] || '/api/v1'
  const url = `${apiBase}${prefix}${path}`

  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers as Record<string, string>),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })

  if (!res.ok) {
    let body: unknown = null
    try { body = await res.json() } catch { /* ignore */ }
    throw new BeaconError(res.status, `Beacon ${res.status}`, body)
  }

  if (res.status === 204) return null as T
  return (await res.json()) as T
}

export async function whoAmI(): Promise<BeaconContext> {
  const raw = await callBeacon<WhoAmI>('/auth/whoami/')
  const role = normalizeRole(raw.role)
  const user: WhoAmI = { ...raw, role }
  const scope: AccessScope = {
    access_all_agents: user.role === 'administrator' || user.access_all_agents === true,
    agent_ids: user.agent_ids ?? [],
    organization_ids: user.organization_ids ?? [],
  }
  return { user, scope }
}

function normalizeRole(role: string): Role {
  const r = role?.toLowerCase?.() ?? ''
  if (r === 'admin' || r === 'administrator') return 'administrator'
  if (r === 'moderator') return 'moderator'
  if (r === 'viewer') return 'viewer'
  return 'guest'
}

export const tools = {
  list_agents: async () => {
    const data = await callBeacon<any[]>('/agents/')
    const { scope } = await whoAmI()
    if (scope.access_all_agents) return data
    return data.filter((a) => scope.agent_ids.includes(a.agent_id))
  },
  get_agent: async (_scope: AccessScope, args: { agent_id: string }) => {
    if (!_scope.access_all_agents && !_scope.agent_ids.includes(args.agent_id)) {
      throw new BeaconError(403, 'Agent not in scope', null)
    }
    return callBeacon(`/agents/${encodeURIComponent(args.agent_id)}/`)
  },
  enable_agent: async (_scope: AccessScope, args: { agent_id: string }) => {
    if (!_scope.access_all_agents && !_scope.agent_ids.includes(args.agent_id)) {
      throw new BeaconError(403, 'Agent not in scope', null)
    }
    return callBeacon(`/agents/${encodeURIComponent(args.agent_id)}/enable/`, { method: 'POST' })
  },
  disable_agent: async (_scope: AccessScope, args: { agent_id: string }) => {
    if (!_scope.access_all_agents && !_scope.agent_ids.includes(args.agent_id)) {
      throw new BeaconError(403, 'Agent not in scope', null)
    }
    return callBeacon(`/agents/${encodeURIComponent(args.agent_id)}/disable/`, { method: 'POST' })
  },
  delete_agent: async (_scope: AccessScope, args: { agent_id: string }) => {
    if (!_scope.access_all_agents && !_scope.agent_ids.includes(args.agent_id)) {
      throw new BeaconError(403, 'Agent not in scope', null)
    }
    return callBeacon(`/agents/${encodeURIComponent(args.agent_id)}/`, { method: 'DELETE' })
  },
  list_logs: async (_scope: AccessScope, args: { agent_id?: string; limit?: number }) => {
    const qs = new URLSearchParams()
    if (args.agent_id) {
      if (!_scope.access_all_agents && !_scope.agent_ids.includes(args.agent_id)) {
        throw new BeaconError(403, 'Agent not in scope', null)
      }
      qs.set('agent_id', args.agent_id)
    }
    if (args.limit) qs.set('limit', String(args.limit))
    return callBeacon(`/logs/?${qs.toString()}`)
  },
  list_metrics: async (_scope: AccessScope, args: { agent_id: string; metric_type?: string; limit?: number }) => {
    if (!_scope.access_all_agents && !_scope.agent_ids.includes(args.agent_id)) {
      throw new BeaconError(403, 'Agent not in scope', null)
    }
    const qs = new URLSearchParams({ agent_id: args.agent_id })
    if (args.metric_type) qs.set('metric_type', args.metric_type)
    if (args.limit) qs.set('limit', String(args.limit))
    return callBeacon(`/telemetry/?${qs.toString()}`)
  },
  list_users: async () => callBeacon('/users/'),
  update_user_role: async (_scope: AccessScope, args: { user_id: number; role: Role }) => {
    return callBeacon(`/users/${args.user_id}/role/`, { method: 'POST', body: JSON.stringify({ role: args.role }) })
  },
  list_config: async () => callBeacon('/config/'),
  update_config: async (_scope: AccessScope, args: { key: string; value: unknown }) => {
    return callBeacon(`/config/${encodeURIComponent(args.key)}/`, {
      method: 'PUT',
      body: JSON.stringify({ value: args.value }),
    })
  },
  agent_command_run: async () => {
    throw new BeaconError(501, 'Agent-side command execution not enabled yet', null)
  },
}

export function allowedToolsForRole(role: Role): Array<keyof typeof tools> {
  if (role === 'administrator') return Object.keys(tools) as Array<keyof typeof tools>
  if (role === 'moderator') return ['list_agents', 'get_agent', 'enable_agent', 'disable_agent', 'list_logs', 'list_metrics', 'list_config', 'agent_command_run']
  return ['list_agents', 'get_agent', 'list_logs', 'list_metrics', 'list_config', 'agent_command_run']
}

export const mutatingTools = new Set<keyof typeof tools>([
  'enable_agent',
  'disable_agent',
  'delete_agent',
  'update_user_role',
  'update_config',
  'agent_command_run',
])

export type ToolName = keyof typeof tools
