import { useMemo, useCallback, useState } from 'react'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import { agentsApi } from '@/api'
import { useAgents, useTelemetry, useLiveMetrics, usePersistedState } from '@/hooks'
import { useUiStore } from '@/store/uiStore'
import { queryKeys } from '@/hooks/queryKeys'
import { PageHeader } from '@/components/layout/AppLayout'
import {
  Card,
  Select,
  Button,
  LoadingState,
  EmptyState,
  GaugeBar,
  Sparkline,
  ConfirmDialog,
} from '@/components/common'
import { formatBytes, formatBandwidth, formatUptime, gaugeColor } from '@/utils'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import type {
  Metric,
  MetricType,
  MetricResolution,
  CpuData,
  RamData,
  NetworkData,
  StorageData,
  StorageDisk,
  StoragePartition,
  KernelData,
  ProcessData,
} from '@/types'

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

const STORAGE_COLORS = ['#22c55e', '#3b82f6', '#a855f7', '#f97316', '#e11d48', '#0ea5e9', '#84cc16', '#f59e0b', '#14b8a6']
const NETWORK_COLORS = ['#22c55e', '#3b82f6', '#f97316', '#a855f7', '#14b8a6', '#e11d48', '#0ea5e9', '#84cc16', '#f59e0b']

function isoAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString()
}

