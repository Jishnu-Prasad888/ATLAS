import { useMemo } from 'react'
import { SectionHeader, GaugeBar, Tag } from '@/components/common'
import { formatBytes, formatPct, timeAgo } from '@/utils'
import type {
  DockerData,
  ContainerInventoryItem,
  ContainerCpuSample,
  ContainerMemorySample,
  ContainerDiskSample,
  ContainerNetworkSample,
  ContainerLogSample,
  ContainerSecurityProfile,
  ContainerHealthStatus,
  ContainerTopologySample,
  ContainerProcessSample,
  ContainerFilesystemSample,
} from '@/types'

const statePalette: Record<string, string> = {
  running: 'text-green-400',
  exited: 'text-[--color-text-dim]',
  paused: 'text-yellow-400',
  restarting: 'text-orange-400',
  created: 'text-blue-400',
  dead: 'text-red-400',
  removing: 'text-red-400',
}

const healthPalette: Record<string, string> = {
  healthy: 'text-green-400',
  starting: 'text-blue-400',
  unhealthy: 'text-red-400',
  none: 'text-[--color-text-muted]',
}

const sectionCardClass = 'rounded-lg border border-[--color-border] bg-[--color-surface-2] p-4'

type SampleMaps = {
  cpu: Map<string, ContainerCpuSample>
  memory: Map<string, ContainerMemorySample>
  disk: Map<string, ContainerDiskSample>
  network: Map<string, ContainerNetworkSample>
  health: Map<string, ContainerHealthStatus>
}

function mapByContainer<T extends { container_id: string }>(samples: T[]): Map<string, T> {
  const map = new Map<string, T>()
  for (const sample of samples) {
    map.set(sample.container_id, sample)
  }
  return map
}

