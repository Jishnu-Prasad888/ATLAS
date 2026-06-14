import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useFleetHealth, useAgents, useAgentHealth, usePersistedState } from '@/hooks'
import { queryKeys } from '@/hooks/queryKeys'
import { PageHeader } from '@/components/layout/AppLayout'
import {
  Button,
  AgentStatusBadge,
  CollectorStatusBadge,
  LoadingState,
  EmptyState,
  ErrorState,
  KvRow,
} from '@/components/common'
import { timeAgo, formatTimestamp, formatBytes } from '@/utils'

// ─── Vitals Strip ────────────────────────────────────────────────────────────

function VitalStat({
  label,
  value,
  accent,
}: {
  label: string
  value: React.ReactNode
  accent?: 'green' | 'yellow' | 'red' | 'default'
}) {
  const colors = {
    green: 'text-emerald-400',
    yellow: 'text-yellow-400',
    red: 'text-red-400',
    default: 'text-[--color-text]',
  }
  return (
    <div className="flex flex-col gap-0.5 min-w-[80px]">
      <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-[--color-text-dim]">
        {label}
      </span>
      <span
        className={`text-xl font-mono font-semibold tabular-nums leading-tight ${colors[accent ?? 'default']}`}
      >
        {value}
      </span>
    </div>
  )
}

function VitalsDivider() {
  return <div className="w-px self-stretch bg-[--color-border] mx-1 opacity-50" />
}

// ─── Status Pulse ─────────────────────────────────────────────────────────────

function StatusPulse({ status }: { status: string }) {
  if (status === 'online') {
    return (
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
      </span>
    )
  }
  if (status === 'degraded') {
    return <span className="h-2 w-2 rounded-full bg-yellow-400 shrink-0" />
  }
  return <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" />
}

// ─── Section Label ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-[--color-text-dim]">
        {children}
      </span>
      <div className="flex-1 h-px bg-[--color-border] opacity-40" />
    </div>
  )
}

// ─── Agent Row ────────────────────────────────────────────────────────────────

function AgentRow({
  agent,
  selected,
  onClick,
}: {
  agent: { agent_id: string; hostname: string; status: string; last_seen: string; is_stale?: boolean }
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`
        w-full text-left px-3 py-2.5 transition-colors group
        flex items-center gap-3
        ${selected
          ? 'bg-cyan-950/40 border-l-2 border-cyan-400'
          : 'border-l-2 border-transparent hover:bg-[--color-surface-2]'
        }
      `}
    >
      <StatusPulse status={agent.status} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-mono text-[--color-text] truncate leading-tight">
          {agent.hostname}
        </p>
        <p className="text-[10px] font-mono text-[--color-text-dim] mt-0.5 leading-tight">
          {agent.is_stale ? (
            <span className="text-yellow-500">stale · {timeAgo(agent.last_seen)}</span>
          ) : (
            timeAgo(agent.last_seen)
          )}
        </p>
      </div>
    </button>
  )
}

// ─── Snapshot Metric ──────────────────────────────────────────────────────────

function SnapshotMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-[--color-text-dim]">
        {label}
      </span>
      <span className="text-sm font-mono text-[--color-text] tabular-nums">{value}</span>
    </div>
  )
}

// ─── Collector Status Chip ────────────────────────────────────────────────────

