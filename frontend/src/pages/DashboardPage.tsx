import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import { useFleetHealth, useAgents, useLatestMetrics, useLiveMetrics, useLiveLogs } from '@/hooks'
import { PageHeader } from '@/components/layout/AppLayout'
import {
  Card,
  AgentStatusBadge,
  GaugeBar,
  Sparkline,
  SeverityBadge,
  LoadingState,
  EmptyState,
  Tag,
} from '@/components/common'
import { formatBytes, formatBandwidth, formatUptime, timeAgo, shortAgentId, gaugeColor } from '@/utils'
import type { Agent, CpuData, RamData, StorageData, NetworkData, KernelData } from '@/types'

export function DashboardPage() {
  const { user } = useAuthStore()
  const { selectedAgentId, selectAgent, wsConnected } = useUiStore()
  const { data: health } = useFleetHealth()
  const { data: agents, isLoading: agentsLoading } = useAgents()

  const activeAgentId = selectedAgentId ?? agents?.[0]?.agent_id ?? null

  const { data: latestMetrics } = useLatestMetrics(activeAgentId)
  const { history } = useLiveMetrics(activeAgentId)
  const { logs } = useLiveLogs(activeAgentId)

  const cpu = latestMetrics?.cpu?.data as CpuData | undefined
  const ram = latestMetrics?.ram?.data as RamData | undefined
  const storage = latestMetrics?.storage?.data as StorageData | undefined
  const network = latestMetrics?.network?.data as NetworkData | undefined
  const kernel = latestMetrics?.kernel?.data as KernelData | undefined

  const rootDisk = storage?.filesystems.find((f) => f.mount_point === '/') ?? storage?.filesystems[0]
  const primaryInterface = network?.interfaces.find((i) => i.name !== 'lo') ?? network?.interfaces[0]

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={user ? `Signed in as ${user.username}` : undefined}
        actions={
          <div className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${wsConnected ? 'bg-green-500 animate-pulse' : 'bg-[--color-text-dim]'}`} />
            <span className="text-xs font-mono text-[--color-text-muted]">{wsConnected ? 'live' : 'polling'}</span>
          </div>
        }
      />

      {/* Fleet summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <FleetStat label="Total" value={health?.agents.total ?? '--'} />
        <FleetStat label="Online" value={health?.agents.online ?? '--'} color="text-green-400" />
        <FleetStat label="Degraded" value={health?.agents.degraded ?? '--'} color={health?.agents.degraded ? 'text-yellow-400' : undefined} />
        <FleetStat label="Offline" value={health?.agents.offline ?? '--'} color={health?.agents.offline ? 'text-red-400' : undefined} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Agent list */}
        <div className="lg:col-span-1">
          <Card padding={false}>
            <div className="px-3 pt-3 pb-2 border-b border-[--color-border]">
              <p className="text-xs font-mono text-[--color-text-muted] uppercase tracking-wide">Agents</p>
            </div>
            {agentsLoading ? (
              <LoadingState />
            ) : !agents?.length ? (
              <EmptyState message="No agents registered" />
            ) : (
              <ul className="divide-y divide-[--color-border]">
                {agents.map((agent) => (
                  <AgentRow
                    key={agent.agent_id}
                    agent={agent}
                    selected={agent.agent_id === activeAgentId}
                    onClick={() => selectAgent(agent.agent_id)}
                  />
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Metrics + logs */}
        <div className="lg:col-span-2 space-y-4">
          {/* Live metrics */}
          <Card>
            <p className="text-xs font-mono text-[--color-text-muted] uppercase tracking-wide mb-3">
              {agents?.find((a) => a.agent_id === activeAgentId)?.hostname ?? 'Select an agent'}
            </p>

            {!activeAgentId ? (
              <EmptyState message="Select an agent to view metrics" />
            ) : (
              <div className="space-y-3">
                {cpu && (
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <GaugeBar label="CPU" value={cpu.usage_pct} />
                    </div>
                    <Sparkline values={history.cpu} color={gaugeColor(cpu.usage_pct)} width={80} height={24} />
                  </div>
                )}
                {ram && (
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <GaugeBar label="RAM" value={ram.usage_pct} detail={`${formatBytes(ram.used_bytes)} / ${formatBytes(ram.total_bytes)}`} />
                    </div>
                    <Sparkline values={history.ram} color={gaugeColor(ram.usage_pct)} width={80} height={24} />
                  </div>
                )}
                {rootDisk && (
                  <GaugeBar
                    label={`Disk ${rootDisk.mount_point}`}
                    value={rootDisk.usage_pct}
                    detail={`${formatBytes(rootDisk.used_bytes)} / ${formatBytes(rootDisk.total_bytes)}`}
                  />
                )}
                {primaryInterface && (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                      <p className="text-xs text-[--color-text-dim] font-mono mb-0.5">RX</p>
                      <p className="text-xs font-mono text-[--color-text]">{formatBandwidth(primaryInterface.rx_bytes_rate)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[--color-text-dim] font-mono mb-0.5">TX</p>
                      <p className="text-xs font-mono text-[--color-text]">{formatBandwidth(primaryInterface.tx_bytes_rate)}</p>
                    </div>
                  </div>
                )}
                {kernel && (
                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[--color-border]">
                    <div>
                      <p className="text-xs text-[--color-text-dim] font-mono mb-0.5">Uptime</p>
                      <p className="text-xs font-mono text-[--color-text]">{formatUptime(kernel.uptime_secs)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[--color-text-dim] font-mono mb-0.5">Kernel</p>
                      <p className="text-xs font-mono text-[--color-text] truncate" title={kernel.kernel_version}>{kernel.kernel_version}</p>
                    </div>
                  </div>
                )}
                {cpu && (
                  <div className="grid grid-cols-3 gap-2 text-center border-t border-[--color-border] pt-2">
                    <div>
                      <p className="text-xs text-[--color-text-dim] font-mono">load 1m</p>
                      <p className="text-xs font-mono text-[--color-text] tabular-nums">{cpu.load_avg_1m.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[--color-text-dim] font-mono">load 5m</p>
                      <p className="text-xs font-mono text-[--color-text] tabular-nums">{cpu.load_avg_5m.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[--color-text-dim] font-mono">load 15m</p>
                      <p className="text-xs font-mono text-[--color-text] tabular-nums">{cpu.load_avg_15m.toFixed(2)}</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* Live log tail */}
          <Card padding={false}>
            <div className="px-3 pt-3 pb-2 border-b border-[--color-border] flex items-center justify-between">
              <p className="text-xs font-mono text-[--color-text-muted] uppercase tracking-wide">Live Logs</p>
              <span className="text-xs text-[--color-text-dim] font-mono">{logs.length} entries</span>
            </div>
            <div className="h-48 overflow-y-auto">
              {logs.length === 0 ? (
                <EmptyState message={activeAgentId ? 'Waiting for log entries...' : 'Select an agent'} />
              ) : (
                <div>
                  {logs.map((log) => (
                    <div
                      key={log.id}
                      className="flex items-start gap-2 px-3 py-1 border-b border-[--color-border] last:border-0 hover:bg-[--color-surface-2]"
                    >
                      <SeverityBadge severity={log.severity} />
                      <span className="text-xs font-mono text-[--color-text-muted] shrink-0 tabular-nums">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                      <span className="text-xs font-mono text-[--color-text] break-all line-clamp-1">{log.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

function FleetStat({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <Card>
      <p className="text-xs text-[--color-text-muted] font-mono uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-2xl font-mono font-semibold tabular-nums ${color ?? 'text-[--color-text]'}`}>{value}</p>
    </Card>
  )
}

function AgentRow({ agent, selected, onClick }: { agent: Agent; selected: boolean; onClick: () => void }) {
  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full text-left px-3 py-2.5 hover:bg-[--color-surface-2] transition-colors ${selected ? 'bg-[--color-surface-2] border-l-2 border-blue-500' : ''}`}
      >
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-xs font-mono text-[--color-text] truncate">{agent.hostname}</span>
          <AgentStatusBadge status={agent.status} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[--color-text-dim] font-mono">{shortAgentId(agent.agent_id)}</span>
          {agent.is_stale && (
            <span className="text-xs text-yellow-500 font-mono">stale</span>
          )}
        </div>
        {agent.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {agent.tags.slice(0, 3).map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </div>
        )}
        <p className="text-xs text-[--color-text-dim] font-mono mt-1">{timeAgo(agent.last_seen)}</p>
      </button>
    </li>
  )
}
