import {
  useState, useMemo, useEffect, useRef,
  memo, useCallback,
} from 'react'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import {
  useFleetHealth, useAgents, useLatestMetrics, useLiveMetrics, useLiveLogs,
} from '@/hooks'
import { PageHeader } from '@/components/layout/AppLayout'
import {
  AgentStatusBadge, SeverityBadge, Sparkline, LoadingState, EmptyState, Tag,
} from '@/components/common'
import {
  formatBytes, formatBandwidth, formatUptime, timeAgo, shortAgentId, gaugeColor,
} from '@/utils'
import type { Agent, CpuData, RamData, StorageData, NetworkData, KernelData, LogEntry } from '@/types'

// ─── Config ───────────────────────────────────────────────────────────────────

const LOG_BUFFER_MAX = 200 // hard cap on live log entries kept in memory

// ─── Styles ───────────────────────────────────────────────────────────────────

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600&display=swap');

  .atlas-dash * { font-family: 'JetBrains Mono', monospace; }

  .atlas-dash .agent-row {
    width: 100%;
    text-align: left;
    padding: 12px 14px;
    border-bottom: 1px solid var(--color-border);
    transition: background 0.1s;
    cursor: pointer;
    background: transparent;
    border-left: 2px solid transparent;
  }
  .atlas-dash .agent-row:hover { background: color-mix(in srgb, var(--color-text) 3%, transparent); }
  .atlas-dash .agent-row.agent-selected {
    background: color-mix(in srgb, #F0A500 6%, transparent);
    border-left-color: #F0A500;
  }

  .atlas-dash .fleet-stat {
    flex: 1;
    padding: 14px 16px;
    border-right: 1px solid var(--color-border);
  }
  .atlas-dash .fleet-stat:last-child { border-right: none; }

  .atlas-dash .metric-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
    padding: 18px;
  }

  .atlas-dash .info-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    padding: 14px 16px;
    border-top: 1px solid var(--color-border);
  }

  .atlas-dash .info-cell {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .atlas-dash .log-entry {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 7px 14px;
    border-bottom: 1px solid color-mix(in srgb, var(--color-border) 60%, transparent);
    transition: background 0.08s;
  }
  .atlas-dash .log-entry:hover { background: color-mix(in srgb, var(--color-text) 2.5%, transparent); }
  .atlas-dash .log-entry:last-child { border-bottom: none; }

  @keyframes dash-fadein {
    from { opacity: 0; transform: translateY(3px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .atlas-dash .panel {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    overflow: hidden;
  }
  .atlas-dash .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--color-border);
  }
  .atlas-dash .panel-label {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--color-text-dim);
  }

  @keyframes atlas-pulse-ring {
    0%   { opacity: 0.7; transform: scale(1); }
    100% { opacity: 0; transform: scale(2.2); }
  }
  .atlas-dash .ws-live::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: #34d399;
    animation: atlas-pulse-ring 1.8s ease-out infinite;
  }