function CollectorStatus({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    ok:       { label: 'ok',       cls: 'text-emerald-400 bg-emerald-950/60' },
    error:    { label: 'error',    cls: 'text-red-400 bg-red-950/60' },
    degraded: { label: 'degraded', cls: 'text-yellow-400 bg-yellow-950/60' },
    unknown:  { label: 'unknown',  cls: 'text-[--color-text-dim] bg-[--color-surface-2]' },
  }
  const { label, cls } = map[status] ?? map.unknown
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide ${cls}`}>
      {label}
    </span>
  )
}

// ─── Agent Health Detail ──────────────────────────────────────────────────────

function AgentHealthDetail({ agentId, hostname }: { agentId: string; hostname: string }) {
  const { data: health, isLoading, error, refetch } = useAgentHealth(agentId)

  if (isLoading) return <LoadingState />
  if (error) return <ErrorState error="Failed to load agent health" onRetry={refetch} />
  if (!health) return null

  const collectorEntries = Object.entries(health.collectors)

  return (
    <div className="space-y-4">
      {/* Agent identity card */}
      <div className="rounded-lg border border-[--color-border] bg-[--color-surface] overflow-hidden">
        {/* Header bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[--color-border] bg-[--color-surface-2]/50">
          <div className="flex items-center gap-2.5">
            <StatusPulse status={health.status} />
            <h2 className="text-sm font-mono font-medium text-[--color-text]">{hostname}</h2>
          </div>
          <AgentStatusBadge status={health.status} />
        </div>

        {/* Meta rows */}
        <div className="px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-2">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.1em] text-[--color-text-dim] mb-0.5">
              Last seen
            </p>
            <p className="text-xs font-mono text-[--color-text]">{timeAgo(health.last_seen)}</p>
          </div>
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.1em] text-[--color-text-dim] mb-0.5">
              Stale
            </p>
            <p className={`text-xs font-mono ${health.is_stale ? 'text-yellow-400' : 'text-[--color-text-dim]'}`}>
              {health.is_stale ? 'Yes' : 'No'}
            </p>
          </div>
        </div>
      </div>

      {/* Collector table */}
      <div className="rounded-lg border border-[--color-border] bg-[--color-surface] overflow-hidden">
        <div className="px-4 py-3 border-b border-[--color-border] bg-[--color-surface-2]/50">
          <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-[--color-text-dim]">
            Collectors
          </p>
        </div>

        {collectorEntries.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-xs font-mono text-[--color-text-dim]">No collector data</p>
            <p className="text-[10px] font-mono text-[--color-text-dim] mt-1 opacity-60">
              Agent has not reported yet
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-[--color-border]">
                  {['Collector', 'Status', 'Last run', 'Last success', 'Failures'].map((h) => (
                    <th
                      key={h}
                      className="text-left py-2 px-4 text-[10px] font-mono uppercase tracking-[0.1em] text-[--color-text-dim] font-normal whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {collectorEntries.map(([name, ch], i) => (
                  <tr
                    key={name}
                    className={`
                      border-b border-[--color-border] last:border-0
                      hover:bg-[--color-surface-2]/60 transition-colors
                      ${i % 2 === 0 ? '' : 'bg-white/[0.015]'}
                    `}
                  >
                    <td className="py-2.5 px-4 capitalize text-[--color-text] font-medium">{name}</td>
                    <td className="py-2.5 px-4">
                      <CollectorStatus status={ch.status} />
                    </td>
                    <td className="py-2.5 px-4 text-[--color-text-dim]">{timeAgo(ch.last_run)}</td>
                    <td className="py-2.5 px-4 text-[--color-text-dim]">{timeAgo(ch.last_success)}</td>
                    <td className={`py-2.5 px-4 tabular-nums font-semibold ${ch.failure_count > 0 ? 'text-red-400' : 'text-[--color-text-dim]'}`}>
                      {ch.failure_count > 0 ? ch.failure_count : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Health Page ──────────────────────────────────────────────────────────────

export function HealthPage() {
  const qc = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const { data: health, isLoading: healthLoading, error: healthError, refetch } = useFleetHealth()
  const { data: agents } = useAgents()
  const [selectedId, setSelectedId] = usePersistedState<string | null>('health_agent', null)

  const selectedAgent = agents?.find((a) => a.agent_id === selectedId) ?? null

  const snapshot = health?.latest_snapshot

  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    qc.invalidateQueries({ queryKey: queryKeys.fleetHealth() })
    qc.invalidateQueries({ queryKey: queryKeys.agents() })
    setTimeout(() => setRefreshing(false), 800)
  }, [qc])

  return (
    <div className="space-y-5">
      <style>{`@keyframes health-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <PageHeader
        title="Health"
        subtitle="Server and agent health status"
        actions={
          <Button size="sm" variant="ghost" onClick={handleRefresh}>
            <span
              style={{ display: 'inline-block', animation: refreshing ? 'health-spin 0.6s linear' : 'none' }}
            >⟳</span> Refresh
          </Button>
        }
      />

      {/* ── Vitals strip ─────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-[--color-border] bg-[--color-surface] px-4 py-3 flex flex-wrap items-center gap-x-2 gap-y-3">
        {/* Server status */}
        <div className="flex flex-col gap-0.5 min-w-[72px]">
          <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-[--color-text-dim]">Server</span>
          <span className="text-sm font-mono font-semibold text-emerald-400 flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
            </span>
            {health?.server_status ?? '—'}
          </span>
        </div>

        <VitalsDivider />

        <VitalStat
          label="Online"
          value={health?.agents.online ?? '—'}
          accent="green"
        />
        <VitalStat
          label="Degraded"
          value={health?.agents.degraded ?? '—'}
          accent={health?.agents.degraded ? 'yellow' : 'default'}
        />
        <VitalStat
          label="Offline"
          value={health?.agents.offline ?? '—'}
          accent={health?.agents.offline ? 'red' : 'default'}
        />

        {/* Snapshot metrics — inline on wider viewports */}
        {snapshot && Object.keys(snapshot).length > 0 && (
          <>
            <VitalsDivider />
            {typeof snapshot.metrics_rate === 'number' && (
              <SnapshotMetric
                label="Metrics/s"
                value={(snapshot.metrics_rate as number).toFixed(1)}
              />
            )}
            {typeof snapshot.logs_rate === 'number' && (
              <SnapshotMetric
                label="Logs/s"
                value={(snapshot.logs_rate as number).toFixed(1)}
              />
            )}
            {typeof snapshot.db_size_bytes === 'number' && (
              <SnapshotMetric
                label="DB size"
                value={formatBytes(snapshot.db_size_bytes as number)}
              />
            )}
            {typeof snapshot.timestamp === 'string' && (
              <SnapshotMetric
                label="Snapshot"
                value={timeAgo(snapshot.timestamp as string)}
              />
            )}
          </>
        )}
      </div>

      {/* ── Main split ───────────────────────────────────────────────────── */}
      <div className="flex gap-4 flex-col lg:flex-row items-start">

        {/* Agent sidebar */}
        <div className="lg:w-64 shrink-0 rounded-lg border border-[--color-border] bg-[--color-surface] overflow-hidden w-full">
          <div className="px-3 py-2.5 border-b border-[--color-border] bg-[--color-surface-2]/50">
            <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-[--color-text-dim]">
              Agents
              {agents?.length ? (
                <span className="ml-2 opacity-50">{agents.length}</span>
              ) : null}
            </p>
          </div>

          {!agents?.length ? (
            <div className="px-4 py-6 text-center">
              <p className="text-xs font-mono text-[--color-text-dim]">No agents registered</p>
            </div>
          ) : (
            <ul className="divide-y divide-[--color-border]">
              {agents.map((agent) => (
                <li key={agent.agent_id}>
                  <AgentRow
                    agent={agent}
                    selected={selectedId === agent.agent_id}
                    onClick={() => setSelectedId(agent.agent_id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Detail panel */}
        <div className="flex-1 min-w-0 w-full">
          {selectedAgent ? (
            <AgentHealthDetail
              agentId={selectedAgent.agent_id}
              hostname={selectedAgent.hostname}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-[--color-border] py-16 flex flex-col items-center justify-center gap-2">
              <p className="text-xs font-mono text-[--color-text-dim]">Select an agent</p>
              <p className="text-[10px] font-mono text-[--color-text-dim] opacity-50">
                Collector health and details will appear here
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}