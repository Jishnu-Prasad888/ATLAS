import { http, HttpResponse } from 'msw'
import type { Agent, User, FleetHealth, Metric, LogEntry, AuditLog } from '@/types'

const BASE = '/api/v1'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

export const mockUser: User = {
  id: 1,
  username: 'admin',
  email: 'admin@example.com',
  role: 'administrator',
  is_active: true,
  created_at: '2024-01-15T10:00:00Z',
  last_login: '2024-01-15T14:23:01Z',
}

export const mockViewerUser: User = {
  id: 2,
  username: 'viewer',
  email: 'viewer@example.com',
  role: 'viewer',
  is_active: true,
  created_at: '2024-01-15T10:00:00Z',
  last_login: null,
}

export const mockTestUser: User = {
  id: 3,
  username: 'test',
  email: 'test@example.com',
  role: 'administrator',
  is_active: true,
  created_at: '2024-06-01T10:00:00Z',
  last_login: null,
}

// A valid (but fake) JWT that decodes to admin user
// Payload: { user_id: 1, username: "admin", role: "administrator", exp: 9999999999 }
export const MOCK_ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  btoa(JSON.stringify({ user_id: 1, username: 'admin', role: 'administrator', exp: 9999999999, iat: 1705327981, jti: 'test', token_type: 'access' })).replace(/=/g, '') +
  '.fake-sig'

// Payload: { user_id: 3, username: "test", role: "administrator", exp: 9999999999 }
export const MOCK_TEST_ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  btoa(JSON.stringify({ user_id: 3, username: 'test', role: 'administrator', exp: 9999999999, iat: 1705327981, jti: 'test', token_type: 'access' })).replace(/=/g, '') +
  '.fake-sig'

export const MOCK_REFRESH_TOKEN = 'fake-refresh-token'

export const mockAgent: Agent = {
  id: 1,
  agent_id: 'sha256:a3f1b2e4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2',
  hostname: 'prod-server-01',
  os: 'linux',
  architecture: 'x86_64',
  version: '1.0.0',
  tags: ['production', 'web'],
  status: 'ONLINE',
  is_active: true,
  registered_at: '2024-01-15T10:00:00Z',
  last_seen: new Date().toISOString(),
  is_stale: false,
  metadata: { datacenter: 'us-east-1' },
  collector_health: [
    {
      collector: 'cpu',
      status: 'Healthy',
      last_run: new Date().toISOString(),
      last_success: new Date().toISOString(),
      last_failure: null,
      failure_count: 0,
      updated_at: new Date().toISOString(),
    },
  ],
}

export const mockFleetHealth: FleetHealth = {
  server_status: 'ONLINE',
  timestamp: new Date().toISOString(),
  agents: { total: 2, online: 1, degraded: 0, offline: 1 },
  latest_snapshot: {
    metrics_rate: 12.5,
    logs_rate: 2.1,
    db_size_bytes: 52428800,
    timestamp: new Date().toISOString(),
  },
}

export const mockCpuMetric: Metric = {
  id: 1,
  agent_id: mockAgent.agent_id,
  metric_type: 'cpu',
  resolution: 'raw',
  timestamp: new Date().toISOString(),
  schema_version: '1.0',
  data: {
    usage_pct: 34.2,
    core_count: 8,
    load_avg_1m: 0.72,
    load_avg_5m: 0.65,
    load_avg_15m: 0.58,
    interrupts: 1234567,
    context_switches: 9876543,
    per_core: [{ core: 0, usage_pct: 42.1, frequency: 3600, name: 'cpu0' }],
    temperatures_c: [{ zone: 0, type: 'x86_pkg_temp', temp_c: 52.0 }],
  },
}

export const mockLogEntry: LogEntry = {
  id: 1,
  agent_id: mockAgent.agent_id,
  source: 'systemd-journald',
  severity: 'Info',
  message: 'Started NGINX HTTP Server.',
  timestamp: new Date().toISOString(),
  schema_version: '1.0',
  sequence_number: 1,
  extra: { unit: 'nginx.service' },
}

