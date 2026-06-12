import { useState, useMemo } from 'react'
import { useAgents, useTelemetry, useLiveMetrics } from '@/hooks'
import { PageHeader } from '@/components/layout/AppLayout'
import {
  Card,
  Select,
  Button,
  LoadingState,
  EmptyState,
  GaugeBar,
  Sparkline,
} from '@/components/common'
import { formatBytes, formatBandwidth, formatUptime, gaugeColor, timeAgo } from '@/utils'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import type { MetricType, MetricResolution, CpuData, RamData, NetworkData, StorageData, KernelData } from '@/types'

const METRIC_OPTIONS: Array<{ value: MetricType; label: string }> = [
  { value: 'cpu', label: 'CPU' },
  { value: 'ram', label: 'RAM' },
  { value: 'network', label: 'Network' },
  { value: 'storage', label: 'Storage' },
]

const TIME_RANGES = [
  { label: '1h', hours: 1, resolution: 'raw' as MetricResolution },
  { label: '6h', hours: 6, resolution: '1min' as MetricResolution },
  { label: '24h', hours: 24, resolution: '1min' as MetricResolution },
  { label: '7d', hours: 168, resolution: '1hour' as MetricResolution },
  { label: '30d', hours: 720, resolution: '1hour' as MetricResolution },
]

function isoAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString()
}

