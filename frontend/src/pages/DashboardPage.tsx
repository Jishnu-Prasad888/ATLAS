import { useState, useMemo, memo, useCallback, useEffect, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import {
  useFleetHealth, useAgents, useLiveMetrics, useLogs,
} from '@/hooks'
import { queryKeys } from '@/hooks/queryKeys'
import { PageHeader } from '@/components/layout/AppLayout'
import {
  AgentStatusBadge, Sparkline, LoadingState, EmptyState, Tag, Button, SeverityBadge, Card,
} from '@/components/common'
import {
  formatBytes, formatBandwidth, formatUptime, timeAgo, shortAgentId, LOG_SOURCE_LABEL, formatTimestamp,
} from '@/utils'
import { configApi, usersApi } from '@/api'
import type {
  CpuData, RamData, StorageData, NetworkData, KernelData, LogEntry, GpuData,
} from '@/types'

// ─── Styles ───────────────────────────────────────────────────────────────────

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600&display=swap');

  .atlas-dash * { font-family: 'JetBrains Mono', monospace; }

  .atlas-dash {
    overflow: hidden;
  }

  .atlas-dash .panel {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
  }
  .atlas-dash .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--color-border);
    flex: 0 0 auto;
  }
  .atlas-dash .panel-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }
  .atlas-dash .panel-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--color-text-dim);
  }
  .atlas-dash .panel-aux {
    font-size: 11px;
    color: var(--color-text-muted);
  }

  .atlas-dash .info-cell {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .atlas-dash .stat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 12px;
    flex-shrink: 0;
  }
  .atlas-dash .stat-card {
    padding: 14px 16px;
    border-radius: 10px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
  }
  .atlas-dash .stat-label {
    font-size: 11px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--color-text-dim);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .atlas-dash .stat-value {
    font-size: 20px;
    font-weight: 600;
    color: var(--color-text);
    margin-top: 4px;
    line-height: 1.2;
  }
  .atlas-dash .stat-hint {
    font-size: 12px;
    color: var(--color-text-muted);
    margin-top: 6px;
  }
  .atlas-dash .stat-badge {
    padding: 2px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-text) 10%, transparent);
    color: var(--color-text-muted);
    font-size: 10px;
    letter-spacing: 0.08em;
  }

  .atlas-dash .main-grid {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-areas:
      "agent agent agent agent metrics metrics metrics metrics metrics health health health"
      "signals signals signals signals signals signals signals signals account account account account";
    gap: 12px;
  }
  .atlas-dash .tile-agent   { grid-area: agent; min-width: 0; min-height: 0; height: 100%; display: flex; }
  .atlas-dash .tile-metrics { grid-area: metrics; min-width: 0; min-height: 0; height: 100%; display: flex; }
  .atlas-dash .tile-health  { grid-area: health; min-width: 0; min-height: 0; height: 100%; display: flex; }
  .atlas-dash .tile-signals { grid-area: signals; min-width: 0; min-height: 0; height: 100%; display: flex; }
  .atlas-dash .tile-account { grid-area: account; min-width: 0; min-height: 0; height: 100%; display: flex; }
  .atlas-dash .stack {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .atlas-dash .agent-select {
    height: 28px;
    border-radius: 8px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-2);
    color: var(--color-text);
    font-size: 12px;
    padding: 4px 8px;
    outline: none;
  }
  .atlas-dash .agent-select:focus {
    border-color: color-mix(in srgb, var(--color-text) 50%, transparent);
  }
  .atlas-dash .mini-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-text) 8%, transparent);
    border: 1px solid var(--color-border);
    color: var(--color-text-muted);
    font-size: 11px;
  }
  .atlas-dash .agent-meta {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px 12px;
    padding: 12px 14px;
    border-top: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-surface-2) 40%, transparent);
  }
  .atlas-dash .mini-label {
    font-size: 10px;
    letter-spacing: 0.12em;
    color: var(--color-text-dim);
    text-transform: uppercase;
  }
  .atlas-dash .mini-value {
    font-size: 12px;
    color: var(--color-text);
    margin-top: 3px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .atlas-dash .signal-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .atlas-dash .signal-row {
    padding: 10px 14px;
    border-bottom: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .atlas-dash .signal-row:last-child { border-bottom: none; }
  .atlas-dash .signal-main {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .atlas-dash .signal-message {
    font-size: 12px;
    color: var(--color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }
  .atlas-dash .signal-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 11px;
    color: var(--color-text-muted);
  }
  .atlas-dash .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-surface-2) 60%, transparent);
    color: var(--color-text-dim);
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .atlas-dash .pill.ok { color: #34d399; border-color: color-mix(in srgb, #34d399 40%, var(--color-border)); }
  .atlas-dash .pill.warn { color: #fbbf24; border-color: color-mix(in srgb, #fbbf24 40%, var(--color-border)); }
  .atlas-dash .pill.err { color: #f87171; border-color: color-mix(in srgb, #f87171 40%, var(--color-border)); }

  .atlas-dash .metric-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 16px;
    padding: 16px;
  }
  .atlas-dash .info-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
    padding: 10px 14px;
    border-top: 1px solid var(--color-border);
  }
  .atlas-dash .net-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 10px;
    padding: 10px 14px;
    border-top: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-surface-2) 30%, transparent);
  }
  .atlas-dash .net-block {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .atlas-dash .net-value {
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text);
  }

  .atlas-dash .agent-title {
    padding: 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .atlas-dash .agent-name {
    font-size: 16px;
    font-weight: 600;
    color: var(--color-text);
  }
  .atlas-dash .agent-sub {
    padding: 0 14px 12px;
    font-size: 11px;
    color: var(--color-text-muted);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .atlas-dash .tags-row {
    padding: 0 14px 12px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .atlas-dash .agent-footer {
    padding: 10px 14px 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    border-top: 1px solid var(--color-border);
  }
  .atlas-dash .link-ghost {
    font-size: 11px;
    color: var(--color-text-muted);
    text-decoration: none;
  }
  .atlas-dash .link-ghost:hover { color: var(--color-text); }

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

  @keyframes atlas-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  .atlas-spin { animation: atlas-spin 0.6s linear; }

  @media (max-width: 1280px) {
    .atlas-dash {
      overflow: auto;
      height: auto;
      min-height: 100%;
    }
    .atlas-dash .main-grid {
      grid-template-columns: repeat(8, minmax(0, 1fr));
      grid-template-rows: repeat(2, minmax(320px, auto));
      grid-template-areas:
        "agent agent agent agent metrics metrics metrics metrics"
        "health health signals signals signals signals account account";
    }
    .atlas-dash .tile-agent,
    .atlas-dash .tile-metrics,
    .atlas-dash .tile-health,
    .atlas-dash .tile-signals,
    .atlas-dash .tile-account {
      height: auto;
    }
    .atlas-dash .panel { height: auto; }
    .atlas-dash .panel-body { overflow-y: visible; }
  }
  @media (max-width: 900px) {
    .atlas-dash .stat-grid { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
    .atlas-dash .main-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      grid-template-rows: repeat(5, auto);
      grid-template-areas:
        "agent agent agent agent"
        "metrics metrics metrics metrics"
        "health health health health"
        "signals signals signals signals"
        "account account account account";
    }
  }
`

// ─── Arc gauge ────────────────────────────────────────────────────────────────

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
  const R = 48
  const cx = 56
  const cy = 56
  const stroke = 7
  const circumference = Math.PI * R // half-circle arc
  const progress = Math.min(1, Math.max(0, value / 100))
  const dashOffset = circumference * (1 - progress)

  // Color based on threshold
  const color = value >= 85 ? '#f87171' : value >= 65 ? '#fbbf24' : '#34d399'
  const trackColor = 'var(--color-border)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <div style={{ position: 'relative', width: 120, height: 66 }}>
        <svg width="120" height="66" viewBox="0 0 120 76" style={{ overflow: 'visible' }}>
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
          <span style={{ fontSize: 20, fontWeight: 600, color, fontFamily: "'JetBrains Mono', monospace" }}>
            {Math.round(value)}
          </span>
          <span style={{ fontSize: 11, color: 'var(--color-text-dim)', marginLeft: 2 }}>%</span>
        </div>
      </div>

      {/* Sparkline */}
      {history && history.length > 1 && (
        <div style={{ opacity: 0.7 }}>
          <Sparkline values={history} color={color} width={120} height={26} />
        </div>
      )}

      {/* Label */}
      <span style={{ fontSize: 11, color: 'var(--color-text-dim)', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
        {label}
      </span>
      {detail && (
        <span style={{ fontSize: 11, color: 'var(--color-text)', marginTop: -2 }}>
          {detail}
        </span>
      )}
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

// ─── Stat card ────────────────────────────────────────────────────────────────

const StatCard = memo(function StatCard({
  label,
  value,
  hint,
  accent,
  badge,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  accent?: string
  badge?: ReactNode
}) {
  return (
    <div className="stat-card">
      <div className="stat-label">
        {label}
        {badge && <span className="stat-badge">{badge}</span>}
      </div>
      <div className="stat-value" style={accent ? { color: accent } : undefined}>{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  )
})

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
  const gpu     = latest.gpu?.data     as unknown as GpuData     | undefined
  const gpuHistory = useMemo(() => history.gpu, [history.gpu])
  const hasGpuMetric = Boolean(latest.gpu)
  const hasGpuDevices = Boolean(gpu && gpu.gpus && gpu.gpus.length > 0)
  const showGpuGauge = hasGpuMetric

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

  const netRxHistory = useMemo(() => history.netRx.map((v) => Math.max(0, v) / 1024), [history.netRx])
  const netTxHistory = useMemo(() => history.netTx.map((v) => Math.max(0, v) / 1024), [history.netTx])

  if (!agentId) {
    return (
      <div className="panel" style={{ flex: 1 }}>
        <div className="panel-header">
          <span className="panel-label">Metrics</span>
        </div>
        <div className="panel-body" style={{ padding: '36px 0' }}>
          <EmptyState message="Select an agent to view metrics" />
        </div>
      </div>
    )
  }

  return (
    <div className="panel" style={{ flex: 1 }}>
      {/* Header */}
      <div className="panel-header">
        <span className="panel-label">Live Metrics</span>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-muted)' }}>
          {hostname ?? '—'}
        </span>
      </div>

      <div className="panel-body">
        {/* Arc gauges */}
        {(cpu || ram || osDisk || showGpuGauge) ? (
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
            {showGpuGauge && (
              <ArcGauge
                label="GPU"
                value={gpu?.summary?.avg_utilization_pct ?? 0}
                detail={hasGpuDevices
                  ? `${gpu?.gpus.length ?? 0} GPU${(gpu?.gpus.length ?? 0) > 1 ? 's' : ''} · ${Math.round(gpu?.summary?.avg_mem_utilization_pct ?? 0)}% mem`
                  : gpu?.collector_disabled
                    ? 'Collector disabled'
                    : 'No GPUs detected'}
                history={gpuHistory}
              />
            )}
          </div>
        ) : (
          <div style={{ padding: '24px 0' }}>
            <EmptyState message="Waiting for metrics..." />
          </div>
        )}

        {/* GPU availability note */}
        {agentId && !showGpuGauge && gpuHistory.length === 0 && (
          <div className="info-row">
            <div className="mini-chip" style={{ width: '100%' }}>
              GPU metrics not received yet via live feed. Ensure GPU collector is enabled and WebSocket is connected.
            </div>
          </div>
        )}

        {/* Network */}
        {primaryInterface && (
          <div className="net-row">
            <div className="net-block">
              <span className="mini-label">{primaryInterface.name} RX</span>
              <span className="net-value">{formatBandwidth(primaryInterface.rx_bytes_rate)}</span>
              {netRxHistory.length > 1 && (
                <Sparkline values={netRxHistory} color="#34d399" width={130} height={26} />
              )}
            </div>
            <div className="net-block">
              <span className="mini-label">{primaryInterface.name} TX</span>
              <span className="net-value">{formatBandwidth(primaryInterface.tx_bytes_rate)}</span>
              {netTxHistory.length > 1 && (
                <Sparkline values={netTxHistory} color="#60a5fa" width={130} height={26} />
              )}
            </div>
          </div>
        )}

        {/* GPUs */}
        {hasGpuDevices && gpu && (
          <div className="info-row" style={{ rowGap: 10 }}>
            {gpu.gpus.map((g) => {
              const memTotal = g.memory_total_mb * 1024 * 1024
              const memUsed = g.memory_used_mb * 1024 * 1024
              return (
                <div key={g.uuid} className="mini-chip" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4, width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 8 }}>
                    <span style={{ color: 'var(--color-text)' }}>{g.name || `GPU ${g.index}`}</span>
                    <span style={{ fontSize: 10, color: 'var(--color-text-dim)' }}>{g.utilization_pct.toFixed(0)}%</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                    <span>Mem {Math.round(g.memory_utilization_pct)}%</span>
                    <span>{formatBytes(memUsed)} / {formatBytes(memTotal)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* CPU load averages */}
        {cpu && (
          <div className="info-row">
            <InfoCell label="Load 1m"  value={cpu.load_avg_1m.toFixed(2)}  />
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
    </div>
  )
})

// ─── Dashboard ────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const qc = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const { user, isAdmin, isModerator, isViewer, isGuest, canAccessAgent } = useAuthStore()
  const { selectedAgentId, selectAgent, wsConnected } = useUiStore()
  const { data: health }                           = useFleetHealth()
  const { data: agents, isLoading: agentsLoading } = useAgents()
  const { data: logsData, isLoading: logsLoading } = useLogs({ limit: 40 })

  const { data: usersData } = useQuery({
    queryKey: ['dashboard', 'users', isAdmin],
    queryFn: usersApi.list,
    enabled: isAdmin,
    staleTime: 60_000,
  })

  const { data: configData } = useQuery({
    queryKey: ['dashboard', 'config', isAdmin],
    queryFn: configApi.list,
    enabled: isAdmin,
    staleTime: 60_000,
  })

  const accessibleAgents = useMemo(() => agents?.filter((a) => canAccessAgent(a.agent_id)) ?? [], [agents, canAccessAgent])

  // Reset selection if persisted agent is not in the current list
  useEffect(() => {
    if (!accessibleAgents) return
    if (!accessibleAgents.length && selectedAgentId) {
      selectAgent(null)
      return
    }
    const exists = accessibleAgents.some((a) => a.agent_id === selectedAgentId)
    if (!exists) {
      selectAgent(accessibleAgents[0]?.agent_id ?? null)
    }
  }, [accessibleAgents, selectedAgentId, selectAgent])

  // Stable active agent ID — don't derive inline so it doesn't thrash on each render
  const activeAgentId = useMemo(
    () => selectedAgentId ?? accessibleAgents?.[0]?.agent_id ?? null,
    [selectedAgentId, accessibleAgents],
  )

  const activeAgent = useMemo(
    () => accessibleAgents?.find((a) => a.agent_id === activeAgentId),
    [accessibleAgents, activeAgentId],
  )

  const handleSelectAgent = useCallback(
    (id: string) => selectAgent(id),
    [selectAgent],
  )

  const cycleAgent = useCallback((direction: 1 | -1) => {
    if (!accessibleAgents?.length) return
    const idx = accessibleAgents.findIndex((a) => a.agent_id === activeAgentId)
    const nextIdx = idx === -1 ? 0 : (idx + direction + accessibleAgents.length) % accessibleAgents.length
    selectAgent(accessibleAgents[nextIdx].agent_id)
  }, [accessibleAgents, activeAgentId, selectAgent])

  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    qc.invalidateQueries({ queryKey: queryKeys.fleetHealth() })
    qc.invalidateQueries({ queryKey: queryKeys.agents() })
    qc.invalidateQueries({ queryKey: queryKeys.logs({ limit: 40 }) })
    if (activeAgentId) {
      qc.invalidateQueries({ queryKey: queryKeys.telemetryLatest(activeAgentId) })
    }
    if (isAdmin) {
      qc.invalidateQueries({ queryKey: ['dashboard', 'users', isAdmin] })
      qc.invalidateQueries({ queryKey: ['dashboard', 'config', isAdmin] })
    }
    setTimeout(() => setRefreshing(false), 800)
  }, [qc, activeAgentId, isAdmin])

  // Stable fleet numbers — only update when values actually change
  const fleetTotal    = health?.agents.total    ?? 0
  const fleetOnline   = health?.agents.online   ?? 0
  const fleetDegraded = health?.agents.degraded ?? 0
  const fleetOffline  = health?.agents.offline  ?? 0

  const logs = logsData ?? []
  const logCounts = useMemo(() => logs.reduce<Record<string, number>>((acc, log) => {
    acc[log.severity] = (acc[log.severity] ?? 0) + 1
    return acc
  }, {}), [logs])

  const errorCount = (logCounts.Error ?? 0) + (logCounts.Critical ?? 0)
  const warningCount = logCounts.Warning ?? 0
  const infoCount = logCounts.Info ?? 0

  const importantLogs = logs.filter((log) => log.severity !== 'Trace' && log.severity !== 'Debug')
  const recentLogs: LogEntry[] = (importantLogs.length ? importantLogs : logs).slice(0, 4)

  const snapshot = (health?.latest_snapshot ?? {}) as Record<string, unknown>
  const metricsRate = typeof snapshot.metrics_rate === 'number' ? snapshot.metrics_rate : null
  const logsRateVal = typeof snapshot.logs_rate === 'number' ? snapshot.logs_rate : null
  const dbSize = typeof snapshot.db_size_bytes === 'number' ? formatBytes(snapshot.db_size_bytes) : null
  const snapshotTs = typeof snapshot.timestamp === 'string' ? snapshot.timestamp : null

  const staleCount = useMemo(() => accessibleAgents?.filter((a) => a.is_stale).length ?? 0, [accessibleAgents])

  const accessibleCount = accessibleAgents.length
  const roleLabel = isAdmin ? 'Administration Dashboard' : isModerator ? 'Operations Dashboard' : isGuest ? 'Guest Monitoring Dashboard' : 'Monitoring Dashboard'

  if (isGuest) {
    const expiresAt = user?.expiresAt ?? null
    return (
      <div className="space-y-4">
        <PageHeader title={roleLabel} subtitle={`Accessible agents: ${accessibleCount}`} />
        <Card>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm font-mono text-[--color-text]">
            <div className="rounded border border-[--color-border] bg-[--color-surface-2] p-3">
              <p className="text-[10px] uppercase tracking-[0.12em] text-[--color-text-dim] mb-1">Accessible Agents</p>
              <p className="text-lg font-semibold">{accessibleCount}</p>
            </div>
            <div className="rounded border border-[--color-border] bg-[--color-surface-2] p-3">
              <p className="text-[10px] uppercase tracking-[0.12em] text-[--color-text-dim] mb-1">Organizations</p>
              <p className="text-lg font-semibold">{user?.accessScope.organization_ids.length ?? 0}</p>
            </div>
            <div className="rounded border border-[--color-border] bg-[--color-surface-2] p-3">
              <p className="text-[10px] uppercase tracking-[0.12em] text-[--color-text-dim] mb-1">Access mode</p>
              <p className="text-lg font-semibold">Read-only</p>
            </div>
          </div>
          {expiresAt && (
            <div className="mt-4 text-xs font-mono text-[--color-text-muted]">
              <p>Guest access expires: <span className="text-[--color-text]">{formatTimestamp(expiresAt)}</span></p>
            </div>
          )}
          <div className="mt-4 text-xs font-mono text-[--color-text-muted]">You can view assigned agents and organizations. Administration, audit, and controls are hidden for guest access.</div>
        </Card>
      </div>
    )
  }

  return (
    <div
      className="atlas-dash"
      style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', color: 'var(--color-text)' }}
    >
      <style>{CSS}</style>

      <PageHeader
        title="Dashboard"
        subtitle={user ? `Welcome, ${user.username}` : undefined}
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

      {/* ── Quick stats ─────────────────────────────────────────────────── */}
      <div className="stat-grid">
        <StatCard
          label="Fleet"
          value={`${fleetOnline}/${fleetTotal}`}
          hint={`${fleetDegraded} degraded · ${fleetOffline} offline`}
          accent="#34d399"
          badge={`${staleCount} stale`}
        />
        <StatCard
          label="Signals"
          value={errorCount ? `${errorCount} errors` : 'All clear'}
          hint={`${warningCount} warnings · ${infoCount} info`}
          accent={errorCount ? '#f87171' : '#93c5fd'}
        />
        <StatCard
          label="Ingest"
          value={metricsRate !== null ? `${metricsRate.toFixed(1)} metrics/s` : '—'}
          hint={`logs ${logsRateVal !== null ? logsRateVal.toFixed(1) : '—'}/s${dbSize ? ` · db ${dbSize}` : ''}`}
          accent="#a78bfa"
        />
        <StatCard
          label="Agents"
          value={accessibleCount || '—'}
          hint={activeAgent ? `${activeAgent.hostname}` : 'Select an agent to inspect'}
        />
        {isAdmin && (
          <StatCard
            label="Admin"
            value={`${usersData?.length ?? '—'} users`}
            hint={`${configData?.length ?? 0} config keys`}
          />
        )}
      </div>

      {/* ── Main layout ─────────────────────────────────────────────────── */}
      <div className="main-grid">

        {/* Agent focus */}
        <div className="tile-agent">
          <div className="panel" style={{ minHeight: 0 }}>
            <div className="panel-header">
              <span className="panel-label">Agent focus</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <select
                  className="agent-select"
                  value={activeAgentId ?? ''}
                  onChange={(e) => handleSelectAgent(e.target.value)}
                >
                  {(accessibleAgents ?? []).map((agent) => (
                    <option key={agent.agent_id} value={agent.agent_id}>{agent.hostname}</option>
                  ))}
                </select>
                <div className="mini-chip">
                  <button onClick={() => cycleAgent(-1)} disabled={!accessibleAgents?.length} style={{ color: 'inherit' }}>‹</button>
                  <button onClick={() => cycleAgent(1)} disabled={!accessibleAgents?.length} style={{ color: 'inherit' }}>›</button>
                </div>
              </div>
            </div>

            {agentsLoading ? (
              <LoadingState label="Loading agents..." />
            ) : !activeAgent ? (
              <EmptyState message="No agents available for your account" />
            ) : (
              <div className="panel-body">
                <div className="agent-title">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span className="agent-name">{activeAgent.hostname}</span>
                    <span style={{ fontSize: 11, color: 'var(--color-text-dim)' }}>{shortAgentId(activeAgent.agent_id)}</span>
                  </div>
                  <AgentStatusBadge status={activeAgent.status} />
                </div>

                <div className="agent-sub">
                  <span>{timeAgo(activeAgent.last_seen)}</span>
                  {activeAgent.is_stale && <span className="pill warn">stale</span>}
                </div>

                {activeAgent.tags.length > 0 && (
                  <div className="tags-row">
                    {activeAgent.tags.slice(0, 5).map((tag) => (
                      <Tag key={tag}>{tag}</Tag>
                    ))}
                  </div>
                )}

                <div className="agent-meta">
                  <div>
                    <div className="mini-label">OS</div>
                    <div className="mini-value">{activeAgent.os}</div>
                  </div>
                  <div>
                    <div className="mini-label">Architecture</div>
                    <div className="mini-value">{activeAgent.architecture}</div>
                  </div>
                  <div>
                    <div className="mini-label">Version</div>
                    <div className="mini-value">{activeAgent.version}</div>
                  </div>
                  <div>
                    <div className="mini-label">Status</div>
                    <div className="mini-value">{activeAgent.is_active ? 'Active' : 'Disabled'}</div>
                  </div>
                </div>

                <div className="agent-footer">
                  <a className="link-ghost" href="/agents">Open agents page →</a>
                  <span className="mini-label">{activeAgent.hostname}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Metrics */}
        <div className="tile-metrics">
          <MetricPanel
            agentId={activeAgentId}
            hostname={activeAgent?.hostname}
          />
        </div>

        {/* Health snapshot */}
        <div className="tile-health">
          <div className="panel">
            <div className="panel-header">
              <span className="panel-label">Health snapshot</span>
              <span className="pill ok">{health?.server_status ?? '—'}</span>
            </div>
            <div className="panel-body">
              <div className="info-row">
                <InfoCell label="Online" value={String(fleetOnline)} />
                <InfoCell label="Offline" value={String(fleetOffline)} />
              </div>
              <div className="info-row">
                <InfoCell label="Metrics/s" value={metricsRate !== null ? metricsRate.toFixed(1) : '—'} />
                <InfoCell label="Logs/s" value={logsRateVal !== null ? logsRateVal.toFixed(1) : '—'} />
              </div>
              <div className="info-row">
                <InfoCell label="DB size" value={dbSize ?? '—'} />
                <InfoCell label="Snapshot" value={snapshotTs ? timeAgo(snapshotTs) : '—'} />
              </div>
            </div>
          </div>
        </div>

        {/* Logs */}
        <div className="tile-signals">
          <div className="panel">
            <div className="panel-header">
              <span className="panel-label">Signals</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 11, color: 'var(--color-text-muted)' }}>
                <span>{errorCount} errors</span>
                <span>·</span>
                <span>{warningCount} warnings</span>
              </div>
            </div>
            <div className="panel-body">
              {logsLoading ? (
                <LoadingState label="Loading logs..." />
              ) : !recentLogs.length ? (
                <EmptyState message="No recent logs" />
              ) : (
                <ul className="signal-list">
                  {recentLogs.map((log) => (
                    <li key={log.id} className="signal-row">
                      <div className="signal-main">
                        <SeverityBadge severity={log.severity} />
                        <span className="signal-message" title={log.message}>{log.message}</span>
                      </div>
                      <div className="signal-meta">
                        <span className="pill">{LOG_SOURCE_LABEL[log.source] ?? log.source}</span>
                        <span>{timeAgo(log.timestamp)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Account */}
        <div className="tile-account">
          <div className="panel">
            <div className="panel-header">
              <span className="panel-label">Account</span>
              {isAdmin && <span className="panel-aux">Admin tools</span>}
            </div>
            <div className="panel-body">
              <div className="info-row">
                <InfoCell label="Role" value={user?.role ?? '—'} />
                <InfoCell label="Agents" value={`${fleetTotal} total`} />
              </div>
              <div className="info-row">
                <InfoCell label="Live mode" value={wsConnected ? 'WebSocket' : 'Polling'} />
                <InfoCell label="Snapshot" value={snapshotTs ? timeAgo(snapshotTs) : '—'} />
              </div>
              {isAdmin && (
                <div className="info-row">
                  <InfoCell label="Users" value={`${usersData?.length ?? '—'}`} />
                  <InfoCell label="Config keys" value={`${configData?.length ?? 0}`} />
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
