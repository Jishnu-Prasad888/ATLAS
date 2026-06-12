import { useState, useCallback } from 'react'
import { useAgents, useLogs, useLiveLogs, useDebounce } from '@/hooks'
import { logsApi } from '@/api'
import { buildLogsExportUrl } from '@/api/telemetry'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import { PageHeader } from '@/components/layout/AppLayout'
import {
  Card,
  Select,
  Input,
  Button,
  SeverityBadge,
  LoadingState,
  EmptyState,
  ErrorState,
  ConfirmDialog,
} from '@/components/common'
import { LOG_SOURCE_LABEL, downloadFile, formatTimestamp } from '@/utils'
import type { LogSeverity, LogSource, LogEntry } from '@/types'

const SEVERITY_OPTIONS: LogSeverity[] = ['Trace', 'Debug', 'Info', 'Warning', 'Error', 'Critical']
const SOURCE_OPTIONS: Array<{ value: LogSource; label: string }> = [
  { value: 'systemd-journald', label: 'Systemd' },
  { value: 'syslog', label: 'Syslog' },
  { value: 'kernel', label: 'Kernel' },
  { value: 'docker', label: 'Docker' },
  { value: 'kubernetes', label: 'Kubernetes' },
  { value: 'internal', label: 'Beacon Internal' },
]

export function LogsPage() {
  const { isAdmin, accessToken } = useAuthStore()
  const addNotification = useUiStore((s) => s.addNotification)
  const { data: agents } = useAgents()

  const [agentId, setAgentId] = useState<string>('')
  const [severity, setSeverity] = useState<string>('')
  const [source, setSource] = useState<string>('')
  const [searchInput, setSearchInput] = useState('')
  const [liveMode, setLiveMode] = useState(false)
  const [showClear, setShowClear] = useState(false)
  const [clearing, setClearing] = useState(false)

  const search = useDebounce(searchInput, 500)

  const selectedAgentId = agentId || agents?.[0]?.agent_id || undefined

  const { data: historicLogs, isLoading, error, refetch } = useLogs(
    {
      agent_id: selectedAgentId,
      severity: severity as LogSeverity | undefined || undefined,
      source: source as LogSource | undefined || undefined,
      search: search || undefined,
      limit: 500,
    },
    !liveMode,
  )

  const { logs: liveLogs, connected, clear: clearLive } = useLiveLogs(
    liveMode ? (selectedAgentId ?? null) : null,
  )

  const logs = liveMode ? liveLogs : (historicLogs ?? [])

  const handleExport = async () => {
    if (!accessToken) return
    try {
      const url = buildLogsExportUrl({
        agent_id: selectedAgentId,
        severity: severity || undefined,
      })
      await downloadFile(url, 'beacon_logs.json', accessToken)
    } catch (e: unknown) {
      addNotification({ type: 'error', title: 'Export failed', message: e instanceof Error ? e.message : undefined })
    }
  }

  const handleClear = async () => {
    setClearing(true)
    setShowClear(false)
    try {
      const res = await logsApi.clear({
        agent_id: selectedAgentId,
        severity: severity as LogSeverity | undefined || undefined,
      })
      addNotification({ type: 'success', title: `Cleared ${res.deleted} log entries` })
      clearLive()
      refetch()
    } catch (e: unknown) {
      addNotification({ type: 'error', title: 'Failed to clear logs', message: e instanceof Error ? e.message : undefined })
    } finally {
      setClearing(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Logs"
        actions={
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Button size="sm" variant="danger" onClick={() => setShowClear(true)} loading={clearing}>
                Clear
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={handleExport}>
              Export
            </Button>
            <Button
              size="sm"
              variant={liveMode ? 'primary' : 'secondary'}
              onClick={() => setLiveMode((v) => !v)}
            >
              {liveMode ? (
                <span className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
                  Live
                </span>
              ) : (
                'Live'
              )}
            </Button>
          </div>
        }
      />

      {showClear && (
        <ConfirmDialog
          title="Clear logs"
          message={`Clear ${severity ? severity : 'all'} logs${selectedAgentId ? ' for selected agent' : ' for all agents'}? This cannot be undone.`}
          confirmLabel="Clear"
          danger
          onConfirm={handleClear}
          onCancel={() => setShowClear(false)}
        />
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <Select
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          className="w-44"
        >
          <option value="">All agents</option>
          {agents?.map((a) => (
            <option key={a.agent_id} value={a.agent_id}>{a.hostname}</option>
          ))}
        </Select>

        <Select
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          className="w-32"
        >
          <option value="">All levels</option>
          {SEVERITY_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>

        <Select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="w-36"
        >
          <option value="">All sources</option>
          {SOURCE_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </Select>

        <div className="flex-1 min-w-40">
          <Input
            placeholder="Search messages..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            disabled={liveMode}
          />
        </div>
      </div>

      {/* Log table */}
      <Card padding={false}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-[--color-border]">
          <p className="text-xs font-mono text-[--color-text-muted] uppercase tracking-wide">
            {liveMode ? 'Live stream' : 'Log entries'}
          </p>
          <p className="text-xs font-mono text-[--color-text-dim]">{logs.length} entries</p>
        </div>

        <div className="overflow-x-auto">
          {!liveMode && isLoading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState error="Failed to load logs" onRetry={refetch} />
          ) : logs.length === 0 ? (
            <EmptyState
              message={liveMode ? 'Waiting for log entries...' : 'No log entries match filters'}
            />
          ) : (
            <div className="divide-y divide-[--color-border]">
              {logs.map((log) => (
                <LogRow key={log.id} log={log} />
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}

function LogRow({ log }: { log: LogEntry }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      className="px-3 py-1.5 hover:bg-[--color-surface-2] cursor-pointer transition-colors"
      onClick={() => setExpanded((v) => !v)}
    >
      <div className="flex items-start gap-3 min-w-0">
        <span className="text-xs font-mono text-[--color-text-dim] shrink-0 tabular-nums w-20 mt-0.5">
          {new Date(log.timestamp).toLocaleTimeString()}
        </span>
        <SeverityBadge severity={log.severity} />
        <span className="text-xs font-mono text-[--color-text-muted] shrink-0 w-16 mt-0.5">
          {LOG_SOURCE_LABEL[log.source] ?? log.source}
        </span>
        <span className={`text-xs font-mono text-[--color-text] break-all ${expanded ? '' : 'line-clamp-1'}`}>
          {log.message}
        </span>
      </div>
      {expanded && Object.keys(log.extra).length > 0 && (
        <div className="mt-2 ml-36 pl-3 border-l border-[--color-border]">
          {Object.entries(log.extra).map(([k, v]) => (
            <div key={k} className="flex gap-2 text-xs font-mono">
              <span className="text-[--color-text-dim] shrink-0">{k}:</span>
              <span className="text-[--color-text-muted] break-all">{String(v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
