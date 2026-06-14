import { Card, SectionHeader, GaugeBar, Tag } from '@/components/common'
import { formatBytes } from '@/utils'
import type { KubernetesData, KubeNode, KubePod, KubeDeployment, KubePVC, KubeEvent } from '@/types'

function NodeSummary({ nodes }: { nodes: KubeNode[] }) {
  const ready = nodes.filter((n) => n.ready).length
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono border bg-green-950/40 border-green-900 text-green-400">
          {ready} ready
        </span>
        {ready < nodes.length && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono border bg-red-950/40 border-red-900 text-red-400">
            {nodes.length - ready} not ready
          </span>
        )}
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono border bg-[--color-surface-2] border-[--color-border] text-[--color-text-muted]">
          {nodes.length} total
        </span>
      </div>
      {nodes.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b border-[--color-border]">
                <th className="text-left py-1 pr-2 text-[--color-text-muted] font-normal">Name</th>
                <th className="text-left py-1 pr-2 text-[--color-text-muted] font-normal">Ready</th>
                <th className="text-right py-1 pr-2 text-[--color-text-muted] font-normal">CPU</th>
                <th className="text-right py-1 pr-2 text-[--color-text-muted] font-normal">Mem</th>
                <th className="text-right py-1 text-[--color-text-muted] font-normal">Version</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((n) => (
                <tr key={n.name} className="border-b border-[--color-border] hover:bg-[--color-surface-2] transition-colors">
                  <td className="py-1 pr-2 text-[--color-text] truncate max-w-[140px]" title={n.name}>{n.name}</td>
                  <td className="py-1 pr-2">
                    <span className={n.ready ? 'text-green-400' : 'text-red-400'}>{n.ready ? 'Yes' : 'No'}</span>
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums text-[--color-text]">
                    {n.metrics ? `${n.metrics.cpu_percent != null ? n.metrics.cpu_percent.toFixed(1) + '%' : n.metrics.cpu_cores.toFixed(2) + 'c'}` : '--'}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums text-[--color-text]">
                    {n.metrics ? formatBytes(n.metrics.memory_bytes) : '--'}
                  </td>
                  <td className="py-1 text-right text-[--color-text-dim]">{n.kubelet_version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function PodSummary({
  pods,
  crashloopbackoff_pods,
  pod_count,
  running_pods,
  pending_pods,
  failed_pods,
}: {
  pods: KubePod[]
  crashloopbackoff_pods: number
  pod_count: number
  running_pods: number
  pending_pods: number
  failed_pods: number
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono border bg-green-950/40 border-green-900 text-green-400">{running_pods} running</span>
        {pending_pods > 0 && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono border bg-yellow-950/40 border-yellow-900 text-yellow-400">{pending_pods} pending</span>}
        {failed_pods > 0 && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono border bg-red-950/40 border-red-900 text-red-400">{failed_pods} failed</span>}
        {crashloopbackoff_pods > 0 && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono border bg-red-950/40 border-red-900 text-red-400 animate-pulse">{crashloopbackoff_pods} crashloop</span>}
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono border bg-[--color-surface-2] border-[--color-border] text-[--color-text-muted]">{pod_count} total</span>
      </div>
      {pods.length > 0 && (
        <div className="overflow-x-auto max-h-48 overflow-y-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b border-[--color-border]">
                <th className="text-left py-1 pr-2 text-[--color-text-muted] font-normal">Name</th>
                <th className="text-left py-1 pr-2 text-[--color-text-muted] font-normal">NS</th>
                <th className="text-left py-1 pr-2 text-[--color-text-muted] font-normal">Phase</th>
                <th className="text-right py-1 pr-2 text-[--color-text-muted] font-normal">CPU</th>
                <th className="text-right py-1 text-[--color-text-muted] font-normal">Mem</th>
              </tr>
            </thead>
            <tbody>
              {pods.map((p) => (
                <tr key={`${p.namespace}/${p.name}`} className="border-b border-[--color-border] hover:bg-[--color-surface-2] transition-colors">
                  <td className="py-1 pr-2 text-[--color-text] truncate max-w-[120px]" title={p.name}>{p.name}</td>
                  <td className="py-1 pr-2 text-[--color-text-dim]">{p.namespace}</td>
                  <td className="py-1 pr-2">
                    <span className={{
                      Running: 'text-green-400',
                      Pending: 'text-yellow-400',
                      Failed: 'text-red-400',
                      Succeeded: 'text-blue-400',
                      Unknown: 'text-[--color-text-dim]',
                    }[p.phase] ?? 'text-[--color-text-dim]'}>{p.phase}</span>
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums text-[--color-text]">
                    {p.metrics ? `${p.metrics.cpu_percent != null ? p.metrics.cpu_percent.toFixed(1) + '%' : p.metrics.cpu_cores.toFixed(2) + 'c'}` : '--'}
                  </td>
                  <td className="py-1 text-right tabular-nums text-[--color-text]">
                    {p.metrics ? formatBytes(p.metrics.memory_bytes) : '--'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function WorkloadSummary({ deployments }: { deployments: KubeDeployment[] }) {
  const degraded = deployments.filter((d) => d.unavailable_replicas > 0 || d.ready_replicas < d.replicas)
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono border bg-[--color-surface-2] border-[--color-border] text-[--color-text-muted]">{deployments.length} deployments</span>
        {degraded.length > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono border bg-red-950/40 border-red-900 text-red-400">{degraded.length} degraded</span>
        )}
      </div>
      {degraded.length > 0 && (
        <div className="space-y-1">
          {degraded.map((d) => (
            <div key={`${d.namespace}/${d.name}`} className="text-xs font-mono text-red-400 bg-red-950/20 rounded px-2 py-1 border border-red-900/50">
              <span className="font-medium">{d.namespace}/{d.name}</span> — {d.ready_replicas}/{d.replicas} ready, {d.unavailable_replicas} unavailable
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PvcSummary({ pvcs }: { pvcs: KubePVC[] }) {
  const bound = pvcs.filter((p) => p.phase === 'Bound').length
  const unbound = pvcs.filter((p) => p.phase === 'Pending' || p.phase === 'Lost').length
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1.5">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono border bg-green-950/40 border-green-900 text-green-400">{bound} bound</span>
        {unbound > 0 && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono border bg-yellow-950/40 border-yellow-900 text-yellow-400">{unbound} unbound</span>}
      </div>
      {pvcs.slice(0, 5).map((pvc) => (
        <div key={`${pvc.namespace}/${pvc.name}`} className="flex items-center justify-between text-xs font-mono">
          <span className="text-[--color-text] truncate">{pvc.namespace}/{pvc.name}</span>
          <span className={{ Bound: 'text-green-400', Pending: 'text-yellow-400', Lost: 'text-red-400' }[pvc.phase] ?? 'text-[--color-text-dim]'}>{pvc.phase}</span>
        </div>
      ))}
    </div>
  )
}

function CrashEvents({ events }: { events: KubeEvent[] }) {
  const warnings = events.filter((e) => e.type === 'Warning').slice(0, 5)
  if (warnings.length === 0) return null
  return (
    <div className="space-y-1.5">
      {warnings.map((e, i) => (
        <div key={i} className="text-xs font-mono bg-red-950/20 rounded px-2 py-1.5 border border-red-900/50">
          <div className="flex items-center justify-between gap-2">
            <span className="text-red-400 font-medium">{e.reason}</span>
            <span className="text-[--color-text-dim]">{e.namespace}/{e.name}</span>
          </div>
          <p className="text-[--color-text-muted] mt-0.5 truncate">{e.message}</p>
        </div>
      ))}
    </div>
  )
}

export function KubernetesMetricsCard({ data, loading }: { data: KubernetesData | null; loading: boolean }) {
  if (loading) return null
  if (!data || data.collector_disabled) return null
  if (!data.server_reachable) {
    return (
      <Card>
        <SectionHeader title="Kubernetes" description="Server unreachable" />
      </Card>
    )
  }

  const { workloads } = data
  const hasClusterResources = data.cluster_resources && data.cluster_resources.nodes_reporting > 0

  return (
    <div className="space-y-4">
      {/* Cluster Resources */}
      {hasClusterResources && (
        <Card>
          <SectionHeader title="Cluster Resources" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <GaugeBar label="CPU" value={data.cluster_resources.cpu_percent_avg} />
            <div className="text-xs font-mono text-[--color-text] tabular-nums space-y-1">
              <p><span className="text-[--color-text-muted]">CPU: </span>{data.cluster_resources.cpu_usage_cores.toFixed(2)} / {data.cluster_resources.cpu_capacity_cores.toFixed(2)} cores</p>
              <p><span className="text-[--color-text-muted]">Memory: </span>{formatBytes(data.cluster_resources.memory_usage_bytes)} / {formatBytes(data.cluster_resources.memory_capacity_bytes)}</p>
              <p><span className="text-[--color-text-muted]">Nodes reporting: </span>{data.cluster_resources.nodes_reporting}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Nodes */}
      <Card>
        <SectionHeader
          title="Nodes"
          description={data.node_metrics_available ? undefined : 'Metrics unavailable (metrics-server?)'}
        />
        <NodeSummary nodes={data.nodes} />
      </Card>

      {/* Pods */}
      <Card>
        <SectionHeader title="Pods" />
        <PodSummary
          pods={data.pods}
          crashloopbackoff_pods={data.crashloopbackoff_pods}
          pod_count={data.pod_count}
          running_pods={data.running_pods}
          pending_pods={data.pending_pods}
          failed_pods={data.failed_pods}
        />
      </Card>

      {/* Workload Health */}
      {workloads && workloads.deployments && workloads.deployments.length > 0 && (
        <Card>
          <SectionHeader title="Workloads" action={
            <div className="flex gap-1.5">
              {workloads.daemonsets?.length > 0 && <Tag>{workloads.daemonsets.length} DS</Tag>}
              {workloads.statefulsets?.length > 0 && <Tag>{workloads.statefulsets.length} STS</Tag>}
            </div>
          } />
          <WorkloadSummary deployments={workloads.deployments} />
          {workloads.services && workloads.services.length > 0 && (
            <div className="mt-3 pt-3 border-t border-[--color-border]">
              <p className="text-xs text-[--color-text-muted] font-mono mb-1">{workloads.services.length} service{workloads.services.length !== 1 ? 's' : ''}</p>
            </div>
          )}
        </Card>
      )}

      {/* PVCs */}
      {workloads && workloads.persistent_volume_claims && workloads.persistent_volume_claims.length > 0 && (
        <Card>
          <SectionHeader title="Persistent Volume Claims" />
          <PvcSummary pvcs={workloads.persistent_volume_claims} />
        </Card>
      )}

      {/* Warning Events */}
      {data.events && data.events.filter((e) => e.type === 'Warning').length > 0 && (
        <Card>
          <SectionHeader title="Warning Events" description={`${data.events.filter((e) => e.type === 'Warning').length} recent`} />
          <CrashEvents events={data.events} />
        </Card>
      )}
    </div>
  )
}
