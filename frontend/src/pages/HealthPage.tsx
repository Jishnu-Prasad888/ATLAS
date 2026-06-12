import { useState } from 'react'
import { useFleetHealth, useAgents, useAgentHealth } from '@/hooks'
import { PageHeader } from '@/components/layout/AppLayout'
import {
  Card,
  AgentStatusBadge,
  CollectorStatusBadge,
  LoadingState,
  EmptyState,
  ErrorState,
  KvRow,
  SectionHeader,
} from '@/components/common'
import { timeAgo, formatTimestamp, formatBytes } from '@/utils'

export function HealthPage() {
  const { data: health, isLoading: healthLoading, error: healthError, refetch } = useFleetHealth()
  const { data: agents } = useAgents()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selectedAgent = agents?.find((a) => a.agent_id === selectedId) ?? null

  return (
    <div>
      <PageHeader title="Health" subtitle="Server and agent health status" />

      {/* Fleet summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Card>
          <p className="text-xs text-[--color-text-muted] font-mono uppercase tracking-wide mb-1">Server</p>
          <p className="text-sm font-mono text-green-400">{health?.server_status ?? '--'}</p>
        </Card>
        <Card>
          <p className="text-xs text-[--color-text-muted] font-mono uppercase tracking-wide mb-1">Online</p>
          <p className="text-2xl font-mono font-semibold text-green-400 tabular-nums">{health?.agents.online ?? '--'}</p>
        </Card>
        <Card>
          <p className="text-xs text-[--color-text-muted] font-mono uppercase tracking-wide mb-1">Degraded</p>
          <p className={`text-2xl font-mono font-semibold tabular-nums ${health?.agents.degraded ? 'text-yellow-400' : 'text-[--color-text-muted]'}`}>
            {health?.agents.degraded ?? '--'}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-[--color-text-muted] font-mono uppercase tracking-wide mb-1">Offline</p>
          <p className={`text-2xl font-mono font-semibold tabular-nums ${health?.agents.offline ? 'text-red-400' : 'text-[--color-text-muted]'}`}>
            {health?.agents.offline ?? '--'}
          </p>
        </Card>
      </div>

      {/* Server snapshot */}
      {health?.latest_snapshot && Object.keys(health.latest_snapshot).length > 0 && (
        <Card className="mb-5">
          <SectionHeader title="Server Snapshot" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
            {typeof health.latest_snapshot.metrics_rate === 'number' && (
              <div>
                <p className="text-[--color-text-dim] mb-0.5">Metrics/s</p>
                <p className="text-[--color-text] tabular-nums">{(health.latest_snapshot.metrics_rate as number).toFixed(1)}</p>
              </div>
            )}
            {typeof health.latest_snapshot.logs_rate === 'number' && (
              <div>
                <p className="text-[--color-text-dim] mb-0.5">Logs/s</p>
                <p className="text-[--color-text] tabular-nums">{(health.latest_snapshot.logs_rate as number).toFixed(1)}</p>
              </div>
            )}
            {typeof health.latest_snapshot.db_size_bytes === 'number' && (
              <div>
                <p className="text-[--color-text-dim] mb-0.5">DB Size</p>
                <p className="text-[--color-text]">{formatBytes(health.latest_snapshot.db_size_bytes as number)}</p>
              </div>
            )}
            {typeof health.latest_snapshot.timestamp === 'string' && (
              <div>
                <p className="text-[--color-text-dim] mb-0.5">Snapshot</p>
                <p className="text-[--color-text]">{timeAgo(health.latest_snapshot.timestamp as string)}</p>
              </div>
            )}
          </div>
        </Card>
      )}

      <div className="flex gap-4 flex-col lg:flex-row">
        {/* Agent list */}
        <div className="lg:w-72 shrink-0">
          <Card padding={false}>
            <div className="px-3 py-2 border-b border-[--color-border]">
              <p className="text-xs font-mono text-[--color-text-muted] uppercase tracking-wide">Agents</p>
            </div>
            {!agents?.length ? (
              <EmptyState message="No agents" />
            ) : (
              <ul className="divide-y divide-[--color-border]">
                {agents.map((agent) => (
                  <li key={agent.agent_id}>
                    <button
                      onClick={() => setSelectedId(agent.agent_id)}
                      className={`w-full text-left px-3 py-2.5 hover:bg-[--color-surface-2] transition-colors ${selectedId === agent.agent_id ? 'bg-[--color-surface-2] border-l-2 border-blue-500' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="text-xs font-mono text-[--color-text] truncate">{agent.hostname}</span>
                        <AgentStatusBadge status={agent.status} />
                      </div>
                      <p className="text-xs font-mono text-[--color-text-dim]">{timeAgo(agent.last_seen)}</p>
                      {agent.is_stale && (
                        <p className="text-xs text-yellow-500 font-mono">stale</p>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Agent detail */}
        <div className="flex-1 min-w-0">
          {selectedAgent ? (
            <AgentHealthDetail agentId={selectedAgent.agent_id} hostname={selectedAgent.hostname} />
          ) : (
            <EmptyState message="Select an agent to view collector health" />
          )}
        </div>
      </div>
    </div>
  )
}

function AgentHealthDetail({ agentId, hostname }: { agentId: string; hostname: string }) {
  const { data: health, isLoading, error, refetch } = useAgentHealth(agentId)

  if (isLoading) return <LoadingState />
  if (error) return <ErrorState error="Failed to load agent health" onRetry={refetch} />
  if (!health) return null

  const collectorEntries = Object.entries(health.collectors)

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-mono font-medium text-[--color-text]">{hostname}</h2>
          <AgentStatusBadge status={health.status} />
        </div>
        <KvRow label="Last seen" value={timeAgo(health.last_seen)} />
        <KvRow label="Stale" value={health.is_stale ? 'Yes' : 'No'} />
      </Card>

      <Card>
        <SectionHeader title="Collector Health" />
        {collectorEntries.length === 0 ? (
          <EmptyState message="No collector data" detail="Agent has not reported yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-[--color-border]">
                  {['Collector', 'Status', 'Last Run', 'Last Success', 'Failures'].map((h) => (
                    <th key={h} className="text-left py-2 text-[--color-text-muted] font-normal uppercase tracking-wide pr-4">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[--color-border]">
                {collectorEntries.map(([name, ch]) => (
                  <tr key={name} className="hover:bg-[--color-surface-2]">
                    <td className="py-2 pr-4 capitalize text-[--color-text]">{name}</td>
                    <td className="py-2 pr-4">
                      <CollectorStatusBadge status={ch.status} />
                    </td>
                    <td className="py-2 pr-4 text-[--color-text-muted]">{timeAgo(ch.last_run)}</td>
                    <td className="py-2 pr-4 text-[--color-text-muted]">{timeAgo(ch.last_success)}</td>
                    <td className={`py-2 tabular-nums ${ch.failure_count > 0 ? 'text-red-400' : 'text-[--color-text-dim]'}`}>
                      {ch.failure_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