export function MetricsPage() {
  const { data: agents } = useAgents()
  const [selectedAgentId, setSelectedAgentId] = useState<string>('')
  const [metricType, setMetricType] = useState<MetricType>('cpu')
  const [timeRange, setTimeRange] = useState(TIME_RANGES[1])

  const agentId = selectedAgentId || agents?.[0]?.agent_id || ''

  const { latest, history } = useLiveMetrics(agentId || null)

  const { data: timeSeries, isLoading: tsLoading } = useTelemetry(
    {
      agent_id: agentId,
      metric_type: metricType,
      resolution: timeRange.resolution,
      start: isoAgo(timeRange.hours),
      limit: 1000,
    },
    !!agentId,
  )

  const chartData = useMemo(() => {
    if (!timeSeries) return []
    return [...timeSeries].reverse().map((m) => {
      const d = m.data as Record<string, unknown>
      const t = new Date(m.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      if (metricType === 'cpu') return { t, value: (d.usage_pct as number) ?? 0 }
      if (metricType === 'ram') return { t, value: (d.usage_pct as number) ?? 0 }
      if (metricType === 'network') {
        const ifaces = d.interfaces as Array<{ name: string; rx_bytes_rate: number; tx_bytes_rate: number }>
        const iface = ifaces?.find((i) => i.name !== 'lo') ?? ifaces?.[0]
        return { t, rx: (iface?.rx_bytes_rate ?? 0) / 1024, tx: (iface?.tx_bytes_rate ?? 0) / 1024 }
      }
      if (metricType === 'storage') {
        const fs = (d.filesystems as Array<{ mount_point: string; usage_pct: number }>)
        const root = fs?.find((f) => f.mount_point === '/') ?? fs?.[0]
        return { t, value: root?.usage_pct ?? 0 }
      }
      return { t, value: 0 }
    })
  }, [timeSeries, metricType])

  const cpu = latest.cpu?.data as CpuData | undefined
  const ram = latest.ram?.data as RamData | undefined
  const network = latest.network?.data as NetworkData | undefined
  const storage = latest.storage?.data as StorageData | undefined
  const kernel = latest.kernel?.data as KernelData | undefined
  const rootDisk = storage?.filesystems.find((f) => f.mount_point === '/') ?? storage?.filesystems[0]
  const primaryInterface = network?.interfaces.find((i) => i.name !== 'lo') ?? network?.interfaces[0]

  return (
    <div>
      <PageHeader
        title="Metrics"
        subtitle="Historical and live telemetry"
      />

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <Select
          value={agentId}
          onChange={(e) => setSelectedAgentId(e.target.value)}
          className="w-48"
        >
          {agents?.map((a) => (
            <option key={a.agent_id} value={a.agent_id}>{a.hostname}</option>
          ))}
        </Select>

        <Select
          value={metricType}
          onChange={(e) => setMetricType(e.target.value as MetricType)}
          className="w-32"
        >
          {METRIC_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>

        <div className="flex items-center gap-1">
          {TIME_RANGES.map((r) => (
            <Button
              key={r.label}
              size="sm"
              variant={r === timeRange ? 'primary' : 'ghost'}
              onClick={() => setTimeRange(r)}
            >
              {r.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Current gauges */}
      {agentId && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {cpu && (
            <Card>
              <p className="text-xs text-[--color-text-muted] font-mono mb-2">CPU</p>
              <GaugeBar label="Usage" value={cpu.usage_pct} />
              <div className="flex items-center gap-4 mt-2">
                <Sparkline values={history.cpu} color={gaugeColor(cpu.usage_pct)} width={60} height={20} />
                <div>
                  <p className="text-xs text-[--color-text-dim] font-mono">{cpu.core_count} cores</p>
                  <p className="text-xs text-[--color-text-dim] font-mono">load {cpu.load_avg_1m.toFixed(2)}</p>
                </div>
              </div>
            </Card>
          )}
          {ram && (
            <Card>
              <p className="text-xs text-[--color-text-muted] font-mono mb-2">RAM</p>
              <GaugeBar label="Usage" value={ram.usage_pct} />
              <p className="text-xs text-[--color-text-dim] font-mono mt-2">
                {formatBytes(ram.used_bytes)} / {formatBytes(ram.total_bytes)}
              </p>
              {ram.swap.total_bytes > 0 && (
                <p className="text-xs text-[--color-text-dim] font-mono">
                  swap {formatBytes(ram.swap.used_bytes)}
                </p>
              )}
            </Card>
          )}
          {primaryInterface && (
            <Card>
              <p className="text-xs text-[--color-text-muted] font-mono mb-2">Network ({primaryInterface.name})</p>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-xs font-mono text-[--color-text-muted]">RX</span>
                  <span className="text-xs font-mono text-[--color-text]">{formatBandwidth(primaryInterface.rx_bytes_rate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs font-mono text-[--color-text-muted]">TX</span>
                  <span className="text-xs font-mono text-[--color-text]">{formatBandwidth(primaryInterface.tx_bytes_rate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs font-mono text-[--color-text-muted]">TCP conns</span>
                  <span className="text-xs font-mono text-[--color-text] tabular-nums">{network?.tcp.established}</span>
                </div>
              </div>
            </Card>
          )}
          {rootDisk && (
            <Card>
              <p className="text-xs text-[--color-text-muted] font-mono mb-2">Disk {rootDisk.mount_point}</p>
              <GaugeBar label="Usage" value={rootDisk.usage_pct} />
              <p className="text-xs text-[--color-text-dim] font-mono mt-2">
                {formatBytes(rootDisk.used_bytes)} / {formatBytes(rootDisk.total_bytes)}
              </p>
              <p className="text-xs text-[--color-text-dim] font-mono">{rootDisk.fs_type}</p>
            </Card>
          )}
        </div>
      )}

      {/* Time-series chart */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-mono text-[--color-text-muted] uppercase tracking-wide">
            {METRIC_OPTIONS.find((o) => o.value === metricType)?.label} — {timeRange.label}
          </p>
          <p className="text-xs font-mono text-[--color-text-dim]">{timeSeries?.length ?? 0} points · {timeRange.resolution}</p>
        </div>

        {!agentId ? (
          <EmptyState message="Select an agent" />
        ) : tsLoading ? (
          <LoadingState />
        ) : !chartData.length ? (
          <EmptyState message="No data for selected range" />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            {metricType === 'network' ? (
              <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="t" tick={{ fontSize: 10, fontFamily: 'IBM Plex Mono', fill: 'var(--color-text-muted)' }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fontFamily: 'IBM Plex Mono', fill: 'var(--color-text-muted)' }} tickFormatter={(v) => `${v}KB/s`} />
                <Tooltip
                  contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: 11, fontFamily: 'IBM Plex Mono' }}
                  labelStyle={{ color: 'var(--color-text-muted)' }}
                  formatter={(v: number, name: string) => [`${v.toFixed(1)} KB/s`, name === 'rx' ? 'RX' : 'TX']}
                />
                <Area type="monotone" dataKey="rx" stroke="#22c55e" fill="#22c55e20" strokeWidth={1.5} dot={false} name="rx" />
                <Area type="monotone" dataKey="tx" stroke="#3b82f6" fill="#3b82f620" strokeWidth={1.5} dot={false} name="tx" />
              </AreaChart>
            ) : (
              <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="t" tick={{ fontSize: 10, fontFamily: 'IBM Plex Mono', fill: 'var(--color-text-muted)' }} interval="preserveStartEnd" />
                <YAxis
                  tick={{ fontSize: 10, fontFamily: 'IBM Plex Mono', fill: 'var(--color-text-muted)' }}
                  domain={[0, 100]}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: 11, fontFamily: 'IBM Plex Mono' }}
                  labelStyle={{ color: 'var(--color-text-muted)' }}
                  formatter={(v: number) => [`${v.toFixed(1)}%`]}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#3b82f6"
                  fill="#3b82f620"
                  strokeWidth={1.5}
                  dot={false}
                />
              </AreaChart>
            )}
          </ResponsiveContainer>
        )}
      </Card>

      {/* Kernel info */}
      {kernel && (
        <Card className="mt-4">
          <p className="text-xs font-mono text-[--color-text-muted] uppercase tracking-wide mb-3">System Info</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
            <div>
              <p className="text-[--color-text-dim] mb-0.5">Kernel</p>
              <p className="text-[--color-text]">{kernel.kernel_version}</p>
            </div>
            <div>
              <p className="text-[--color-text-dim] mb-0.5">OS</p>
              <p className="text-[--color-text]">{kernel.os_version}</p>
            </div>
            <div>
              <p className="text-[--color-text-dim] mb-0.5">Uptime</p>
              <p className="text-[--color-text]">{formatUptime(kernel.uptime_secs)}</p>
            </div>
            <div>
              <p className="text-[--color-text-dim] mb-0.5">CPUs</p>
              <p className="text-[--color-text]">{kernel.cpu_count}</p>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
