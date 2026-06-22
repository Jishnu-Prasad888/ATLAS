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
  apiClient.post('/audit/ingest/', {
    action: entry.action,
    resource: 'atlas_ai',
    resource_id: (entry.details as any)?.resource_id ?? '',
    details: entry.details,
    status: entry.status,
    error: entry.error,
    timestamp: entry.timestamp,
    user_id: entry.user_id,
    username: entry.username,
    role: entry.role,
  }).catch(() => {})
}