export const mockAuditLog: AuditLog = {
  id: 1,
  sha256: '2c5b3d4e5f60718293a4b1c2d3e4f5a60718293a4b1c2d3e4f5a60718293a4b',
  timestamp: new Date().toISOString(),
  user: 'admin',
  ip_address: '192.168.1.1',
  action: 'LOGIN',
  resource: 'auth',
  resource_id: 'user-admin',
  request_id: 'req-12345',
  details: {
    status: 'completed',
    user_agent: 'Atlas Test Suite',
    session_id: 'session-xyz',
    pid: 4242,
  },
  success: true,
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

export const handlers = [
  // Auth
  http.post(`${BASE}/auth/login/`, async ({ request }) => {
    const body = await request.json() as Record<string, string>
    if (body.username === 'admin' && body.password === 'correctpassword') {
      return HttpResponse.json({ access: MOCK_ACCESS_TOKEN, refresh: MOCK_REFRESH_TOKEN })
    }
    if (body.username === 'test' && body.password === 'test') {
      return HttpResponse.json({ access: MOCK_TEST_ACCESS_TOKEN, refresh: MOCK_REFRESH_TOKEN })
    }
    return HttpResponse.json({ detail: 'No active account found with the given credentials.' }, { status: 400 })
  }),

  http.post(`${BASE}/auth/logout/`, () =>
    HttpResponse.json({ detail: 'Logged out successfully.' })
  ),

  http.post(`${BASE}/auth/refresh/`, () =>
    HttpResponse.json({ access: MOCK_ACCESS_TOKEN, refresh: MOCK_REFRESH_TOKEN })
  ),

  http.get(`${BASE}/auth/whoami/`, ({ request }) => {
    const auth = request.headers.get('Authorization') || ''
    const token = auth.replace('Bearer ', '')
    try {
      const payload = JSON.parse(atob(token.split('.')[1]))
      if (payload.username === 'test') return HttpResponse.json(mockTestUser)
    } catch {}
    return HttpResponse.json(mockUser)
  }),

  http.post(`${BASE}/auth/password/change/`, () =>
    HttpResponse.json({ detail: 'Password changed successfully.' })
  ),

  http.post(`${BASE}/auth/recovery-key/generate/`, () =>
    HttpResponse.json({ recovery_key: 'A3F1-B2E4-C5D6-E7F8', warning: 'Save this key.' })
  ),

  // Users
  http.get(`${BASE}/users/`, () =>
    HttpResponse.json([mockUser, mockTestUser, mockViewerUser])
  ),

  http.post(`${BASE}/users/`, async ({ request }) => {
    const body = await request.json() as Record<string, string>
    const newUser: User = { ...mockViewerUser, id: 99, username: body.username, email: body.email ?? '', role: body.role as User['role'] }
    return HttpResponse.json(newUser, { status: 201 })
  }),

  http.delete(`${BASE}/users/:id`, () =>
    new HttpResponse(null, { status: 204 })
  ),

  http.post(`${BASE}/users/:id/enable/`, ({ params }) =>
    HttpResponse.json({ ...mockViewerUser, id: Number(params.id), is_active: true })
  ),

  http.post(`${BASE}/users/:id/disable/`, ({ params }) =>
    HttpResponse.json({ ...mockViewerUser, id: Number(params.id), is_active: false })
  ),

  http.post(`${BASE}/users/:id/role/`, async ({ request, params }) => {
    const body = await request.json() as { role: string }
    return HttpResponse.json({ ...mockViewerUser, id: Number(params.id), role: body.role })
  }),

  // Agents
  http.get(`${BASE}/agents/`, () =>
    HttpResponse.json([mockAgent])
  ),

  http.get(`${BASE}/agents/:agentId/`, ({ params }) => {
    if (params.agentId === mockAgent.agent_id) {
      return HttpResponse.json(mockAgent)
    }
    return HttpResponse.json({ detail: 'Agent not found.' }, { status: 404 })
  }),

  http.delete(`${BASE}/agents/:agentId/`, () =>
    new HttpResponse(null, { status: 204 })
  ),

  http.post(`${BASE}/agents/:agentId/enable/`, () =>
    HttpResponse.json({ ...mockAgent, is_active: true })
  ),

  http.post(`${BASE}/agents/:agentId/disable/`, () =>
    HttpResponse.json({ ...mockAgent, is_active: false })
  ),

  http.post(`${BASE}/agents/:agentId/rename/`, async ({ request }) => {
    const body = await request.json() as { hostname: string }
    return HttpResponse.json({ ...mockAgent, hostname: body.hostname })
  }),

  http.post(`${BASE}/agents/:agentId/regenerate-id/`, () =>
    HttpResponse.json({ agent_id: 'regen-abc123', warning: 'Update agent config.' })
  ),

  // Telemetry
  http.get(`${BASE}/telemetry/`, () =>
    HttpResponse.json([mockCpuMetric])
  ),

  http.get(`${BASE}/telemetry/latest/:agentId/`, () =>
    HttpResponse.json({ cpu: mockCpuMetric })
  ),

  http.post(`${BASE}/telemetry/prune/`, () =>
    HttpResponse.json({ pruned: { raw_1s_24h: 1000, rollup_1m_30d: 500 } })
  ),

  http.get(`${BASE}/metrics/config/:agentId/`, ({ params }) =>
    HttpResponse.json({
      agent_id: params.agentId,
      cpu_enabled: true,
      ram_enabled: true,
      storage_enabled: true,
      network_enabled: true,
      process_enabled: true,
      systemd_enabled: true,
      docker_enabled: false,
      kubernetes_enabled: false,
      temperature_enabled: true,
      power_enabled: false,
      interval_seconds: 5,
      retention_days: 30,
      updated_at: '2024-01-15T10:00:00Z',
    })
  ),

  http.patch(`${BASE}/metrics/config/:agentId/`, async ({ request, params }) => {
    const body = await request.json() as Record<string, unknown>
    return HttpResponse.json({ agent_id: params.agentId, ...body })
  }),

  // Logs
  http.get(`${BASE}/logs/`, () =>
    HttpResponse.json([mockLogEntry])
  ),

  http.post(`${BASE}/logs/clear/`, () =>
    HttpResponse.json({ deleted: 42 })
  ),

  http.get(`${BASE}/logs/export/`, () =>
    HttpResponse.json({ logs: [mockLogEntry], count: 1 })
  ),

  // Audit
  http.get(`${BASE}/audit/`, () =>
    HttpResponse.json([mockAuditLog])
  ),

  http.get(`${BASE}/audit/export/`, () =>
    HttpResponse.json({ audit_logs: [mockAuditLog], count: 1 })
  ),

  // Health
  http.get(`${BASE}/health/`, () =>
    HttpResponse.json(mockFleetHealth)
  ),

  http.get(`${BASE}/health/agents/:agentId/`, ({ params }) =>
    HttpResponse.json({
      agent_id: params.agentId,
      hostname: mockAgent.hostname,
      status: 'ONLINE',
      last_seen: new Date().toISOString(),
      is_stale: false,
      collectors: {
        cpu: { status: 'Healthy', last_run: new Date().toISOString(), last_success: new Date().toISOString(), failure_count: 0 },
      },
    })
  ),

  // Config
  http.get(`${BASE}/config/`, () =>
    HttpResponse.json([
      { key: 'retention_policy', value: { raw_hours: 24, rollup_1m_days: 30, rollup_1h_days: 365 }, encrypted: false, updated_by: 'admin', updated_at: '2024-01-15T10:00:00Z', description: '' },
    ])
  ),

  http.get(`${BASE}/config/retention/`, () =>
    HttpResponse.json({ raw_hours: 24, rollup_1m_days: 30, rollup_1h_days: 365 })
  ),

  http.put(`${BASE}/config/retention/`, async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json(body)
  }),

  http.put(`${BASE}/config/:key/`, async ({ request, params }) => {
    const body = await request.json() as Record<string, unknown>
    return HttpResponse.json({ key: params.key, ...body, updated_by: 'admin', updated_at: new Date().toISOString(), encrypted: false, description: '' })
  }),

  http.delete(`${BASE}/config/:key/`, () =>
    new HttpResponse(null, { status: 204 })
  ),

  // Server liveness
  http.get('/health/', () =>
    HttpResponse.json({ status: 'ok', service: 'beacon-server' })
  ),
]