`

// ─── Log buffer hook ──────────────────────────────────────────────────────────
// Caps the live log list at LOG_BUFFER_MAX entries so the DOM never grows unbounded.

function useCappedLogs(liveLogs: LogEntry[]): LogEntry[] {
  const bufferRef = useRef<LogEntry[]>([])
  const prevLenRef = useRef(0)

  return useMemo(() => {
    // Only process genuinely new entries
    if (liveLogs.length === prevLenRef.current) return bufferRef.current

    const newEntries = liveLogs.length > prevLenRef.current
      ? liveLogs.slice(prevLenRef.current)
      : liveLogs // reset

    prevLenRef.current = liveLogs.length

    const combined = [...bufferRef.current, ...newEntries]
    bufferRef.current = combined.length > LOG_BUFFER_MAX
      ? combined.slice(combined.length - LOG_BUFFER_MAX)
      : combined

    return bufferRef.current
  }, [liveLogs])
}

// ─── Arc gauge ────────────────────────────────────────────────────────────────
// Signature element: a thin SVG arc that sweeps to the percentage.

const ArcGauge = memo(function ArcGauge({
  label,
  value,
  detail,
  history,
}: {
  label: string
  value: number
  detail?: string
  history?: number[]
}) {
  const R = 34
  const cx = 42
  const cy = 42
  const stroke = 3.4
  const circumference = Math.PI * R // half-circle arc
  const progress = Math.min(1, Math.max(0, value / 100))
  const dashOffset = circumference * (1 - progress)

  // Color based on threshold
  const color = value >= 85 ? '#f87171' : value >= 65 ? '#fbbf24' : '#34d399'
  const trackColor = 'var(--color-border)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <div style={{ position: 'relative', width: 88, height: 52 }}>
        <svg width="88" height="52" viewBox="0 0 88 56" style={{ overflow: 'visible' }}>
          {/* Track */}
          <path
            d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`}
            fill="none"
            stroke={trackColor}
            strokeWidth={stroke}
            strokeLinecap="round"
          />
          {/* Progress arc */}
          <path
            d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${circumference}`}
            strokeDashoffset={dashOffset}
            style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.4s ease' }}
          />
        </svg>
        {/* Center value */}
        <div style={{
          position: 'absolute', bottom: 4, left: 0, right: 0,
          textAlign: 'center',
        }}>
          <span style={{ fontSize: 16, fontWeight: 600, color, fontFamily: "'JetBrains Mono', monospace" }}>
            {Math.round(value)}
          </span>
          <span style={{ fontSize: 10, color: 'var(--color-text-dim)', marginLeft: 2 }}>%</span>
        </div>
      </div>

      {/* Sparkline */}
      {history && history.length > 1 && (
        <div style={{ opacity: 0.7 }}>
          <Sparkline values={history} color={color} width={88} height={20} />
        </div>
      )}

      {/* Label */}
      <span style={{ fontSize: 11, color: 'var(--color-text-dim)', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
        {label}
      </span>
      {detail && (
        <span style={{ fontSize: 11, color: 'var(--color-text-dim)', marginTop: -2 }}>
          {detail}
        </span>
      )}
    </div>
  )
})

// ─── Fleet stat ───────────────────────────────────────────────────────────────

const FleetStat = memo(function FleetStat({
  label, value, color,
}: {
  label: string
  value: number | string
  color?: string
}) {
  return (
    <div className="fleet-stat">
      <div style={{ fontSize: 10, color: 'var(--color-text-dim)', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 600, color: color ?? 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
    </div>
  )
})

// ─── Agent row ────────────────────────────────────────────────────────────────

const AgentRow = memo(function AgentRow({
  agent, selected, onClick,
}: {
  agent: Agent
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      className={`agent-row ${selected ? 'agent-selected' : ''}`}
      onClick={onClick}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: selected ? 'var(--color-text)' : 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {agent.hostname}
        </span>
        <AgentStatusBadge status={agent.status} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10.5, color: 'var(--color-text-dim)', letterSpacing: '0.05em' }}>
          {shortAgentId(agent.agent_id)}
        </span>
        {agent.is_stale && (
          <span style={{ fontSize: 10, color: '#fbbf24', letterSpacing: '0.1em' }}>stale</span>
        )}
      </div>
      {agent.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
          {agent.tags.slice(0, 3).map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </div>
      )}
      <div style={{ fontSize: 10.5, color: 'var(--color-text-dim)', marginTop: 4 }}>
        {timeAgo(agent.last_seen)}
      </div>
    </button>
  )
})

// ─── Log entry row ────────────────────────────────────────────────────────────

const LogRow = memo(function LogRow({ log }: { log: LogEntry }) {
  return (
    <div className="log-entry">
      <SeverityBadge severity={log.severity} />
      <span style={{ fontSize: 11, color: 'var(--color-text-dim)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
        {new Date(log.timestamp).toLocaleTimeString()}
      </span>
      <span style={{ fontSize: 12, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
        {log.message}
      </span>
    </div>
  )
})

// ─── Info cell ────────────────────────────────────────────────────────────────

function InfoCell({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="info-cell">
      <span style={{ fontSize: 10, color: 'var(--color-text-dim)', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
        {label}
      </span>
      <span style={{
        fontSize: 12,
        color: 'var(--color-text)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontFamily: mono ? "'JetBrains Mono', monospace" : undefined,
      }}>
        {value}
      </span>
    </div>
  )
}

// ─── Metric panel ─────────────────────────────────────────────────────────────

const MetricPanel = memo(function MetricPanel({
  agentId,
  hostname,
}: {
  agentId: string | null
  hostname: string | undefined
}) {
  const { data: latestMetrics } = useLatestMetrics(agentId)
  const { history } = useLiveMetrics(agentId)

  const cpu     = latestMetrics?.cpu?.data     as CpuData     | undefined
  const ram     = latestMetrics?.ram?.data     as RamData     | undefined
  const storage = latestMetrics?.storage?.data as StorageData | undefined
  const network = latestMetrics?.network?.data as NetworkData | undefined
  const kernel  = latestMetrics?.kernel?.data  as KernelData  | undefined

  const rootDisk         = storage?.filesystems.find((f) => f.mount_point === '/') ?? storage?.filesystems[0]
  const primaryInterface = network?.interfaces.find((i) => i.name !== 'lo') ?? network?.interfaces[0]

  if (!agentId) {
    return (
      <div className="panel" style={{ flex: 1 }}>
        <div className="panel-header">
          <span className="panel-label">Metrics</span>
        </div>
        <div style={{ padding: '36px 0' }}>
          <EmptyState message="Select an agent to view metrics" />
        </div>
      </div>
    )
  }

  return (
    <div className="panel" style={{ flex: 1 }}>
      {/* Header */}
      <div className="panel-header">
        <span className="panel-label">Metrics</span>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-muted)' }}>
          {hostname ?? '—'}
        </span>
      </div>

      {/* Arc gauges */}
      {(cpu || ram || rootDisk) ? (
        <div className="metric-grid">
          {cpu && (
            <ArcGauge
              label="CPU"
              value={cpu.usage_pct}
              history={history.cpu}
            />
          )}
          {ram && (
            <ArcGauge
              label="RAM"
              value={ram.usage_pct}
              detail={`${formatBytes(ram.used_bytes)} / ${formatBytes(ram.total_bytes)}`}
              history={history.ram}
            />
          )}
          {rootDisk && (
            <ArcGauge
              label="Disk"
              value={rootDisk.usage_pct}
              detail={`${formatBytes(rootDisk.used_bytes)} / ${formatBytes(rootDisk.total_bytes)}`}
            />
          )}
        </div>
      ) : (
        <div style={{ padding: '24px 0' }}>
          <EmptyState message="Waiting for metrics..." />
        </div>
      )}

      {/* Network */}
      {primaryInterface && (
        <div className="info-row">
          <InfoCell label={`${primaryInterface.name} RX`} value={formatBandwidth(primaryInterface.rx_bytes_rate)} />
          <InfoCell label={`${primaryInterface.name} TX`} value={formatBandwidth(primaryInterface.tx_bytes_rate)} />
        </div>
      )}

      {/* CPU load averages */}
      {cpu && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
          borderTop: '1px solid var(--color-border)',
          padding: '12px 18px',
          gap: 12,
        }}>
          <InfoCell label="Load 1m"  value={cpu.load_avg_1m.toFixed(2)}  />
          <InfoCell label="Load 5m"  value={cpu.load_avg_5m.toFixed(2)}  />
          <InfoCell label="Load 15m" value={cpu.load_avg_15m.toFixed(2)} />
        </div>
      )}

      {/* Kernel / uptime */}
      {kernel && (
        <div className="info-row">
          <InfoCell label="Uptime" value={formatUptime(kernel.uptime_secs)} />
          <InfoCell label="Kernel" value={kernel.kernel_version} />
        </div>
      )}
    </div>
  )
})

// ─── Log panel ────────────────────────────────────────────────────────────────

const LogPanel = memo(function LogPanel({
  agentId,
}: {
  agentId: string | null
}) {
  const { logs: rawLogs } = useLiveLogs(agentId)
  const logs = useCappedLogs(rawLogs)

  // Auto-scroll to bottom as new entries arrive
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const isNearBottom = useRef(true)

  const onScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    isNearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }, [])

  useEffect(() => {
    if (isNearBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs.length])

  return (
      <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: 260 }}>
      <div className="panel-header">
        <span className="panel-label">Live Logs</span>
          <span style={{ fontSize: 9.5, color: 'var(--color-text-dim)' }}>
            {logs.length > 0 ? `${logs.length} entries${logs.length >= LOG_BUFFER_MAX ? ' (capped)' : ''}` : ''}
          </span>
        </div>
        <div
          ref={containerRef}
          onScroll={onScroll}
          style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}
      >
        {logs.length === 0 ? (
          <div style={{ paddingTop: 20 }}>
            <EmptyState message={agentId ? 'Waiting for log entries…' : 'Select an agent'} />
          </div>
        ) : (
          <>
            {logs.map((log) => <LogRow key={log.id} log={log} />)}
            <div ref={bottomRef} />
          </>
        )}
      </div>
    </div>
  )
})

// ─── Dashboard ────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { user }                                      = useAuthStore()
  const { selectedAgentId, selectAgent, wsConnected } = useUiStore()
  const { data: health }                              = useFleetHealth()
  const { data: agents, isLoading: agentsLoading }    = useAgents()

  // Stable active agent ID — don't derive inline so it doesn't thrash on each render
  const activeAgentId = useMemo(
    () => selectedAgentId ?? agents?.[0]?.agent_id ?? null,
    [selectedAgentId, agents],
  )

  const activeAgent = useMemo(
    () => agents?.find((a) => a.agent_id === activeAgentId),
    [agents, activeAgentId],
  )

  const handleSelectAgent = useCallback(
    (id: string) => selectAgent(id),
    [selectAgent],
  )

  // Stable fleet numbers — only update when values actually change
  const fleetTotal    = health?.agents.total    ?? 0
  const fleetOnline   = health?.agents.online   ?? 0
  const fleetDegraded = health?.agents.degraded ?? 0
  const fleetOffline  = health?.agents.offline  ?? 0

  return (
    <div
      className="atlas-dash"
      style={{ display: 'flex', flexDirection: 'column', gap: 18, height: '100%', color: 'var(--color-text)' }}
    >
      <style>{CSS}</style>

      <PageHeader
        title="Dashboard"
        subtitle={user ? `${user.username}` : undefined}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ position: 'relative', width: 9, height: 9, display: 'inline-block' }}>
              <span
                style={{
                  position: 'absolute', inset: 0, borderRadius: '50%',
                  background: wsConnected ? '#34d399' : 'var(--color-text-dim)',
                }}
                className={wsConnected ? 'ws-live' : ''}
              />
            </span>
            <span style={{ fontSize: 12, color: 'var(--color-text-dim)', letterSpacing: '0.12em' }}>
              {wsConnected ? 'live' : 'polling'}
            </span>
          </div>
        }
      />

      {/* ── Fleet strip ─────────────────────────────────────────────────── */}
      <div
        className="panel"
        style={{ display: 'flex', flexShrink: 0 }}
      >
        <FleetStat label="Total"    value={fleetTotal   || '—'} />
        <FleetStat label="Online"   value={fleetOnline  || '—'} color={fleetOnline  > 0 ? '#34d399'  : undefined} />
        <FleetStat label="Degraded" value={fleetDegraded || '—'} color={fleetDegraded > 0 ? '#fbbf24' : undefined} />
        <FleetStat label="Offline"  value={fleetOffline || '—'}  color={fleetOffline  > 0 ? '#f87171' : undefined} />
      </div>

      {/* ── Main layout ─────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 18, flex: 1, minHeight: 0 }}>

        {/* Agent list */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="panel-header">
            <span className="panel-label">Agents</span>
            <span style={{ fontSize: 9.5, color: 'var(--color-text-dim)' }}>
              {agents?.length ?? 0}
            </span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {agentsLoading ? (
              <LoadingState />
            ) : !agents?.length ? (
              <EmptyState message="No agents registered" />
            ) : (
              agents.map((agent) => (
                <AgentRow
                  key={agent.agent_id}
                  agent={agent}
                  selected={agent.agent_id === activeAgentId}
                  onClick={() => handleSelectAgent(agent.agent_id)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minHeight: 0 }}>
          <MetricPanel
            agentId={activeAgentId}
            hostname={activeAgent?.hostname}
          />
          <LogPanel agentId={activeAgentId} />
        </div>

      </div>
    </div>
  )
}
