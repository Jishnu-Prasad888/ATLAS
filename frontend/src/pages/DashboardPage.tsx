import {
  useState, useMemo,
  memo, useCallback,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import {
  useFleetHealth, useAgents, useLiveMetrics,
} from '@/hooks'
import { queryKeys } from '@/hooks/queryKeys'
import { PageHeader } from '@/components/layout/AppLayout'
import {
  AgentStatusBadge, Sparkline, LoadingState, EmptyState, Tag, Button,
} from '@/components/common'
import {
  formatBytes, formatBandwidth, formatUptime, timeAgo, shortAgentId
} from '@/utils'
import type { Agent, CpuData, RamData, StorageData, NetworkData, KernelData } from '@/types'

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

  @keyframes atlas-spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }
  .atlas-spin { animation: atlas-spin 0.6s linear; }
`

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
  const { latest, history } = useLiveMetrics(agentId)

  const cpu     = latest.cpu?.data     as unknown as CpuData     | undefined
  const ram     = latest.ram?.data     as unknown as RamData     | undefined
  const storage = latest.storage?.data as unknown as StorageData | undefined
  const network = latest.network?.data as unknown as NetworkData | undefined
  const kernel  = latest.kernel?.data  as unknown as KernelData  | undefined

  const storagePartitions = storage?.partitions?.length ? storage.partitions : storage?.filesystems ?? []
  const storageDisks = storage?.disks ?? []
  const rootPartition = storagePartitions.find((p) => p.mount_point === '/') ?? storagePartitions[0]
  const osDisk = storage?.os_disk
    ?? (() => {
      if (!rootPartition) return storageDisks[0]
      const parentId = rootPartition.parent_disk ?? rootPartition.device ?? rootPartition.name
      return storageDisks.find((d) => d.device === parentId || d.name === parentId) ?? storageDisks[0]
    })()
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
      {(cpu || ram || osDisk) ? (
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
          {osDisk && (
            <ArcGauge
              label="OS Disk"
              value={osDisk.usage_pct}
              detail={`${formatBytes(osDisk.used_bytes)} / ${formatBytes(osDisk.total_bytes)}`}
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


// ─── Dashboard ────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const qc = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
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

  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    qc.invalidateQueries({ queryKey: queryKeys.fleetHealth() })
    qc.invalidateQueries({ queryKey: queryKeys.agents() })
    if (activeAgentId) {
      qc.invalidateQueries({ queryKey: queryKeys.telemetryLatest(activeAgentId) })
    }
    setTimeout(() => setRefreshing(false), 800)
  }, [qc, activeAgentId])

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
            <Button size="sm" variant="ghost" onClick={handleRefresh}>
              <span className={refreshing ? 'atlas-spin' : ''} style={{ display: 'inline-block' }}>⟳</span> Refresh
            </Button>
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
        </div>

      </div>
    </div>
  )
}
