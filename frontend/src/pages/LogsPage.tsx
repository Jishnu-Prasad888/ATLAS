import { useState, useRef, useEffect } from 'react'
import { useAgents, useLogs, useLiveLogs, useDebounce, usePersistedState } from '@/hooks'
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
  LoadingState,
  EmptyState,
  ErrorState,
  ConfirmDialog,
} from '@/components/common'
import { LOG_SOURCE_LABEL, downloadFile } from '@/utils'
import type { LogSeverity, LogSource, LogEntry } from '@/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const SEVERITY_OPTIONS: LogSeverity[] = ['Trace', 'Debug', 'Info', 'Warning', 'Error', 'Critical']

const SOURCE_OPTIONS: Array<{ value: LogSource; label: string }> = [
  { value: 'systemd-journald', label: 'Systemd' },
  { value: 'syslog',           label: 'Syslog'  },
  { value: 'kernel',           label: 'Kernel'  },
  { value: 'docker',           label: 'Docker'  },
  { value: 'kubernetes',       label: 'Kubernetes' },
  { value: 'internal',         label: 'Beacon Internal' },
]

/**
 * Maps severity levels to accessible color tokens and ARIA labels.
 * Uses Tailwind semantic classes so dark-mode works out of the box.
 */
const SEVERITY_STYLES: Record<
  LogSeverity,
  { pill: string; dot: string; row: string; label: string }
