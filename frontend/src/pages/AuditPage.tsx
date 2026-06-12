import { useState } from 'react'
import { useAudit } from '@/hooks'
import { buildAuditExportUrl } from '@/api/telemetry'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import { PageHeader } from '@/components/layout/AppLayout'
import {
  Card,
  Input,
  Button,
  Select,
  LoadingState,
  EmptyState,
  ErrorState,
} from '@/components/common'
import { downloadFile, formatTimestamp } from '@/utils'
import type { AuditLog } from '@/types'

const RESOURCES = ['agents', 'users', 'auth', 'logs', 'config', 'metrics']
const ACTIONS = [
  'LOGIN', 'LOGOUT', 'PASSWORD_CHANGE', 'PASSWORD_RECOVERY',
  'USER_CREATE', 'USER_UPDATE', 'USER_DELETE', 'USER_ROLE_ASSIGN',
  'AGENT_REGISTER', 'AGENT_REMOVE', 'AGENT_RENAME', 'AGENT_REGEN_ID',
  'AGENT_ENABLE', 'AGENT_DISABLE', 'LOG_CLEAR', 'CONFIG_SET',
  'CONFIG_UPDATE', 'CONFIG_DELETE', 'RETENTION_UPDATE',
]

export function AuditPage() {
  const { accessToken } = useAuthStore()
  const addNotification = useUiStore((s) => s.addNotification)

  const [userFilter, setUserFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [resourceFilter, setResourceFilter] = useState('')

  const { data: logs, isLoading, error, refetch } = useAudit({
    user: userFilter || undefined,
    action: actionFilter || undefined,
    resource: resourceFilter || undefined,
    limit: 500,
  })

  const handleExport = async () => {
    if (!accessToken) return
    try {
      await downloadFile(buildAuditExportUrl(), 'beacon_audit.json', accessToken)
    } catch (e: unknown) {
      addNotification({ type: 'error', title: 'Export failed', message: e instanceof Error ? e.message : undefined })
    }
  }

  return (
    <div>
      <PageHeader
        title="Audit Trail"
        subtitle="Immutable record of all system actions"
        actions={
          <Button size="sm" variant="secondary" onClick={handleExport}>
            Export
          </Button>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <Input
          placeholder="Filter by user..."
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          className="w-40"
        />
        <Select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="w-44"
        >
          <option value="">All actions</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </Select>
        <Select
          value={resourceFilter}
          onChange={(e) => setResourceFilter(e.target.value)}
          className="w-36"
        >
          <option value="">All resources</option>
          {RESOURCES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </Select>
        <Button size="sm" variant="ghost" onClick={() => refetch()}>
          Refresh
        </Button>
      </div>

      <Card padding={false}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-[--color-border]">
          <p className="text-xs font-mono text-[--color-text-muted] uppercase tracking-wide">Audit Log</p>
          <p className="text-xs font-mono text-[--color-text-dim]">{logs?.length ?? 0} entries</p>
        </div>

        {isLoading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState error="Failed to load audit log" onRetry={refetch} />
        ) : !logs?.length ? (
          <EmptyState message="No audit entries match filters" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-[--color-border]">
                  {['Time', 'User', 'Action', 'Resource', 'ID', 'IP', 'Result'].map((h) => (
                    <th key={h} className="text-left px-3 py-2 text-[--color-text-muted] font-normal uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[--color-border]">
                {logs.map((log) => (
                  <AuditRow key={log.id} log={log} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function AuditRow({ log }: { log: AuditLog }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      <tr
        className="hover:bg-[--color-surface-2] cursor-pointer transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="px-3 py-2 text-[--color-text-muted] whitespace-nowrap tabular-nums">
          {formatTimestamp(log.timestamp)}
        </td>
        <td className="px-3 py-2 text-[--color-text]">{log.user}</td>
        <td className="px-3 py-2 text-[--color-text] whitespace-nowrap">{log.action}</td>
        <td className="px-3 py-2 text-[--color-text-muted]">{log.resource}</td>
        <td className="px-3 py-2 text-[--color-text-muted] max-w-28 truncate" title={log.resource_id}>
          {log.resource_id || '--'}
        </td>
        <td className="px-3 py-2 text-[--color-text-muted] tabular-nums">{log.ip_address ?? '--'}</td>
        <td className="px-3 py-2">
          <span className={log.success ? 'text-green-400' : 'text-red-400'}>
            {log.success ? 'OK' : 'FAIL'}
          </span>
        </td>
      </tr>
      {expanded && Object.keys(log.details).length > 0 && (
        <tr className="bg-[--color-surface-2]">
          <td colSpan={7} className="px-3 py-2">
            <pre className="text-xs font-mono text-[--color-text-muted] whitespace-pre-wrap break-all">
              {JSON.stringify(log.details, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  )
}
