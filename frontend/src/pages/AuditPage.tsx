import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useAudit, usePersistedState } from '@/hooks'
import { buildAuditExportUrl } from '@/api/telemetry'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import { PageHeader } from '@/components/layout/AppLayout'
import { LoadingState, EmptyState, ErrorState } from '@/components/common'
import { downloadFile, formatTimestamp } from '@/utils'
import type { AuditLog } from '@/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const RESOURCES = ['agents', 'users', 'auth', 'logs', 'config', 'metrics']

const ACTIONS = [
  'LOGIN', 'LOGOUT', 'PASSWORD_CHANGE', 'PASSWORD_RECOVERY',
  'USER_CREATE', 'USER_UPDATE', 'USER_DELETE', 'USER_ROLE_ASSIGN',
  'AGENT_REGISTER', 'AGENT_REMOVE', 'AGENT_RENAME', 'AGENT_REGEN_ID',
  'AGENT_ENABLE', 'AGENT_DISABLE', 'LOG_CLEAR', 'CONFIG_SET',
  'CONFIG_UPDATE', 'CONFIG_DELETE', 'RETENTION_UPDATE',
]

// Color-coded action categories — the signature element of this page
const ACTION_META: Record<string, { color: string; bg: string; group: string }> = {
  LOGIN:              { color: '#60a5fa', bg: 'rgba(96,165,250,0.1)',  group: 'auth'    },
  LOGOUT:             { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', group: 'auth'    },
  PASSWORD_CHANGE:    { color: '#60a5fa', bg: 'rgba(96,165,250,0.1)',  group: 'auth'    },
  PASSWORD_RECOVERY:  { color: '#60a5fa', bg: 'rgba(96,165,250,0.1)',  group: 'auth'    },
  USER_CREATE:        { color: '#34d399', bg: 'rgba(52,211,153,0.1)',  group: 'user'    },
  USER_UPDATE:        { color: '#34d399', bg: 'rgba(52,211,153,0.1)',  group: 'user'    },
  USER_DELETE:        { color: '#f87171', bg: 'rgba(248,113,113,0.1)', group: 'destroy' },
  USER_ROLE_ASSIGN:   { color: '#a78bfa', bg: 'rgba(167,139,250,0.1)', group: 'user'    },
  AGENT_REGISTER:     { color: '#34d399', bg: 'rgba(52,211,153,0.1)',  group: 'agent'   },
  AGENT_REMOVE:       { color: '#f87171', bg: 'rgba(248,113,113,0.1)', group: 'destroy' },
  AGENT_RENAME:       { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', group: 'agent'   },
  AGENT_REGEN_ID:     { color: '#fbbf24', bg: 'rgba(251,191,36,0.1)',  group: 'agent'   },
  AGENT_ENABLE:       { color: '#34d399', bg: 'rgba(52,211,153,0.1)',  group: 'agent'   },
  AGENT_DISABLE:      { color: '#f87171', bg: 'rgba(248,113,113,0.1)', group: 'destroy' },
  LOG_CLEAR:          { color: '#f87171', bg: 'rgba(248,113,113,0.1)', group: 'destroy' },
  CONFIG_SET:         { color: '#F0A500', bg: 'rgba(240,165,0,0.1)',   group: 'config'  },
  CONFIG_UPDATE:      { color: '#F0A500', bg: 'rgba(240,165,0,0.1)',   group: 'config'  },
  CONFIG_DELETE:      { color: '#f87171', bg: 'rgba(248,113,113,0.1)', group: 'destroy' },
  RETENTION_UPDATE:   { color: '#F0A500', bg: 'rgba(240,165,0,0.1)',   group: 'config'  },
}

const ROW_HEIGHT = 36 // px, fixed for virtual scroll
const OVERSCAN   = 8  // extra rows above/below viewport

// ─── Styles ───────────────────────────────────────────────────────────────────

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600&display=swap');

  .atlas-audit * { font-family: 'JetBrains Mono', monospace; }

  .atlas-audit .filter-input {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 4px;
    color: rgba(255,255,255,0.75);
    font-size: 11px;
    padding: 5px 10px;
    outline: none;
    transition: border-color 0.15s;
    font-family: 'JetBrains Mono', monospace;
  }
  .atlas-audit .filter-input:focus {
    border-color: rgba(240,165,0,0.5);
  }
  .atlas-audit .filter-input::placeholder {
    color: rgba(255,255,255,0.2);
  }
  .atlas-audit .filter-input option {
    background: #151821;
    color: rgba(255,255,255,0.75);
  }

  .atlas-audit .row-base {
    display: grid;
    grid-template-columns: 140px 96px 1fr 80px 100px 110px 44px;
    align-items: center;
    height: ${ROW_HEIGHT}px;
    cursor: pointer;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    transition: background 0.1s;
  }
  .atlas-audit .row-base:hover {
    background: rgba(255,255,255,0.03);
  }
  .atlas-audit .row-base.row-active {
    background: rgba(240,165,0,0.05);
    border-bottom-color: rgba(240,165,0,0.15);
  }
  .atlas-audit .row-base.row-fail {
    border-left: 2px solid rgba(248,113,113,0.6);
  }

  .atlas-audit .cell {
    padding: 0 10px;
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .atlas-audit .detail-panel {
    background: #0a0c10;
    border-bottom: 1px solid rgba(255,255,255,0.07);
    padding: 12px 14px;
    animation: audit-slide-in 0.12s ease;
  }
  @keyframes audit-slide-in {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .atlas-audit .action-chip {
    display: inline-block;
    font-size: 9.5px;
    font-weight: 500;
    letter-spacing: 0.06em;
    padding: 2px 6px;
    border-radius: 3px;
    white-space: nowrap;
  }

  .atlas-audit .thead-row {
    display: grid;
    grid-template-columns: 140px 96px 1fr 80px 100px 110px 44px;
    height: 28px;
    align-items: center;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    position: sticky;
    top: 0;
    z-index: 2;
    background: #0D0F14;
  }
  .atlas-audit .thead-cell {
    padding: 0 10px;
    font-size: 9px;
    font-weight: 500;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.22);
  }

  .atlas-audit .stat-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 10px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.07);
  }

  .atlas-audit .btn {
    padding: 5px 12px;
    border-radius: 4px;
    font-size: 11px;
    font-family: 'JetBrains Mono', monospace;
    cursor: pointer;
    transition: all 0.15s;
    outline: none;
  }
  .atlas-audit .btn-ghost {
    background: transparent;
    border: 1px solid rgba(255,255,255,0.1);
    color: rgba(255,255,255,0.45);
  }
  .atlas-audit .btn-ghost:hover {
    border-color: rgba(255,255,255,0.25);
    color: rgba(255,255,255,0.75);
  }
  .atlas-audit .btn-amber {
    background: rgba(240,165,0,0.12);
    border: 1px solid rgba(240,165,0,0.3);
    color: #F0A500;
  }
  .atlas-audit .btn-amber:hover {
    background: rgba(240,165,0,0.2);
  }

  .atlas-audit .clear-btn {
    font-size: 10px;
    font-family: 'JetBrains Mono', monospace;
    color: rgba(255,255,255,0.25);
    cursor: pointer;
    background: none;
    border: none;
    padding: 0 4px;
    transition: color 0.12s;
  }
  .atlas-audit .clear-btn:hover { color: rgba(255,255,255,0.6); }
`

// ─── Virtual scroll hook ──────────────────────────────────────────────────────

function useVirtualRows(total: number, rowHeight: number, overscan = OVERSCAN) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(600)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight))
    ro.observe(el)
    setViewportH(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop((e.currentTarget as HTMLDivElement).scrollTop)
  }, [])

  const startIdx = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const endIdx   = Math.min(total - 1, Math.ceil((scrollTop + viewportH) / rowHeight) + overscan)

  return { containerRef, onScroll, startIdx, endIdx, totalH: total * rowHeight }
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function AuditPage() {
  const { accessToken } = useAuthStore()
  const addNotification = useUiStore((s) => s.addNotification)

  const [userFilter, setUserFilter]         = usePersistedState('audit_user', '')
  const [actionFilter, setActionFilter]     = usePersistedState('audit_action', '')
  const [resourceFilter, setResourceFilter] = usePersistedState('audit_resource', '')
  const [expandedId, setExpandedId]         = useState<string | null>(null)
  const [failOnly, setFailOnly]             = useState(false)

  const { data: logs, isLoading, error, refetch } = useAudit({
    user: userFilter || undefined,
    action: actionFilter || undefined,
    resource: resourceFilter || undefined,
    limit: 500,
  })

  const filtered = useMemo(() => {
    if (!logs) return []
    return failOnly ? logs.filter((l) => !l.success) : logs
  }, [logs, failOnly])

  const failCount = useMemo(() => logs?.filter((l) => !l.success).length ?? 0, [logs])

  const handleExport = async () => {
    if (!accessToken) return
    try {
      await downloadFile(buildAuditExportUrl(), 'atlas_audit.json', accessToken)
    } catch (e: unknown) {
      addNotification({
        type: 'error',
        title: 'Export failed',
        message: e instanceof Error ? e.message : undefined,
      })
    }
  }

  const clearFilters = () => {
    setUserFilter('')
    setActionFilter('')
    setResourceFilter('')
    setFailOnly(false)
  }

  const hasFilters = userFilter || actionFilter || resourceFilter || failOnly

  return (
    <div className="atlas-audit flex flex-col h-full" style={{ color: 'rgba(255,255,255,0.75)' }}>
      <style>{CSS}</style>

      <PageHeader
        title="Audit Trail"
        subtitle="Immutable record of all system actions"
        actions={
          <button className="btn btn-amber" onClick={handleExport}>
            ↓ Export
          </button>
        }
      />

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div
        className="flex flex-wrap items-center gap-2 mb-4"
        style={{ padding: '0 0 0 0' }}
      >
        {/* User filter */}
        <input
          className="filter-input w-36"
          placeholder="user..."
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          spellCheck={false}
        />

        {/* Action filter */}
        <select
          className="filter-input w-44"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
        >
          <option value="">all actions</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>{a.toLowerCase()}</option>
          ))}
        </select>

        {/* Resource filter */}
        <select
          className="filter-input w-32"
          value={resourceFilter}
          onChange={(e) => setResourceFilter(e.target.value)}
        >
          <option value="">all resources</option>
          {RESOURCES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>

        {/* Failures toggle */}
        <button
          className="btn btn-ghost"
          onClick={() => setFailOnly((v) => !v)}
          style={failOnly ? {
            borderColor: 'rgba(248,113,113,0.5)',
            color: '#f87171',
            background: 'rgba(248,113,113,0.08)',
          } : {}}
        >
          {failOnly ? '● failures' : '○ failures'}
          {failCount > 0 && (
            <span style={{ marginLeft: 5, color: '#f87171', opacity: failOnly ? 1 : 0.6 }}>
              {failCount}
            </span>
          )}
        </button>

        {/* Refresh */}
        <button className="btn btn-ghost" onClick={() => refetch()}>
          ↺ refresh
        </button>

        {/* Clear */}
        {hasFilters && (
          <button className="clear-btn" onClick={clearFilters}>
            clear ×
          </button>
        )}

        {/* Spacer + count */}
        <div className="flex-1" />
        <span className="stat-badge" style={{ color: 'rgba(255,255,255,0.35)' }}>
          <span style={{ color: 'rgba(255,255,255,0.55)', fontWeight: 500 }}>
            {filtered.length.toLocaleString()}
          </span>
          {hasFilters ? ` / ${(logs?.length ?? 0).toLocaleString()} entries` : ' entries'}
        </span>
      </div>

      {/* ── Log table ───────────────────────────────────────────────────── */}
      <div
        className="flex-1 flex flex-col rounded overflow-hidden"
        style={{
          background: '#0D0F14',
          border: '1px solid rgba(255,255,255,0.07)',
          minHeight: 0,
        }}
      >
        {/* Header */}
        <div className="thead-row">
          {['Time', 'User', 'Action', 'Resource', 'Target', 'IP', 'Result'].map((h) => (
            <div key={h} className="thead-cell">{h}</div>
          ))}
        </div>

        {/* Body */}
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <LoadingState />
          </div>
        ) : error ? (
          <div className="flex-1 flex items-center justify-center">
            <ErrorState error="Could not load audit log" onRetry={refetch} />
          </div>
        ) : !filtered.length ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState message={hasFilters ? 'No entries match these filters' : 'No audit entries yet'} />
          </div>
        ) : (
          <VirtualList
            logs={filtered}
            expandedId={expandedId}
            onToggle={(id) => setExpandedId((cur) => (cur === id ? null : id))}
          />
        )}
      </div>

    </div>
  )
}

// ─── Virtual list ─────────────────────────────────────────────────────────────

function VirtualList({
  logs,
  expandedId,
  onToggle,
}: {
  logs: AuditLog[]
  expandedId: string | null
  onToggle: (id: string) => void
}) {
  const { containerRef, onScroll, startIdx, endIdx, totalH } = useVirtualRows(logs.length, ROW_HEIGHT)

  // When a row is expanded, we render it outside virtual space so it can be any height.
  // We keep track of its position to account for offset correctly.
  const expandedIdx = expandedId ? logs.findIndex((l) => l.id === expandedId) : -1

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className="flex-1 overflow-y-auto overflow-x-auto"
      style={{ position: 'relative' }}
    >
      {/* Total height spacer for virtual scroll */}
      <div style={{ height: totalH, position: 'relative' }}>

        {/* Expanded detail panel — absolutely positioned */}
        {expandedIdx >= 0 && expandedId && (
          <ExpandedDetail
            log={logs[expandedIdx]}
            top={(expandedIdx + 1) * ROW_HEIGHT}
          />
        )}

        {/* Visible rows */}
        {logs.slice(startIdx, endIdx + 1).map((log, i) => {
          const idx = startIdx + i
          const isExpanded = log.id === expandedId
          return (
            <AuditRow
              key={log.id}
              log={log}
              top={idx * ROW_HEIGHT}
              isExpanded={isExpanded}
              onToggle={() => onToggle(log.id)}
            />
          )
        })}

      </div>
    </div>
  )
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function AuditRow({
  log,
  top,
  isExpanded,
  onToggle,
}: {
  log: AuditLog
  top: number
  isExpanded: boolean
  onToggle: () => void
}) {
  const meta = ACTION_META[log.action]

  return (
    <div
      className={`row-base ${isExpanded ? 'row-active' : ''} ${!log.success ? 'row-fail' : ''}`}
      style={{ position: 'absolute', top, left: 0, right: 0 }}
      onClick={onToggle}
    >
      {/* Time */}
      <div className="cell" style={{ color: 'rgba(255,255,255,0.28)', fontSize: 10 }}>
        {formatTimestamp(log.timestamp)}
      </div>

      {/* User */}
      <div className="cell" style={{ color: 'rgba(255,255,255,0.65)', fontWeight: 500 }}>
        {log.user}
      </div>

      {/* Action chip */}
      <div className="cell">
        <span
          className="action-chip"
          style={{
            color: meta?.color ?? 'rgba(255,255,255,0.5)',
            background: meta?.bg ?? 'rgba(255,255,255,0.06)',
          }}
        >
          {log.action.toLowerCase()}
        </span>
      </div>

      {/* Resource */}
      <div className="cell" style={{ color: 'rgba(255,255,255,0.35)' }}>
        {log.resource}
      </div>

      {/* Target ID */}
      <div
        className="cell"
        style={{ color: 'rgba(255,255,255,0.28)', fontFamily: 'monospace', fontSize: 10 }}
        title={log.resource_id}
      >
        {log.resource_id ? `…${log.resource_id.slice(-8)}` : '—'}
      </div>

      {/* IP */}
      <div className="cell" style={{ color: 'rgba(255,255,255,0.28)', fontSize: 10 }}>
        {log.ip_address ?? '—'}
      </div>

      {/* Result */}
      <div className="cell">
        <span
          style={{
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '0.08em',
            color: log.success ? '#34d399' : '#f87171',
          }}
        >
          {log.success ? 'OK' : 'FAIL'}
        </span>
      </div>
    </div>
  )
}

// ─── Expanded detail ──────────────────────────────────────────────────────────

function ExpandedDetail({ log, top }: { log: AuditLog; top: number }) {
  const meta    = ACTION_META[log.action]
  const details = log.details ?? {}
  const hasDetails = Object.keys(details).length > 0

  return (
    <div
      className="detail-panel"
      style={{ position: 'absolute', top, left: 0, right: 0, zIndex: 1 }}
    >
      <div className="flex flex-wrap gap-x-6 gap-y-2 mb-3">
        <DetailField label="full id"   value={log.resource_id ?? '—'} />
        <DetailField label="action"    value={log.action} color={meta?.color} />
        <DetailField label="resource"  value={log.resource} />
        <DetailField label="ip"        value={log.ip_address ?? '—'} />
        <DetailField label="timestamp" value={formatTimestamp(log.timestamp)} />
        <DetailField
          label="result"
          value={log.success ? 'success' : 'failure'}
          color={log.success ? '#34d399' : '#f87171'}
        />
      </div>
      {hasDetails && (
        <>
          <div
            className="text-[9px] font-medium tracking-[0.2em] uppercase mb-1.5"
            style={{ color: 'rgba(255,255,255,0.2)' }}
          >
            Details
          </div>
          <pre
            style={{
              fontSize: 10.5,
              color: 'rgba(255,255,255,0.45)',
              lineHeight: '1.65',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              margin: 0,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {JSON.stringify(details, null, 2)}
          </pre>
        </>
      )}
    </div>
  )
}

function DetailField({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color?: string
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
        {label}
      </span>
      <span style={{ fontSize: 11, color: color ?? 'rgba(255,255,255,0.6)', fontFamily: "'JetBrains Mono', monospace" }}>
        {value}
      </span>
    </div>
  )
}