> = {
  Trace:    { pill: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',    dot: 'bg-slate-400',   row: '',                                          label: 'Trace'    },
  Debug:    { pill: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300', dot: 'bg-violet-400',  row: '',                                          label: 'Debug'    },
  Info:     { pill: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',           dot: 'bg-sky-400',     row: '',                                          label: 'Info'     },
  Warning:  { pill: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',   dot: 'bg-amber-400',   row: 'bg-amber-50/50 dark:bg-amber-900/10',       label: 'Warning'  },
  Error:    { pill: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',           dot: 'bg-red-500',     row: 'bg-red-50/50 dark:bg-red-900/10',           label: 'Error'    },
  Critical: { pill: 'bg-red-200 text-red-900 dark:bg-red-900/60 dark:text-red-200 font-bold', dot: 'bg-red-600 animate-pulse', row: 'bg-red-100/80 dark:bg-red-900/25', label: 'Critical' },
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Accessible severity badge with consistent min-width so columns don't jitter */
function SeverityPill({ severity }: { severity: LogSeverity }) {
  const s = SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.Info
  return (
    <span
      className={`inline-flex items-center gap-1.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase min-w-[5.5rem] justify-center ${s.pill}`}
      aria-label={`Severity: ${s.label}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
      {severity}
    </span>
  )
}

/** Expandable log row — keyboard-accessible, screen-reader friendly */
function LogRow({ log, index }: { log: LogEntry; index: number }) {
  const [expanded, setExpanded] = useState(false)
  const s = SEVERITY_STYLES[log.severity] ?? SEVERITY_STYLES.Info
  const hasExtra = Object.keys(log.extra ?? {}).length > 0
  const rowId = `log-row-${log.id}`
  const detailId = `log-detail-${log.id}`

  return (
    <div
      id={rowId}
      role="row"
      aria-rowindex={index + 1}
      className={`
        group border-b border-[--color-border] last:border-b-0
        transition-colors duration-100
        ${s.row}
        ${hasExtra ? 'cursor-pointer hover:brightness-[0.97] dark:hover:brightness-110' : ''}
      `}
    >
      {/* ── Main row ───────────────────────────────────────────────────── */}
      <div
        role="gridcell"
        className="flex items-start gap-3 px-4 py-2.5 min-w-0"
        onClick={() => hasExtra && setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (hasExtra && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            setExpanded((v) => !v)
          }
        }}
        tabIndex={hasExtra ? 0 : undefined}
        aria-expanded={hasExtra ? expanded : undefined}
        aria-controls={hasExtra ? detailId : undefined}
        aria-label={`${log.severity} log at ${new Date(log.timestamp).toLocaleTimeString()}: ${log.message}`}
      >
        {/* Timestamp */}
        <time
          dateTime={log.timestamp}
          className="text-[11px] font-mono text-[--color-text-muted] shrink-0 tabular-nums w-[5.5rem] mt-0.5 leading-tight"
          title={new Date(log.timestamp).toLocaleString()}
        >
          {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </time>

        {/* Severity badge */}
        <SeverityPill severity={log.severity} />

        {/* Source */}
        <span
          className="text-[11px] font-mono text-[--color-text-dim] shrink-0 w-[4.5rem] mt-0.5 truncate leading-tight"
          title={log.source}
          aria-label={`Source: ${LOG_SOURCE_LABEL[log.source] ?? log.source}`}
        >
          {LOG_SOURCE_LABEL[log.source] ?? log.source}
        </span>

        {/* Message */}
        <span
          className={`
            text-[13px] font-mono text-[--color-text] min-w-0 flex-1 leading-snug break-words
            ${expanded ? '' : 'line-clamp-2'}
            ${log.severity === 'Error' || log.severity === 'Critical'
              ? 'text-red-700 dark:text-red-300'
              : ''}
          `}
        >
          {log.message}
        </span>

        {/* Expand indicator */}
        {hasExtra && (
          <span
            className={`text-[--color-text-dim] shrink-0 mt-0.5 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
            aria-hidden="true"
          >
            ▾
          </span>
        )}
      </div>

      {/* ── Expanded extra fields ───────────────────────────────────────── */}
      {expanded && hasExtra && (
        <div
          id={detailId}
          role="region"
          aria-label="Additional log fields"
          className="mx-4 mb-3 mt-0.5 pl-3 border-l-2 border-[--color-border] bg-[--color-surface-2]/60 rounded-r-md"
        >
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1 py-2 px-2">
            {Object.entries(log.extra).map(([k, v]) => (
              <div key={k} className="flex gap-2 text-[12px] font-mono min-w-0">
                <dt className="text-[--color-text-dim] shrink-0 after:content-[':']">{k}</dt>
                <dd className="text-[--color-text-muted] break-all min-w-0">{String(v)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  )
}

/** Compact filter chip for quick severity filtering */
function SeverityChip({
  severity,
  active,
  count,
  onClick,
}: {
  severity: LogSeverity
  active: boolean
  count: number
  onClick: () => void
}) {
  const s = SEVERITY_STYLES[severity]
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`
        inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold
        border transition-all duration-100 cursor-pointer
        focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[--color-primary]
        ${active
          ? `${s.pill} border-current shadow-sm`
          : 'bg-transparent text-[--color-text-dim] border-[--color-border] hover:border-[--color-border-2]'
        }
      `}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
      {severity}
      {count > 0 && (
        <span className={`tabular-nums ${active ? 'opacity-80' : 'opacity-60'}`}>
          {count > 999 ? '999+' : count}
        </span>
      )}
    </button>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function LogsPage() {
  const [refreshing, setRefreshing] = useState(false)
  const { isAdmin, accessToken } = useAuthStore()
  const addNotification = useUiStore((s) => s.addNotification)
  const { data: agents } = useAgents()

  const [agentId,     setAgentId]     = usePersistedState<string>('logs_agent',    '')
  const [severity,    setSeverity]    = usePersistedState<string>('logs_severity', '')
  const [source,      setSource]      = usePersistedState<string>('logs_source',   '')
  const [searchInput, setSearchInput] = usePersistedState('logs_search', '')
  const [liveMode,    setLiveMode]    = usePersistedState('logs_live',   false)
  const [showClear,   setShowClear]   = useState(false)
  const [clearing,    setClearing]    = useState(false)
  const [autoScroll,  setAutoScroll]  = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  const search = useDebounce(searchInput, 500)
  const selectedAgentId = agentId || agents?.[0]?.agent_id || undefined

  const { data: historicLogs, isLoading, error, refetch } = useLogs(
    {
      agent_id: selectedAgentId,
      severity:  severity as LogSeverity | undefined || undefined,
      source:    source   as LogSource   | undefined || undefined,
      search:    search || undefined,
      limit: 500,
    },
    !liveMode,
  )

  const { logs: liveLogs, connected, clear: clearLive } = useLiveLogs(
    liveMode ? (selectedAgentId ?? null) : null,
  )

  const logs: LogEntry[] = liveMode ? liveLogs : (historicLogs ?? [])

  // Auto-scroll to bottom in live mode
  useEffect(() => {
    if (liveMode && autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [liveLogs, liveMode, autoScroll])

  // Severity counts for the quick-filter chips
  const severityCounts = logs.reduce<Record<string, number>>((acc, log) => {
    acc[log.severity] = (acc[log.severity] ?? 0) + 1
    return acc
  }, {})

  const handleExport = async () => {
    if (!accessToken) return
    try {
      const url = buildLogsExportUrl({
        agent_id: selectedAgentId,
        severity: severity || undefined,
      })
      await downloadFile(url, 'beacon_logs.json', accessToken)
    } catch (e: unknown) {
      addNotification({
        type: 'error',
        title: 'Export failed',
        message: e instanceof Error ? e.message : undefined,
      })
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
      addNotification({
        type: 'error',
        title: 'Failed to clear logs',
        message: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setClearing(false)
    }
  }

  // Error / warning count badges for the page header
  const errorCount    = (severityCounts['Error']    ?? 0) + (severityCounts['Critical'] ?? 0)
  const warningCount  =  severityCounts['Warning']  ?? 0

  return (
    <div className="flex flex-col gap-4">
      <style>{`@keyframes logs-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            Logs
            {errorCount > 0 && (
              <span
                className="rounded-full bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 text-[11px] font-bold px-2 py-0.5 tabular-nums"
                aria-label={`${errorCount} error${errorCount !== 1 ? 's' : ''}`}
              >
                {errorCount} error{errorCount !== 1 ? 's' : ''}
              </span>
            )}
            {warningCount > 0 && (
              <span
                className="rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 text-[11px] font-semibold px-2 py-0.5 tabular-nums"
                aria-label={`${warningCount} warning${warningCount !== 1 ? 's' : ''}`}
              >
                {warningCount} warning{warningCount !== 1 ? 's' : ''}
              </span>
            )}
          </span>
        }
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="ghost" onClick={() => { setRefreshing(true); refetch(); setTimeout(() => setRefreshing(false), 800); }}>
              <span style={{ display: 'inline-block', animation: refreshing ? 'logs-spin 0.6s linear' : 'none' }}>⟳</span> Refresh
            </Button>
            {/* Live toggle */}
            <Button
              size="sm"
              variant={liveMode ? 'primary' : 'secondary'}
              onClick={() => setLiveMode(!liveMode)}
              aria-pressed={liveMode}
              aria-label={liveMode ? 'Disable live log stream' : 'Enable live log stream'}
            >
              <span className="flex items-center gap-1.5">
                {liveMode && (
                  <span
                    className={`h-1.5 w-1.5 rounded-full transition-colors ${
                      connected ? 'bg-green-400 animate-pulse' : 'bg-red-400'
                    }`}
                    aria-label={connected ? 'Connected' : 'Disconnected'}
                  />
                )}
                {liveMode ? 'Live' : 'Live'}
              </span>
            </Button>

            {/* Auto-scroll (only relevant in live mode) */}
            {liveMode && (
              <Button
                size="sm"
                variant={autoScroll ? 'primary' : 'secondary'}
                onClick={() => setAutoScroll((v) => !v)}
                aria-pressed={autoScroll}
                title="Auto-scroll to newest entries"
              >
                ↓ Auto-scroll
              </Button>
            )}

            <Button size="sm" variant="secondary" onClick={handleExport} aria-label="Export logs as JSON">
              Export
            </Button>

            {isAdmin && (
              <Button
                size="sm"
                variant="danger"
                onClick={() => setShowClear(true)}
                loading={clearing}
                aria-label="Clear log entries"
              >
                Clear
              </Button>
            )}
          </div>
        }
      />

      {/* ── Confirm clear dialog ─────────────────────────────────────────── */}
      {showClear && (
        <ConfirmDialog
          title="Clear logs"
          message={`Clear ${severity ? severity : 'all'} logs${selectedAgentId ? ' for the selected agent' : ' for all agents'}? This cannot be undone.`}
          confirmLabel="Yes, clear"
          danger
          onConfirm={handleClear}
          onCancel={() => setShowClear(false)}
        />
      )}

      {/* ── Filters ───────────────────────────────────────────────────────── */}
      <section aria-label="Log filters">
        <div className="flex flex-wrap gap-3 items-end">
          {/* Agent */}
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-[--color-text-dim] uppercase tracking-wide">
            Agent
            <Select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="w-44 text-sm"
              aria-label="Filter by agent"
            >
              <option value="">All agents</option>
              {agents?.map((a) => (
                <option key={a.agent_id} value={a.agent_id}>{a.hostname}</option>
              ))}
            </Select>
          </label>

          {/* Severity */}
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-[--color-text-dim] uppercase tracking-wide">
            Level
            <Select
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              className="w-32 text-sm"
              aria-label="Filter by severity level"
            >
              <option value="">All levels</option>
              {SEVERITY_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </label>

          {/* Source */}
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-[--color-text-dim] uppercase tracking-wide">
            Source
            <Select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-40 text-sm"
              aria-label="Filter by log source"
            >
              <option value="">All sources</option>
              {SOURCE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </Select>
          </label>

          {/* Search */}
          <label className="flex flex-col gap-1 flex-1 min-w-40 text-[11px] font-semibold text-[--color-text-dim] uppercase tracking-wide">
            Search
            <Input
              placeholder="Filter messages…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              disabled={liveMode}
              aria-label="Search log messages"
              aria-disabled={liveMode}
              className="text-sm"
            />
          </label>
        </div>

        {/* Quick severity chips (only visible when there are logs) */}
        {logs.length > 0 && (
          <div
            className="flex flex-wrap gap-1.5 mt-3"
            role="group"
            aria-label="Quick filter by severity"
          >
            {SEVERITY_OPTIONS.filter((s) => (severityCounts[s] ?? 0) > 0).map((s) => (
              <SeverityChip
                key={s}
                severity={s as LogSeverity}
                active={severity === s}
                count={severityCounts[s] ?? 0}
                onClick={() => setSeverity(severity === s ? '' : s)}
              />
            ))}
            {severity && (
              <button
                type="button"
                onClick={() => setSeverity('')}
                className="text-[11px] text-[--color-text-dim] hover:text-[--color-text] underline underline-offset-2 ml-1"
                aria-label="Clear severity filter"
              >
                Clear filter
              </button>
            )}
          </div>
        )}
      </section>

      {/* ── Log table ─────────────────────────────────────────────────────── */}
      <Card padding={false} className="overflow-hidden">
        {/* Table header */}
        <div
          className="flex items-center justify-between gap-2 px-4 py-2 border-b border-[--color-border] bg-[--color-surface-1]/50"
          role="rowgroup"
          aria-label="Log table header"
        >
          <div
            className="flex items-center gap-3 text-[11px] font-semibold text-[--color-text-dim] uppercase tracking-wider"
            role="row"
            aria-label="Column headers"
          >
            <span className="w-[5.5rem]" role="columnheader">Time</span>
            <span className="min-w-[5.5rem]" role="columnheader">Level</span>
            <span className="w-[4.5rem]" role="columnheader">Source</span>
            <span role="columnheader">Message</span>
          </div>

          <div className="flex items-center gap-3">
            {liveMode && (
              <span
                className={`flex items-center gap-1.5 text-[11px] font-mono ${
                  connected
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-500 dark:text-red-400'
                }`}
                aria-live="polite"
                aria-atomic="true"
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    connected ? 'bg-green-500 animate-pulse' : 'bg-red-400'
                  }`}
                  aria-hidden="true"
                />
                {connected ? 'Connected' : 'Disconnected'}
              </span>
            )}

            <span
              className="text-[11px] font-mono text-[--color-text-dim] tabular-nums"
              aria-live="polite"
              aria-label={`${logs.length} log entries`}
            >
              {logs.length.toLocaleString()} {logs.length === 1 ? 'entry' : 'entries'}
            </span>
          </div>
        </div>

        {/* Content */}
        <div
          className="overflow-y-auto max-h-[calc(100vh-18rem)]"
          role="grid"
          aria-label="Log entries"
          aria-rowcount={logs.length}
          aria-busy={!liveMode && isLoading}
        >
          {!liveMode && isLoading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState error="Failed to load logs" onRetry={refetch} />
          ) : logs.length === 0 ? (
            <EmptyState
              message={
                liveMode
                  ? 'Waiting for log entries… events will appear here as they arrive.'
                  : searchInput
                  ? `No entries match "${searchInput}" — try adjusting your filters.`
                  : 'No log entries match the current filters.'
              }
            />
          ) : (
            <div>
              {logs.map((log, i) => (
                <LogRow key={log.id} log={log} index={i} />
              ))}
              {/* Auto-scroll anchor */}
              <div ref={bottomRef} aria-hidden="true" />
            </div>
          )}
        </div>
      </Card>

      {/* ── Skip-to-top link (accessibility) ─────────────────────────────── */}
      {logs.length > 20 && (
        <button
          type="button"
          className="self-start text-[12px] text-[--color-text-dim] hover:text-[--color-text] underline underline-offset-2 focus-visible:outline-2"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          ↑ Back to top
        </button>
      )}
    </div>
  )
}