function SummaryBanner({ data }: { data: DockerData }) {
  const { summary, host } = data
  const totals = summary.resource_totals
  const hostMetrics = host.metrics

  return (
    <div className="rounded-xl p-5 mb-6 border border-[--color-border] bg-gradient-to-r from-[#0a141f] via-[#0f1d33] to-[#101a28] shadow-lg">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
        <div className="space-y-3">
          <div>
            <p className="text-xs text-[--color-text-muted] font-mono uppercase tracking-widest">Docker Inventory</p>
            <h3 className="text-2xl font-mono font-semibold text-white mt-1">
              {summary.total_containers} container{summary.total_containers === 1 ? '' : 's'} observed
            </h3>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(summary.state_counts).map(([state, count]) => (
              <span
                key={state}
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border border-white/10 bg-white/5 text-xs font-mono text-white/80"
              >
                <span className={statePalette[state] ?? 'text-white/60'}>{state}</span>
                <span className="tabular-nums">{count}</span>
              </span>
            ))}
          </div>
          {summary.last_event && (
            <p className="text-xs font-mono text-white/60">
              Last lifecycle event {timeAgo(summary.last_event)}
            </p>
          )}
        </div>

        {totals && (
          <div className="grid sm:grid-cols-2 gap-4 bg-black/20 backdrop-blur-sm border border-white/10 rounded-lg p-4">
            <div>
              <GaugeBar label="CPU Average" value={totals.cpu_percent_avg} />
              <p className="text-[10px] text-white/60 font-mono mt-2">
                Σ {totals.cpu_system_usage_sum.toLocaleString()} system ticks
              </p>
            </div>
            <div>
              <GaugeBar label="Memory Average" value={totals.memory_percent_avg} />
              <p className="text-[10px] text-white/60 font-mono mt-2">
                {formatBytes(totals.memory_usage_bytes_sum)} / {formatBytes(totals.memory_limit_bytes_sum)} committed
              </p>
            </div>
            <div>
              <p className="text-[11px] font-mono text-white/70 uppercase tracking-wide mb-1">I/O totals</p>
              <div className="text-[10px] text-white/70 font-mono space-y-1">
                <p>Net RX {formatBytes(totals.network_rx_bytes_sum)}</p>
                <p>Net TX {formatBytes(totals.network_tx_bytes_sum)}</p>
                <p>Blk R {formatBytes(totals.block_read_bytes_sum)} / W {formatBytes(totals.block_write_bytes_sum)}</p>
              </div>
            </div>
            <div>
              <p className="text-[11px] font-mono text-white/70 uppercase tracking-wide mb-1">Scheduler pressure</p>
              <div className="text-[10px] text-white/70 font-mono space-y-1">
                <p>Throttled periods {totals.cpu_throttled_periods_sum}</p>
                <p>Throttled time {totals.cpu_throttled_time_sum.toLocaleString()}</p>
                <p>PIDs observed {totals.pids_sum}</p>
              </div>
            </div>
          </div>
        )}

        {hostMetrics && (
          <div className="min-w-[220px] bg-black/25 border border-white/10 rounded-lg p-4">
            <p className="text-[11px] font-mono text-white/70 uppercase tracking-widest mb-2">Host Snapshot</p>
            <div className="space-y-1.5 text-[11px] text-white/80 font-mono">
              <p>Hostname {hostMetrics.hostname}</p>
              <p>CPU {hostMetrics.cpu_percent.toFixed(1)}%</p>
              <p>Memory {formatBytes(hostMetrics.memory_used)} / {formatBytes(hostMetrics.memory_total)}</p>
              <p>Disk {formatBytes(hostMetrics.disk_used)} / {formatBytes(hostMetrics.disk_total)}</p>
              <p>Load {hostMetrics.load_1.toFixed(2)} / {hostMetrics.load_5.toFixed(2)} / {hostMetrics.load_15.toFixed(2)}</p>
              <p>Uptime {Math.round(hostMetrics.uptime / 3600)}h</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function InventoryTable({
  containers,
  maps,
}: {
  containers: ContainerInventoryItem[]
  maps: SampleMaps
}) {
  if (!containers.length) {
    return <p className="text-xs text-[--color-text-dim] font-mono">No containers detected.</p>
  }

  return (
    <div className={sectionCardClass}>
      <SectionHeader
        title="Container Inventory"
        description="Live resource posture per container"
      />
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs font-mono">
          <thead>
            <tr className="border-b border-[--color-border] text-[--color-text-muted]">
              <th className="text-left py-1.5 pr-3 font-normal">Container</th>
              <th className="text-left py-1.5 pr-3 font-normal">State</th>
              <th className="text-right py-1.5 pr-3 font-normal">CPU</th>
              <th className="text-right py-1.5 pr-3 font-normal">Memory</th>
              <th className="text-right py-1.5 pr-3 font-normal">Net I/O</th>
              <th className="text-right py-1.5 pr-3 font-normal">Blk I/O</th>
              <th className="text-right py-1.5 font-normal">Restarts</th>
            </tr>
          </thead>
          <tbody>
            {containers.map((c) => {
              const cpu = maps.cpu.get(c.container_id)
              const mem = maps.memory.get(c.container_id)
              const disk = maps.disk.get(c.container_id)
              const net = maps.network.get(c.container_id)
              const health = maps.health.get(c.container_id)

              const interfaces = net?.interfaces ?? []
              const rx = interfaces.reduce((sum, iface) => sum + iface.rx_bytes, 0)
              const tx = interfaces.reduce((sum, iface) => sum + iface.tx_bytes, 0)

              const stateClass = statePalette[c.state] ?? 'text-[--color-text]'
              const healthBadge = health?.health_status ?? (c.state === 'running' ? 'unknown' : 'none')

              return (
                <tr key={c.container_id} className="border-b border-[--color-border] last:border-0 hover:bg-[--color-surface] transition-colors">
                  <td className="py-2 pr-3">
                    <div className="flex flex-col">
                      <span className="text-[--color-text] truncate" title={c.name}>{c.name}</span>
                      <span className="text-[--color-text-dim] text-[10px] truncate" title={c.image}>{c.image}</span>
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <span className={stateClass}>{c.state}</span>
                      <span className={`text-[10px] ${healthPalette[healthBadge] ?? 'text-[--color-text-muted]'}`}>
                        {healthBadge}
                      </span>
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-[--color-text]">
                    {cpu ? `${cpu.cpu_percent.toFixed(1)}%` : '--'}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-[--color-text]">
                    {mem ? `${formatBytes(mem.memory_usage)} (${formatPct(mem.memory_percent)})` : '--'}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-[--color-text]">
                    {net ? `${formatBytes(rx)} / ${formatBytes(tx)}` : '--'}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-[--color-text]">
                    {disk ? `${formatBytes(disk.read_bytes)} / ${formatBytes(disk.write_bytes)}` : '--'}
                  </td>
                  <td className="py-2 text-right tabular-nums text-[--color-text]">{c.restart_count}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function EventsSection({
  events,
  containerName,
}: {
  events: DockerData['lifecycle']['events']
  containerName: (id: string) => string
}) {
  if (!events.length) {
    return null
  }

  return (
    <div className={sectionCardClass}>
      <SectionHeader title="Lifecycle Events" description="Last 20 Docker daemon events" />
      <ul className="space-y-2">
        {events.slice(0, 20).map((event) => (
          <li key={`${event.timestamp}-${event.container_id}-${event.event}`} className="flex items-start gap-3">
            <span className="text-[10px] text-[--color-text-muted] font-mono shrink-0 w-20">
              {timeAgo(event.timestamp)}
            </span>
            <div className="flex-1">
              <p className="text-xs font-mono text-[--color-text]">
                <span className="text-[--color-text-muted]">{containerName(event.container_id)}</span> →{' '}
                <span className="text-[--color-text] uppercase tracking-wide">{event.event}</span>
              </p>
              {Object.keys(event.attributes).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {Object.entries(event.attributes).map(([k, v]) => (
                    <Tag key={k}>{k}:{v}</Tag>
                  ))}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function LogsSection({ samples, containerName }: { samples: ContainerLogSample[]; containerName: (id: string) => string }) {
  const entries = useMemo(() => {
    const all = samples.flatMap((sample) =>
      sample.entries.map((entry) => ({ ...entry, container_id: sample.container_id })),
    )
    return all
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 25)
  }, [samples])

  if (!entries.length) return null

  return (
    <div className={sectionCardClass}>
      <SectionHeader title="Recent Logs" description="Docker stdout/stderr tails" />
      <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
        {entries.map((entry, idx) => (
          <div key={`${entry.timestamp}-${idx}`} className="flex items-start gap-3">
            <span className="text-[10px] text-[--color-text-muted] font-mono shrink-0 w-20">
              {timeAgo(entry.timestamp)}
            </span>
            <span className="text-[10px] font-mono text-[--color-text-muted] uppercase tracking-wide">
              {containerName(entry.container_id)}
            </span>
            <span className={`text-[10px] font-mono uppercase ${entry.stream === 'stderr' ? 'text-red-400' : 'text-green-400'}`}>
              {entry.stream}
            </span>
            <p className="flex-1 text-xs font-mono text-[--color-text] whitespace-pre-wrap">{entry.message}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function SecuritySection({ profiles }: { profiles: ContainerSecurityProfile[] }) {
  if (!profiles.length) return null

  return (
    <div className={sectionCardClass}>
      <SectionHeader title="Security Posture" description="Runtime isolation per container" />
      <div className="grid md:grid-cols-2 gap-3">
        {profiles.map((profile) => (
          <div key={profile.container_id} className="border border-[--color-border] rounded-lg p-3 bg-[--color-surface]">
            <p className="text-xs text-[--color-text-muted] font-mono mb-2">{profile.container_id.slice(0, 12)}</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              <Tag>{profile.privileged ? 'privileged' : 'rootless'}</Tag>
              <Tag>{profile.readonly_rootfs ? 'read-only fs' : 'rw fs'}</Tag>
              <Tag>{profile.host_network ? 'host net' : 'bridge net'}</Tag>
              <Tag>{profile.host_pid ? 'host pid' : 'isolated pid'}</Tag>
              {profile.docker_socket_mounted && <Tag>docker.sock</Tag>}
            </div>
            <p className="text-[10px] text-[--color-text-muted] font-mono">User {profile.user || 'default'}</p>
            {profile.capabilities.length > 0 && (
              <p className="text-[10px] text-[--color-text-muted] font-mono mt-1">Caps {profile.capabilities.join(', ')}</p>
            )}
            <p className="text-[10px] text-[--color-text-muted] font-mono mt-1">Seccomp {profile.seccomp_profile || 'default'}</p>
            <p className="text-[10px] text-[--color-text-muted] font-mono">AppArmor {profile.apparmor_profile || 'default'}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function ProcessesSection({ samples, containerName }: { samples: ContainerProcessSample[]; containerName: (id: string) => string }) {
  if (!samples.length) return null

  return (
    <div className={sectionCardClass}>
      <SectionHeader title="Foreground Processes" description="Top task list by container" />
      <div className="grid md:grid-cols-2 gap-3">
        {samples.map((sample) => (
          <div key={sample.container_id} className="border border-[--color-border] rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-[--color-text-muted] font-mono">{containerName(sample.container_id)}</span>
              {sample.capped && <Tag>capped</Tag>}
            </div>
            <table className="w-full text-[10px] font-mono">
              <thead>
                <tr className="text-[--color-text-muted]">
                  <th className="text-left font-normal">PID</th>
                  <th className="text-left font-normal">CMD</th>
                  <th className="text-right font-normal">CPU</th>
                  <th className="text-right font-normal">MEM</th>
                </tr>
              </thead>
              <tbody>
                {sample.processes.slice(0, 6).map((proc) => (
                  <tr key={proc.pid}>
                    <td className="py-1 pr-2">{proc.pid}</td>
                    <td className="py-1 pr-2 text-[--color-text] truncate" title={proc.command}>{proc.command}</td>
                    <td className="py-1 pr-2 text-right">{proc.cpu_percent.toFixed(1)}%</td>
                    <td className="py-1 text-right">{formatBytes(proc.memory_bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  )
}

function FilesystemSection({ samples, containerName }: { samples: ContainerFilesystemSample[]; containerName: (id: string) => string }) {
  if (!samples.length) return null

  return (
    <div className={sectionCardClass}>
      <SectionHeader title="Filesystem Footprint" description="Writable layers and mounted volumes" />
      <div className="grid md:grid-cols-2 gap-3">
        {samples.map((sample) => (
          <div key={sample.container_id} className="border border-[--color-border] rounded-lg p-3 bg-[--color-surface]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-[--color-text-muted] font-mono">{containerName(sample.container_id)}</span>
              <span className="text-[10px] text-[--color-text-dim] font-mono">Layer {sample.writable_layer_size != null ? formatBytes(sample.writable_layer_size) : '--'}</span>
            </div>
            <p className="text-[10px] text-[--color-text-muted] font-mono mb-2">
              Volumes {sample.total_volume_usage != null ? formatBytes(sample.total_volume_usage) : 'n/a'} · Inodes {sample.inode_usage != null ? sample.inode_usage.toLocaleString() : 'n/a'}
            </p>
            {sample.volumes.length > 0 && (
              <div className="space-y-1">
                {sample.volumes.slice(0, 3).map((volume) => (
                  <div key={`${volume.name}-${volume.destination}`} className="flex justify-between text-[10px] font-mono text-[--color-text]">
                    <span className="truncate" title={volume.destination}>{volume.destination}</span>
                    <span>{volume.used_bytes != null ? formatBytes(volume.used_bytes) : 'n/a'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function TopologySection({ samples, containerName }: { samples: ContainerTopologySample[]; containerName: (id: string) => string }) {
  if (!samples.length) return null

  return (
    <div className={sectionCardClass}>
      <SectionHeader title="Network Topology" description="Container attachment across Docker networks" />
      <div className="space-y-3">
        {samples.map((sample) => (
          <div key={sample.container_id} className="border border-[--color-border] rounded-lg p-3">
            <p className="text-xs text-[--color-text-muted] font-mono mb-2">{containerName(sample.container_id)}</p>
            {sample.networks.length === 0 ? (
              <p className="text-[10px] text-[--color-text-dim] font-mono">No network attachments</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {sample.networks.map((network) => (
                  <div key={`${network.network_name}-${network.ip_address}`} className="bg-[--color-surface] border border-[--color-border] rounded-md px-3 py-2">
                    <p className="text-[10px] text-[--color-text] font-mono">{network.network_name}</p>
                    <p className="text-[10px] text-[--color-text-muted] font-mono">IP {network.ip_address || 'n/a'}</p>
                    {network.gateway && (
                      <p className="text-[10px] text-[--color-text-muted] font-mono">GW {network.gateway}</p>
                    )}
                    {network.ports.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {network.ports.slice(0, 4).map((port, idx) => (
                          <Tag key={idx}>{port.private_port}{port.public_port ? `→${port.public_port}` : ''}/{port.protocol}</Tag>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function ImagesSection({ images }: { images: DockerData['images']['images'] }) {
  if (!images.length) return null

  return (
    <div className={sectionCardClass}>
      <SectionHeader title="Image Catalogue" description={`${images.length} unique images referenced`} />
      <div className="flex flex-wrap gap-1.5">
        {images.slice(0, 40).map((image) => {
          const label = image.repo_tags[0] ?? image.repo_digests[0] ?? image.image_id.slice(0, 12)
          return <Tag key={`${image.image_id}-${label}`}>{label}</Tag>
        })}
      </div>
    </div>
  )
}

export function DockerMetricsCard({ data, loading }: { data: DockerData | null; loading: boolean }) {
  if (loading || !data || data.collector_disabled) return null

  const containers = data.inventory.containers

  const sampleMaps: SampleMaps = useMemo(
    () => ({
      cpu: mapByContainer(data.metrics.cpu.samples),
      memory: mapByContainer(data.metrics.memory.samples),
      disk: mapByContainer(data.metrics.disk.samples),
      network: mapByContainer(data.metrics.network.samples),
      health: mapByContainer(data.health.statuses),
    }),
    [
      data.metrics.cpu.samples,
      data.metrics.memory.samples,
      data.metrics.disk.samples,
      data.metrics.network.samples,
      data.health.statuses,
    ],
  )

  const containerName = (id: string) => {
    const match = containers.find((c) => c.container_id === id)
    return match ? match.name : id.slice(0, 12)
  }

  const pairedEvents = useMemo(() => data.lifecycle.events.slice().sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()), [data.lifecycle.events])

  return (
    <div className="space-y-6">
      <SummaryBanner data={data} />

      <InventoryTable containers={containers} maps={sampleMaps} />

      <div className="grid lg:grid-cols-2 gap-6">
        <EventsSection events={pairedEvents} containerName={containerName} />
        <LogsSection samples={data.logs.samples} containerName={containerName} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <SecuritySection profiles={data.security.profiles} />
        <ProcessesSection samples={data.processes.samples} containerName={containerName} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <FilesystemSection samples={data.filesystem.samples} containerName={containerName} />
        <TopologySection samples={data.topology.samples} containerName={containerName} />
      </div>

      <ImagesSection images={data.images.images} />
    </div>
  )
}