export function MetricsPage() {
  const qc = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const { data: agents } = useAgents()
  const [selectedAgentId, setSelectedAgentId] = usePersistedState<string>('metrics_agent', '')
  const [metricType, setMetricType] = usePersistedState<MetricType>('metrics_type', 'cpu')
  const [timeRangeIdx, setTimeRangeIdx] = usePersistedState<number>('metrics_range', 1)
  const [storageView, setStorageView] = usePersistedState<'partitions' | 'disks'>('metrics_storage_view', 'partitions')
  const [procMinCpu, setProcMinCpu] = usePersistedState<number>('metrics_proc_min_cpu', 0)
  const [procSearch, setProcSearch] = useState('')
  const [killTarget, setKillTarget] = useState<{ pid: number; name: string } | null>(null)
  const [killLogs, setKillLogs] = useState<string[]>([])
  const [procGrouping, setProcGrouping] = usePersistedState<'flat' | 'byExe'>('metrics_proc_grouping', 'flat')
  const timeRange = TIME_RANGES[timeRangeIdx]
  const addNotification = useUiStore((s) => s.addNotification)

  const agentId = selectedAgentId || agents?.[0]?.agent_id || ''

  const { latest, history } = useLiveMetrics(agentId || null)

  const appendKillLog = useCallback((message: string) => {
    const ts = new Date().toLocaleTimeString()
    setKillLogs((prev) => [`${ts} — ${message}`, ...prev].slice(0, 10))
  }, [])

  const killMutation = useMutation({
    mutationFn: ({ targetAgentId, pid }: { targetAgentId: string; pid: number }) =>
      agentsApi.killProcess(targetAgentId, pid),
    onSuccess: (res, vars) => {
      appendKillLog(`Server accepted kill for PID ${vars.pid}${res.request_id ? ` (request ${res.request_id})` : ''}`)
      addNotification?.({ type: 'success', title: 'Kill dispatched', message: `PID ${vars.pid} sent to agent` })
    },
    onError: (error: Error, vars) => {
      appendKillLog(`Kill failed for PID ${vars.pid}: ${error.message}`)
      addNotification?.({ type: 'error', title: 'Kill failed', message: error.message })
    },
  })

  const handleKillConfirm = useCallback(() => {
    if (!killTarget) return
    if (!agentId) {
      appendKillLog('Kill aborted: no agent selected')
      addNotification?.({ type: 'error', title: 'Select an agent', message: 'Pick an agent before killing a process.' })
      setKillTarget(null)
      return
    }
    appendKillLog(`Requesting kill for PID ${killTarget.pid} (${killTarget.name || 'process'})`)
    killMutation.mutate({ targetAgentId: agentId, pid: killTarget.pid })
    setKillTarget(null)
  }, [agentId, killMutation, killTarget, appendKillLog, addNotification])

  const handleKillGroup = useCallback((exe: string, pids: number[]) => {
    if (!agentId) {
      appendKillLog('Kill aborted: no agent selected')
      addNotification?.({ type: 'error', title: 'Select an agent', message: 'Pick an agent before killing a process.' })
      return
    }
    if (!pids.length) return
    appendKillLog(`Requesting kill for ${pids.length} process(es) of ${exe || 'process'}`)
    pids.forEach((pid) => {
      killMutation.mutate({ targetAgentId: agentId, pid })
    })
  }, [agentId, killMutation, appendKillLog, addNotification])

  const queryParams = useMemo(
    () => ({
      agent_id: agentId,
      metric_type: metricType,
      resolution: timeRange.resolution,
      start: isoAgo(timeRange.hours),
      limit: 1000,
    }),
    [agentId, metricType, timeRange],
  )

  const { data: timeSeries, isLoading: tsLoading } = useTelemetry(queryParams, !!agentId)

  const shouldFallbackToRaw = !!agentId
    && timeRange.resolution !== 'raw'
    && !tsLoading
    && ((timeSeries?.length ?? 0) === 0)

  const rawFallbackParams = useMemo(() => ({
    ...queryParams,
    resolution: 'raw' as MetricResolution,
  }), [queryParams])

  const { data: fallbackSeries, isLoading: fallbackLoading } = useTelemetry(
    rawFallbackParams,
    shouldFallbackToRaw,
  )

  const effectiveSeries = useMemo<Metric[]>(() => {
    if (timeSeries && timeSeries.length) return timeSeries
    if (fallbackSeries && fallbackSeries.length) return fallbackSeries
    return []
  }, [timeSeries, fallbackSeries])

  const telemetryLoading = tsLoading || (shouldFallbackToRaw && fallbackLoading)

  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    qc.invalidateQueries({ queryKey: queryKeys.telemetry(queryParams) })
    if (shouldFallbackToRaw) {
      qc.invalidateQueries({ queryKey: queryKeys.telemetry(rawFallbackParams) })
    }
    setTimeout(() => setRefreshing(false), 800)
  }, [qc, queryParams, shouldFallbackToRaw, rawFallbackParams])

  const baseChartData = useMemo(() => {
    if (!effectiveSeries.length || metricType === 'storage') return []

    const sorted = [...effectiveSeries].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    )

    let prevTs: number | null = null
    const diffs: number[] = []
    for (const metric of sorted) {
      const ts = new Date(metric.timestamp).getTime()
      if (prevTs !== null) {
        const diff = ts - prevTs
        if (diff > 0) diffs.push(diff)
      }
      prevTs = ts
    }

    const baseGap = diffs.length ? Math.min(...diffs) : null

    const data: Array<Record<string, number | string | null>> = []
    prevTs = null

    const showDate = timeRange.hours >= 24
    const formatTimestamp = (date: Date) => showDate
      ? date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
      : date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

    const pushGapMarker = (gapMs: number) => {
      if (!gapMs || !baseGap) return
      const gapTime = new Date(gapMs)
      const label = formatTimestamp(gapTime)
      if (metricType === 'network') {
        data.push({ t: label, rx: null, tx: null })
      } else {
        data.push({ t: label, value: null })
      }
    }

    for (const metric of sorted) {
      const ts = new Date(metric.timestamp)
      const tsMs = ts.getTime()

      if (prevTs !== null && baseGap && tsMs - prevTs > baseGap * 2) {
        pushGapMarker(prevTs + baseGap)
      }

      const formatted = formatTimestamp(ts)
      const d = metric.data as Record<string, unknown>

      if (metricType === 'cpu') {
        data.push({ t: formatted, value: (d.usage_pct as number) ?? 0 })
      } else if (metricType === 'ram') {
        data.push({ t: formatted, value: (d.usage_pct as number) ?? 0 })
      } else if (metricType === 'network') {
        const ifaces = d.interfaces as Array<{ name: string; rx_bytes_rate: number; tx_bytes_rate: number }>
        const iface = ifaces?.find((i) => i.name !== 'lo') ?? ifaces?.[0]
        data.push({
          t: formatted,
          rx: iface ? (iface.rx_bytes_rate ?? 0) / 1024 : null,
          tx: iface ? (iface.tx_bytes_rate ?? 0) / 1024 : null,
        })
      } else {
        data.push({ t: formatted, value: 0 })
      }

      prevTs = tsMs
    }

    return data
  }, [effectiveSeries, metricType, timeRange.hours])

  const cpu = latest.cpu?.data as unknown as CpuData | undefined
  const ram = latest.ram?.data as unknown as RamData | undefined
  const network = latest.network?.data as unknown as NetworkData | undefined
  const storage = latest.storage?.data as unknown as StorageData | undefined
  const processData = latest.process?.data as unknown as ProcessData | undefined
  const storagePartitions = useMemo<StoragePartition[]>(() => {
    if (!storage) return []
    if (storage.partitions?.length) return storage.partitions
    if (storage.filesystems?.length) return storage.filesystems
    return []
  }, [storage])

  const storageDisks = useMemo<StorageDisk[]>(() => storage?.disks ?? [], [storage])

  const osDisk = useMemo<StorageDisk | undefined>(() => {
    if (!storage) return undefined
    if (storage.os_disk) return storage.os_disk

    const rootPartition = storagePartitions.find((p) => p.mount_point === '/') ?? storagePartitions[0]
    if (!rootPartition) return storageDisks[0]

    const parentId = rootPartition.parent_disk ?? rootPartition.device ?? rootPartition.name
    const match = storageDisks.find((d) => d.device === parentId || d.name === parentId)
    if (match) return match

    return storageDisks[0] ?? (rootPartition
      ? {
          device: rootPartition.device,
          name: rootPartition.name,
          fs_type: rootPartition.fs_type,
          total_bytes: rootPartition.total_bytes,
          used_bytes: rootPartition.used_bytes,
          free_bytes: rootPartition.free_bytes,
          usage_pct: rootPartition.usage_pct,
          is_removable: rootPartition.is_removable,
          mount_points: [rootPartition.mount_point],
          partition_count: 1,
          partitions: [rootPartition],
        }
      : undefined)
  }, [storage, storageDisks, storagePartitions])

  const storageSeries = useMemo(() => {
    if (!storage) return []
    if (storageView === 'disks') {
      return (storageDisks ?? []).map((disk) => ({
        key: disk.device ?? disk.name,
        label: disk.name ?? disk.device,
        fs: disk.fs_type,
      })).filter((d) => d.key)
    }
    return storagePartitions.map((p) => ({
      key: p.device ?? p.name,
      label: p.mount_point || p.name,
      fs: p.fs_type,
      parent: p.parent_disk ?? null,
    })).filter((p) => p.key)
  }, [storage, storageDisks, storagePartitions, storageView])

  const storageSeriesColors = useMemo(() => {
    const map: Record<string, string> = {}
    storageSeries.forEach((series, idx) => {
      map[series.key] = STORAGE_COLORS[idx % STORAGE_COLORS.length]
    })
    return map
  }, [storageSeries])

  const storageLegendMap = useMemo(() => {
    const map: Record<string, { label: string; fs: string; parent?: string | null }> = {}
    storageSeries.forEach((s) => {
      map[s.key] = { label: s.label, fs: s.fs, parent: (s as { parent?: string | null }).parent ?? null }
    })
    return map
  }, [storageSeries])

  const storageLegendRows = useMemo(() => {
    const source = storageView === 'disks' ? storageDisks : storagePartitions
    return storageSeries.map((series) => {
      const match = source.find((item) => (item.device ?? item.name) === series.key)
      return {
        key: series.key,
        label: series.label,
        fs: series.fs,
        used: match?.used_bytes ?? 0,
        total: match?.total_bytes ?? 0,
        pct: match?.usage_pct ?? 0,
        parent: (series as { parent?: string | null }).parent ?? null,
      }
    })
  }, [storageDisks, storagePartitions, storageSeries, storageView])

  const partitionByDisk = useMemo(() => {
    const map: Record<string, StoragePartition[]> = {}
    storagePartitions.forEach((p) => {
      const key = p.parent_disk ?? p.device ?? p.name
      if (!map[key]) map[key] = []
      map[key].push(p)
    })
    return map
  }, [storagePartitions])

  const storageTreeDisks = useMemo(() => {
    if (storageDisks.length) return storageDisks
    return Object.entries(partitionByDisk).map(([key, parts]) => {
      const total = parts.reduce((sum, p) => sum + p.total_bytes, 0)
      const used = parts.reduce((sum, p) => sum + p.used_bytes, 0)
      const fsTypes = Array.from(new Set(parts.map((p) => p.fs_type)))
      return {
        device: key,
        name: key,
        fs_type: fsTypes.length ? fsTypes.join(',') : 'unknown',
        total_bytes: total,
        used_bytes: used,
        free_bytes: Math.max(total - used, 0),
        usage_pct: total > 0 ? (used / total) * 100 : 0,
        is_removable: parts.every((p) => p.is_removable),
        mount_points: parts.map((p) => p.mount_point),
        partition_count: parts.length,
        partitions: parts,
      } as StorageDisk
    })
  }, [partitionByDisk, storageDisks])

  const storageChartData = useMemo(() => {
    if (!effectiveSeries.length || metricType !== 'storage' || !storageSeries.length) return []

    const sorted = [...effectiveSeries].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    )

    let prevTs: number | null = null
    const diffs: number[] = []
    for (const metric of sorted) {
      const ts = new Date(metric.timestamp).getTime()
      if (prevTs !== null) {
        const diff = ts - prevTs
        if (diff > 0) diffs.push(diff)
      }
      prevTs = ts
    }

    const baseGap = diffs.length ? Math.min(...diffs) : null
    const showDate = timeRange.hours >= 24
    const formatTimestamp = (date: Date) => showDate
      ? date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
      : date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

    const data: Array<Record<string, number | string | null>> = []
    prevTs = null

    const pushGapMarker = (gapMs: number) => {
      if (!gapMs || !baseGap) return
      const label = formatTimestamp(new Date(gapMs))
      const row: Record<string, number | string | null> = { t: label }
      storageSeries.forEach((s) => {
        row[s.key] = null
      })
      data.push(row)
    }

    for (const metric of sorted) {
      const ts = new Date(metric.timestamp)
      const tsMs = ts.getTime()

      if (prevTs !== null && baseGap && tsMs - prevTs > baseGap * 2) {
        pushGapMarker(prevTs + baseGap)
      }

      const payload = metric.data as unknown as StorageData
      const partitionsList = payload.partitions?.length ? payload.partitions : payload.filesystems ?? []
      const disksList = payload.disks ?? []
      const row: Record<string, number | string | null> = { t: formatTimestamp(ts) }

      if (storageView === 'disks') {
        storageSeries.forEach((series) => {
          const match = disksList.find((d) => (d.device ?? d.name) === series.key)
          row[series.key] = match ? match.usage_pct : null
        })
      } else {
        storageSeries.forEach((series) => {
          const match = partitionsList.find((p) => (p.device ?? p.name) === series.key)
          row[series.key] = match ? match.usage_pct : null
        })
      }

      data.push(row)
      prevTs = tsMs
    }

    return data
  }, [effectiveSeries, metricType, storageSeries, storageView, timeRange.hours])

  // ── Network multi-interface series ──────────────────────────────────────────
  const networkSeries = useMemo(() => {
    if (metricType !== 'network' || !effectiveSeries.length) return [] as string[]
    const names = new Set<string>()
    effectiveSeries.forEach((m) => {
      const d = m.data as unknown as NetworkData
      d.interfaces?.forEach((iface) => {
        if (iface.name !== 'lo') names.add(iface.name)
      })
    })
    return Array.from(names)
  }, [effectiveSeries, metricType])

  const networkSeriesColors = useMemo(() => {
    const map: Record<string, string> = {}
    networkSeries.forEach((name, idx) => {
      map[name] = NETWORK_COLORS[idx % NETWORK_COLORS.length]
    })
    return map
  }, [networkSeries])

  const networkChartData = useMemo(() => {
    if (metricType !== 'network' || !effectiveSeries.length || !networkSeries.length) return { ingress: [], egress: [] }

    const sorted = [...effectiveSeries].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    )

    let prevTs: number | null = null
    const diffs: number[] = []
    for (const metric of sorted) {
      const ts = new Date(metric.timestamp).getTime()
      if (prevTs !== null) {
        const diff = ts - prevTs
        if (diff > 0) diffs.push(diff)
      }
      prevTs = ts
    }

    const baseGap = diffs.length ? Math.min(...diffs) : null
    const showDate = timeRange.hours >= 24
    const formatTimestamp = (date: Date) => showDate
      ? date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
      : date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

    const ingress: Array<Record<string, number | string | null>> = []
    const egress: Array<Record<string, number | string | null>> = []
    prevTs = null

    const pushGapMarker = (gapMs: number) => {
      if (!gapMs || !baseGap) return
      const label = formatTimestamp(new Date(gapMs))
      const inRow: Record<string, number | string | null> = { t: label }
      const outRow: Record<string, number | string | null> = { t: label }
      networkSeries.forEach((n) => {
        inRow[n] = null
        outRow[n] = null
      })
      ingress.push(inRow)
      egress.push(outRow)
    }

    for (const metric of sorted) {
      const ts = new Date(metric.timestamp)
      const tsMs = ts.getTime()

      if (prevTs !== null && baseGap && tsMs - prevTs > baseGap * 2) {
        pushGapMarker(prevTs + baseGap)
      }

      const d = metric.data as unknown as NetworkData
      const inRow: Record<string, number | string | null> = { t: formatTimestamp(ts) }
      const outRow: Record<string, number | string | null> = { t: formatTimestamp(ts) }
      networkSeries.forEach((n) => { inRow[n] = null; outRow[n] = null })

      d.interfaces?.forEach((iface) => {
        if (iface.name === 'lo') return
        inRow[iface.name] = (iface.rx_bytes_rate ?? 0) / 1024
        outRow[iface.name] = (iface.tx_bytes_rate ?? 0) / 1024
      })

      ingress.push(inRow)
      egress.push(outRow)
      prevTs = tsMs
    }

    return { ingress, egress }
  }, [effectiveSeries, metricType, networkSeries, timeRange.hours])

  const hasData = metricType === 'storage'
    ? storageChartData.length > 0
    : metricType === 'network'
      ? networkChartData.ingress.length > 0 || networkChartData.egress.length > 0
      : baseChartData.length > 0

  const kernel = latest.kernel?.data as unknown as KernelData | undefined
  const rootDisk = osDisk
  const primaryInterface = network?.interfaces.find((i) => i.name !== 'lo') ?? network?.interfaces[0]

  const dedupedProcesses = useMemo(() => {
    if (!processData?.processes?.length) return []
    const map = new Map<number, ProcessData['processes'][number]>()
    processData.processes.forEach((p) => {
      const existing = map.get(p.pid)
      if (!existing) {
        map.set(p.pid, p)
        return
      }
      const better = (p.cpu_pct ?? 0) > (existing.cpu_pct ?? 0)
        || ((p.cpu_pct ?? 0) === (existing.cpu_pct ?? 0) && (p.start_time ?? 0) > (existing.start_time ?? 0))
      if (better) map.set(p.pid, p)
    })
    return Array.from(map.values())
  }, [processData?.processes])

  const filteredProcesses = useMemo(() => {
    if (!dedupedProcesses.length) return []
    return dedupedProcesses
      .filter((p) => (p.cpu_pct ?? 0) >= procMinCpu)
      .filter((p) => {
        if (!procSearch.trim()) return true
        const q = procSearch.toLowerCase()
        return (
          String(p.pid).includes(q)
          || p.name?.toLowerCase().includes(q)
          || (p.exe ?? '').toLowerCase().includes(q)
        )
      })
      .sort((a, b) => (b.cpu_pct ?? 0) - (a.cpu_pct ?? 0))
  }, [dedupedProcesses, procMinCpu, procSearch])

  const processGroups = useMemo(() => {
    if (!filteredProcesses.length) return [] as Array<{
      key: string
      label: string
      exe: string
      totalCpu: number
      totalMem: number
      count: number
      pids: number[]
      sampleName: string
    }>

    const map = new Map<string, {
      label: string
      exe: string
      totalCpu: number
      totalMem: number
      count: number
      pids: number[]
      sampleName: string
    }>()

    filteredProcesses.forEach((p) => {
      const key = (p.exe || p.name || 'unknown').toLowerCase()
      const group = map.get(key)
      if (!group) {
        map.set(key, {
          label: p.exe || p.name || 'unknown',
          exe: p.exe || 'unknown',
          totalCpu: p.cpu_pct ?? 0,
          totalMem: p.mem_bytes ?? 0,
          count: 1,
          pids: [p.pid],
          sampleName: p.name || 'process',
        })
      } else {
        group.totalCpu += p.cpu_pct ?? 0
        group.totalMem += p.mem_bytes ?? 0
        group.count += 1
        group.pids.push(p.pid)
      }
    })

    return Array.from(map.entries())
      .map(([key, g]) => ({ key, ...g }))
      .sort((a, b) => b.totalCpu - a.totalCpu)
  }, [filteredProcesses])

  return (
    <div>
      <style>{`@keyframes metrics-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <PageHeader
        title="Metrics"
        subtitle="Historical and live telemetry"
        actions={(
          <Button size="sm" variant="ghost" onClick={handleRefresh}>
            <span
              style={{ display: 'inline-block', animation: refreshing ? 'metrics-spin 0.6s linear' : 'none' }}
            >⟳</span> Refresh
          </Button>
        )}
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
                  variant={TIME_RANGES.indexOf(r) === timeRangeIdx ? 'primary' : 'ghost'}
              onClick={() => setTimeRangeIdx(TIME_RANGES.indexOf(r))}
            >
              {r.label}
            </Button>
          ))}
        </div>

        {metricType === 'storage' && (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant={storageView === 'partitions' ? 'primary' : 'ghost'}
              onClick={() => setStorageView('partitions')}
            >
              Partitions
            </Button>
            <Button
              size="sm"
              variant={storageView === 'disks' ? 'primary' : 'ghost'}
              onClick={() => setStorageView('disks')}
            >
              Disks
            </Button>
          </div>
        )}
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
              <p className="text-xs text-[--color-text-muted] font-mono mb-2">Disk {rootDisk.mount_points?.[0] ?? rootDisk.name}</p>
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
          <p className="text-xs font-mono text-[--color-text-dim]">{effectiveSeries.length} points · {shouldFallbackToRaw ? 'raw (fallback)' : timeRange.resolution}</p>
        </div>

        {!agentId ? (
          <EmptyState message="Select an agent" />
        ) : telemetryLoading ? (
          <LoadingState />
        ) : !hasData ? (
          <EmptyState message="No data for selected range" />
        ) : metricType === 'network' ? (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="min-w-0">
                <p className="text-[10px] font-mono text-[--color-text-dim] uppercase tracking-wide mb-1">Ingress (all interfaces)</p>
                <div style={{ width: '100%', height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={networkChartData.ingress} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                      <XAxis dataKey="t" tick={{ fontSize: 10, fontFamily: 'IBM Plex Mono', fill: 'var(--color-text-muted)' }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10, fontFamily: 'IBM Plex Mono', fill: 'var(--color-text-muted)' }} tickFormatter={(v) => `${v}KB/s`} />
                      <Tooltip
                        contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: 11, fontFamily: 'IBM Plex Mono' }}
                        labelStyle={{ color: 'var(--color-text-muted)' }}
                        formatter={(value: unknown, name: unknown) => {
                          const num = typeof value === 'number' ? value : Number(value ?? 0)
                          return [`${num.toFixed(1)} KB/s`, String(name)] as [string, string]
                        }}
                      />
                      {networkSeries.map((n) => (
                        <Area
                          key={`in-${n}`}
                          type="monotone"
                          dataKey={n}
                          stroke={networkSeriesColors[n]}
                          fill="none"
                          strokeWidth={1.5}
                          dot={false}
                          connectNulls={false}
                          name={n}
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="min-w-0">
                <p className="text-[10px] font-mono text-[--color-text-dim] uppercase tracking-wide mb-1">Egress (all interfaces)</p>
                <div style={{ width: '100%', height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={networkChartData.egress} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                      <XAxis dataKey="t" tick={{ fontSize: 10, fontFamily: 'IBM Plex Mono', fill: 'var(--color-text-muted)' }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10, fontFamily: 'IBM Plex Mono', fill: 'var(--color-text-muted)' }} tickFormatter={(v) => `${v}KB/s`} />
                      <Tooltip
                        contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: 11, fontFamily: 'IBM Plex Mono' }}
                        labelStyle={{ color: 'var(--color-text-muted)' }}
                        formatter={(value: unknown, name: unknown) => {
                          const num = typeof value === 'number' ? value : Number(value ?? 0)
                          return [`${num.toFixed(1)} KB/s`, String(name)] as [string, string]
                        }}
                      />
                      {networkSeries.map((n) => (
                        <Area
                          key={`out-${n}`}
                          type="monotone"
                          dataKey={n}
                          stroke={networkSeriesColors[n]}
                          fill="none"
                          strokeWidth={1.5}
                          dot={false}
                          connectNulls={false}
                          name={n}
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {networkSeries.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 mt-2">
                {networkSeries.map((n) => (
                  <div key={`legend-${n}`} className="flex items-center gap-2 text-[11px] font-mono text-[--color-text-dim]">
                    <span className="h-2 w-2 rounded-sm" style={{ background: networkSeriesColors[n] }} />
                    <span>{n}</span>
                  </div>
                ))}
              </div>
            )}

            {network?.interfaces && network.interfaces.filter((i) => i.name !== 'lo').length > 0 && (
              <div className="mt-4 border-t border-[--color-border] pt-3">
                <p className="text-xs font-mono text-[--color-text-muted] uppercase tracking-wide mb-2">Interfaces</p>
                <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                  {network.interfaces
                    .filter((i) => i.name !== 'lo')
                    .map((iface) => {
                      const rx = iface.rx_bytes_rate ?? 0
                      const tx = iface.tx_bytes_rate ?? 0
                      return (
                        <div
                          key={iface.name}
                          className="rounded border border-[--color-border] bg-[--color-surface-2] p-3 flex flex-col gap-2"
                          style={{ minWidth: 0 }}
                        >
                          <div className="flex items-center justify-between gap-2 min-w-0">
                            <span className="text-xs font-mono text-[--color-text] truncate">{iface.name}</span>
                          </div>
                          <div className="flex items-center justify-between text-[11px] font-mono text-[--color-text]">
                            <span className="flex items-center gap-1 text-[--color-text-dim]">
                              <ArrowDownRight size={14} /> In
                            </span>
                            <span>{formatBandwidth(rx)}</span>
                          </div>
                          <div className="flex items-center justify-between text-[11px] font-mono text-[--color-text]">
                            <span className="flex items-center gap-1 text-[--color-text-dim]">
                              <ArrowUpRight size={14} /> Out
                            </span>
                            <span>{formatBandwidth(tx)}</span>
                          </div>
                        </div>
                      )
                    })}
                </div>
              </div>
            )}

          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={260}>
              {metricType === 'storage' ? (
                <AreaChart data={storageChartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="t" tick={{ fontSize: 10, fontFamily: 'IBM Plex Mono', fill: 'var(--color-text-muted)' }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fontFamily: 'IBM Plex Mono', fill: 'var(--color-text-muted)' }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                  <Tooltip
                    contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: 11, fontFamily: 'IBM Plex Mono' }}
                    labelStyle={{ color: 'var(--color-text-muted)' }}
                    formatter={(value: unknown, name: unknown) => {
                      const num = typeof value === 'number' ? value : Number(value ?? 0)
                      const label = storageLegendMap[String(name)]?.label ?? String(name)
                      return [`${num.toFixed(1)}%`, label] as [string, string]
                    }}
                  />
                {storageSeries.map((series) => (
                  <Area
                    key={series.key}
                    type="monotone"
                    dataKey={series.key}
                    stroke={storageSeriesColors[series.key] ?? '#3b82f6'}
                    fill="none"
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls={false}
                    name={series.label}
                  />
                ))}
                </AreaChart>
              ) : (
                 <AreaChart data={baseChartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
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
                      formatter={(value: unknown) => {
                        const num = typeof value === 'number' ? value : Number(value ?? 0)
                        return [`${num.toFixed(1)}%`] as [string]
                      }}
                    />
                     <Area
                       type="monotone"
                       dataKey="value"
                       stroke="#3b82f6"
                       fill="#3b82f620"
                       strokeWidth={1.5}
                       dot={false}
                       connectNulls={false}
                     />
                 </AreaChart>
               )}
            </ResponsiveContainer>

            {metricType === 'storage' && storageLegendRows.length > 0 && (
              <div className="mt-4 border-t border-[--color-border] pt-3">
                <div className="grid grid-cols-[16px_1fr_1fr_1fr] text-[10px] font-mono text-[--color-text-dim] px-1 mb-1">
                  <span />
                  <span>{storageView === 'disks' ? 'Disk' : 'Partition / Mount'}</span>
                  <span>FS</span>
                  <span className="text-right">Usage</span>
                </div>
                <div className="space-y-1">
                  {storageLegendRows.map((row) => (
                    <div
                      key={row.key}
                      className="grid grid-cols-[16px_1fr_1fr_1fr] items-center gap-2 px-2 py-1 rounded border border-[--color-border] bg-[--color-surface-2]"
                    >
                      <span className="h-2 w-2 rounded-sm" style={{ background: storageSeriesColors[row.key] ?? '#3b82f6' }} />
                      <div className="flex flex-col leading-tight">
                        <span className="text-xs font-mono text-[--color-text]">{row.label}</span>
                        {row.parent && storageView === 'partitions' && (
                          <span className="text-[10px] text-[--color-text-dim]">disk {row.parent}</span>
                        )}
                      </div>
                      <span className="text-xs font-mono text-[--color-text-dim]">{row.fs}</span>
                      <div className="text-right text-xs font-mono text-[--color-text]">
                        {formatBytes(row.used)} / {formatBytes(row.total)} ({row.total ? row.pct.toFixed(1) : '0.0'}%)
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {metricType === 'storage' && storageTreeDisks.length > 0 && (
              <div className="mt-5 border-t border-[--color-border] pt-4">
                <p className="text-xs font-mono text-[--color-text-muted] uppercase tracking-wide mb-2">Storage layout</p>
                <div className="space-y-2">
                  {storageTreeDisks.map((disk) => {
                    const parts = partitionByDisk[disk.device] ?? disk.partitions ?? []
                    const pct = Math.min(100, Math.max(0, disk.usage_pct))
                    return (
                      <div key={disk.device} className="rounded border border-[--color-border] p-3 bg-[--color-surface-2]">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: storageSeriesColors[disk.device] ?? '#8b5cf6' }} />
                            <div className="flex flex-col leading-tight">
                              <span className="text-xs font-mono text-[--color-text]">{disk.name}</span>
                              <span className="text-[10px] text-[--color-text-dim]">{disk.mount_points?.join(', ') || '—'}</span>
                            </div>
                          </div>
                          <div className="text-right text-xs font-mono text-[--color-text]">
                            {formatBytes(disk.used_bytes)} / {formatBytes(disk.total_bytes)} ({pct.toFixed(1)}%)
                          </div>
                        </div>
                        <div className="mt-2 h-1.5 rounded-full bg-[--color-surface] overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: '#3b82f6' }} />
                        </div>
                        {parts.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {parts.map((p) => {
                              const partPct = Math.min(100, Math.max(0, p.usage_pct))
                              return (
                                <div key={p.device} className="pl-3 border-l border-dashed border-[--color-border]">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs font-mono text-[--color-text]">{p.mount_point || p.name}</span>
                                      <span className="text-[10px] text-[--color-text-dim]">{p.fs_type}</span>
                                    </div>
                                    <span className="text-xs font-mono text-[--color-text]">
                                      {formatBytes(p.used_bytes)} / {formatBytes(p.total_bytes)} ({partPct.toFixed(1)}%)
                                    </span>
                                  </div>
                                  <div className="mt-1 h-1 rounded-full bg-[--color-surface] overflow-hidden">
                                    <div className="h-full rounded-full" style={{ width: `${partPct}%`, background: storageSeriesColors[p.device] ?? '#22c55e' }} />
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {metricType === 'cpu' && (processData?.processes?.length ?? 0) > 0 && (
        <Card className="mt-4">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <p className="text-xs font-mono text-[--color-text-muted] uppercase tracking-wide mb-0">Processes</p>
            <label className="text-[10px] font-mono text-[--color-text-dim] flex items-center gap-1">
              Min CPU %
              <input
                type="number"
                min={0}
                max={100}
                value={procMinCpu}
                onChange={(e) => setProcMinCpu(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                className="w-16 rounded border border-[--color-border] bg-[--color-surface] text-xs px-1 py-0.5 font-mono text-[--color-text]"
              />
            </label>
            <input
              type="text"
              value={procSearch}
              onChange={(e) => setProcSearch(e.target.value)}
              placeholder="Search by name or pid"
              className="flex-1 min-w-[180px] max-w-[260px] rounded border border-[--color-border] bg-[--color-surface] text-xs px-2 py-1 font-mono text-[--color-text]"
            />
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant={procGrouping === 'flat' ? 'primary' : 'ghost'}
                onClick={() => setProcGrouping('flat')}
              >
                Flat list
              </Button>
              <Button
                size="sm"
                variant={procGrouping === 'byExe' ? 'primary' : 'ghost'}
                onClick={() => setProcGrouping('byExe')}
              >
                Group by exe
              </Button>
            </div>
          </div>

          {procGrouping === 'byExe' ? (
            !processGroups.length ? (
              <EmptyState message="No processes match filters" />
            ) : (
              <div className="rounded border border-[--color-border] bg-[--color-surface-2] overflow-hidden">
                <div className="grid grid-cols-[1fr_90px_90px_70px] gap-2 px-3 py-2 text-[10px] font-mono text-[--color-text-dim] border-b border-[--color-border]">
                  <span>Executable</span>
                  <span className="text-right">CPU% (sum)</span>
                  <span className="text-right">Mem (sum)</span>
                  <span className="text-right">Action</span>
                </div>
                <div className="max-h-64 overflow-auto divide-y divide-[--color-border]">
                  {processGroups.map((g) => (
                    <div key={g.key} className="grid grid-cols-[1fr_90px_90px_70px] gap-2 px-3 py-2 items-center text-xs font-mono text-[--color-text]">
                      <div className="flex flex-col min-w-0">
                        <span className="truncate" title={g.label}>{g.label}</span>
                        <span className="text-[10px] text-[--color-text-dim]">{g.count} proc · ex: {g.sampleName}</span>
                      </div>
                      <span className="text-right" style={{ color: g.totalCpu >= 80 ? '#f87171' : g.totalCpu >= 50 ? '#fbbf24' : 'var(--color-text)' }}>
                        {g.totalCpu.toFixed(1)}%
                      </span>
                      <span className="text-right text-[--color-text-dim]">{formatBytes(g.totalMem)}</span>
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={killMutation.isLoading}
                          onClick={() => handleKillGroup(g.label, g.pids)}
                        >
                          Kill all
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          ) : !filteredProcesses.length ? (
            <EmptyState message="No processes match filters" />
          ) : (
            <div className="rounded border border-[--color-border] bg-[--color-surface-2] overflow-hidden">
              <div className="grid grid-cols-[80px_1fr_70px_90px_1fr_70px] gap-2 px-3 py-2 text-[10px] font-mono text-[--color-text-dim] border-b border-[--color-border]">
                <span>PID</span>
                <span>Name</span>
                <span className="text-right">CPU%</span>
                <span className="text-right">Mem</span>
                <span>Exe</span>
                <span className="text-right">Action</span>
              </div>
              <div className="max-h-64 overflow-auto divide-y divide-[--color-border]">
                {filteredProcesses.map((p) => (
                  <div key={`${p.pid}-${p.start_time}`} className="grid grid-cols-[80px_1fr_70px_90px_1fr_70px] gap-2 px-3 py-2 items-center text-xs font-mono text-[--color-text]">
                    <span className="text-[--color-text-dim]">{p.pid}</span>
                    <span className="truncate" title={p.name}>{p.name || '—'}</span>
                    <span className="text-right" style={{ color: p.cpu_pct >= 80 ? '#f87171' : p.cpu_pct >= 50 ? '#fbbf24' : 'var(--color-text)' }}>
                      {p.cpu_pct.toFixed(1)}%
                    </span>
                    <span className="text-right text-[--color-text-dim]">{formatBytes(p.mem_bytes)}</span>
                    <span className="truncate text-[--color-text-dim]" title={p.exe || ''}>{p.exe || '—'}</span>
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={killMutation.isLoading}
                        onClick={() => setKillTarget({ pid: p.pid, name: p.name })}
                      >
                        Kill
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              {killLogs.length > 0 && (
                <div
                  className="mt-3 mx-2 mb-2 rounded border border-[--color-border] bg-[--color-surface] p-2"
                  style={{ color: '#ef4444' }}
                >
                  <p className="text-[10px] font-mono uppercase tracking-wide mb-1">Kill logs</p>
                  <div className="space-y-1 text-[11px] font-mono leading-tight">
                    {killLogs.map((line, idx) => (
                      <div key={`${line}-${idx}`}>{line}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

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

      {killTarget && (
        <ConfirmDialog
          title="Kill process"
          message={`Send kill to PID ${killTarget.pid} (${killTarget.name || 'process'})?`}
          confirmLabel="Kill"
          danger
          onConfirm={handleKillConfirm}
          onCancel={() => setKillTarget(null)}
        />
      )}
    </div>
  )
}
