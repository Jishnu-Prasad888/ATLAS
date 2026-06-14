import { Card, SectionHeader, GaugeBar, Tag } from '@/components/common'
import { formatBytes } from '@/utils'
import type { DockerData, DockerContainer, DockerResourceTotals } from '@/types'

function ContainerRow({ c }: { c: DockerContainer }) {
  const stateColor: Record<string, string> = {
    running: 'text-green-400',
    exited: 'text-[--color-text-dim]',
    paused: 'text-yellow-400',
    restarting: 'text-orange-400',
    created: 'text-blue-400',
    dead: 'text-red-400',
    removing: 'text-red-400',
  }

  return (
    <tr className="border-b border-[--color-border] hover:bg-[--color-surface-2] transition-colors">
      <td className="py-1.5 pr-2">
        <span className="font-mono text-xs text-[--color-text] truncate block max-w-[120px]" title={c.name}>
          {c.name.replace(/^\//, '')}
        </span>
      </td>
      <td className="py-1.5 pr-2">
        <span className={`text-xs font-mono ${stateColor[c.state] ?? 'text-[--color-text-dim]'}`}>{c.state}</span>
      </td>
      <td className="py-1.5 pr-2 text-right">
        <span className="text-xs font-mono text-[--color-text] tabular-nums">
          {c.cpu_percent != null ? `${c.cpu_percent.toFixed(1)}%` : '--'}
        </span>
      </td>
      <td className="py-1.5 pr-2 text-right">
        <span className="text-xs font-mono text-[--color-text] tabular-nums">
          {c.memory_usage_bytes != null ? formatBytes(c.memory_usage_bytes) : '--'}
        </span>
      </td>
      <td className="py-1.5 pr-2 text-right">
        <span className="text-xs font-mono text-[--color-text] tabular-nums">
          {c.memory_percent != null ? `${c.memory_percent.toFixed(1)}%` : '--'}
        </span>
      </td>
      <td className="py-1.5 pr-2 text-right">
        <span className="text-xs font-mono text-[--color-text] tabular-nums">
          {c.network_rx_bytes != null ? formatBytes(c.network_rx_bytes) : '--'}
        </span>
      </td>
      <td className="py-1.5 text-right">
        <span className="text-xs font-mono text-[--color-text] tabular-nums">
          {c.block_read_bytes != null ? formatBytes(c.block_read_bytes) : '--'}
        </span>
      </td>
    </tr>
  )
}

function StateBadges({ state_counts }: { state_counts: Record<string, number> }) {
  const stateStyles: Record<string, string> = {
    running: 'bg-green-950/40 border-green-900 text-green-400',
    exited: 'bg-gray-950/40 border-gray-700 text-gray-400',
    paused: 'bg-yellow-950/40 border-yellow-900 text-yellow-400',
    restarting: 'bg-orange-950/40 border-orange-900 text-orange-400',
    created: 'bg-blue-950/40 border-blue-900 text-blue-400',
    dead: 'bg-red-950/40 border-red-900 text-red-400',
    removing: 'bg-red-950/40 border-red-900 text-red-400',
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {Object.entries(state_counts).map(([state, count]) => (
        <span key={state} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono border ${stateStyles[state] ?? 'bg-[--color-surface-2] border-[--color-border] text-[--color-text-muted]'}`}>
          {count} {state}
        </span>
      ))}
    </div>
  )
}

function ResourceTotalsSection({ rt }: { rt: DockerResourceTotals }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-[--color-text-muted] font-mono">
        {rt.containers_reporting} container{rt.containers_reporting !== 1 ? 's' : ''} reporting
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div>
          <GaugeBar label="CPU Avg" value={rt.cpu_percent_avg} />
        </div>
        <div>
          <GaugeBar label="Memory Avg" value={rt.memory_percent_avg} />
        </div>
        <div className="text-xs font-mono text-[--color-text] tabular-nums space-y-1">
          <p><span className="text-[--color-text-muted]">Memory: </span>{formatBytes(rt.memory_usage_bytes_sum)} / {formatBytes(rt.memory_limit_bytes_sum)}</p>
          <p><span className="text-[--color-text-muted]">Network RX: </span>{formatBytes(rt.network_rx_bytes_sum)}</p>
          <p><span className="text-[--color-text-muted]">Network TX: </span>{formatBytes(rt.network_tx_bytes_sum)}</p>
          <p><span className="text-[--color-text-muted]">Block Read: </span>{formatBytes(rt.block_read_bytes_sum)}</p>
          <p><span className="text-[--color-text-muted]">Block Write: </span>{formatBytes(rt.block_write_bytes_sum)}</p>
          <p><span className="text-[--color-text-muted]">PIDs: </span>{rt.pids_sum}</p>
        </div>
      </div>
    </div>
  )
}

export function DockerMetricsCard({ data, loading }: { data: DockerData | null; loading: boolean }) {
  if (loading) return null
  if (!data || data.collector_disabled) return null

  const hasResources = data.resource_totals && data.resource_totals.containers_reporting > 0
  const containers = data.containers ?? []

  return (
    <Card>
      <SectionHeader
        title="Docker"
        description={`${data.total_containers} container${data.total_containers !== 1 ? 's' : ''}`}
        action={<StateBadges state_counts={data.state_counts} />}
      />

      {hasResources && data.resource_totals && (
        <div className="mb-4 pb-4 border-b border-[--color-border]">
          <ResourceTotalsSection rt={data.resource_totals!} />
        </div>
      )}

      {containers.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b border-[--color-border]">
                <th className="text-left py-1.5 pr-2 text-[--color-text-muted] font-normal">Name</th>
                <th className="text-left py-1.5 pr-2 text-[--color-text-muted] font-normal">State</th>
                <th className="text-right py-1.5 pr-2 text-[--color-text-muted] font-normal">CPU</th>
                <th className="text-right py-1.5 pr-2 text-[--color-text-muted] font-normal">Mem</th>
                <th className="text-right py-1.5 pr-2 text-[--color-text-muted] font-normal">Mem%</th>
                <th className="text-right py-1.5 pr-2 text-[--color-text-muted] font-normal">Net</th>
                <th className="text-right py-1.5 text-[--color-text-muted] font-normal">BlkIO</th>
              </tr>
            </thead>
            <tbody>
              {containers.map((c) => (
                <ContainerRow key={c.id} c={c} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-[--color-text-dim] font-mono">No containers</p>
      )}

      {data.images && data.images.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[--color-border]">
          <p className="text-xs text-[--color-text-muted] font-mono mb-2">{data.images.length} image{data.images.length !== 1 ? 's' : ''}</p>
          <div className="flex flex-wrap gap-1">
            {data.images.map((img, i) => (
              <Tag key={i}>{img.repository}:{img.tag}</Tag>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
