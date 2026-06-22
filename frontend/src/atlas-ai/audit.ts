import { apiClient } from '@/api/client'

export interface AuditEntry {
  timestamp: string
  user_id: number
  username: string
  role: string
  action: string
  details: Record<string, unknown>
  status: 'ok' | 'error'
  error?: string
}

export function writeAudit(entry: AuditEntry) {
  apiClient.post('/telemetry/audit/', entry).catch(() => {})
}
