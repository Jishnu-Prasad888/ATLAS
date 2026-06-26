import React, {
  useCallback, useEffect, useMemo, useState,
} from 'react'
import {
  Alert,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as Haptics from 'expo-haptics'
import { LineChart, Grid } from 'react-native-svg-charts'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react-native'

import { agentsApi } from '@/api/endpoints'
import { useTelemetry } from '@/hooks'
import { useLiveMetrics } from '@/hooks/useLiveMetrics'
import { useAuthStore } from '@/store/authStore'
import {
  CpuData,
  GpuData,
  KernelData,
  Metric,
  MetricResolution,
  MetricType,
  NetworkData,
  ProcessData,
  RamData,
  StorageData,
  StorageDisk,
  StoragePartition,
} from '@/types'
import {
  Card,
  EmptyState,
  LoadingState,
  MetricBar,
  MonoText,
  SectionHeader,
} from '@/components/common'
import {
  clamp,
  formatBandwidth,
  formatBytes,
  formatPct,
  formatTs,
  formatUptime,
} from '@/utils/format'
import { useTheme } from '@/theme'

const METRIC_OPTIONS: Array<{ value: MetricType; label: string; color: string }> = [
  { value: 'cpu', label: 'CPU', color: '#3b82f6' },
  { value: 'ram', label: 'RAM', color: '#22c55e' },
  { value: 'gpu', label: 'GPU', color: '#a855f7' },
  { value: 'network', label: 'Network', color: '#0ea5e9' },
  { value: 'storage', label: 'Storage', color: '#f97316' },
]

const TIME_RANGES: Array<{ label: string; hours: number; resolution: MetricResolution }> = [
  { label: '1h', hours: 1, resolution: 'raw' },
  { label: '6h', hours: 6, resolution: '1min' },
  { label: '24h', hours: 24, resolution: '1min' },
  { label: '7d', hours: 168, resolution: '1hour' },
  { label: '30d', hours: 720, resolution: '1hour' },
]

const SERIES_COLORS = ['#22c55e', '#3b82f6', '#a855f7', '#f97316', '#e11d48', '#14b8a6', '#eab308']

const isoAgo = (hours: number) => new Date(Date.now() - hours * 3600 * 1000).toISOString()
const safeNumber = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const gaugeColor = (value: number) => (value >= 90 ? '#ef4444' : value >= 70 ? '#f97316' : value >= 50 ? '#eab308' : '#22c55e')
const metricColor = (type: MetricType) => METRIC_OPTIONS.find(o => o.value === type)?.color ?? '#3b82f6'

function Chip({
  label,
  active,
  color,
  onPress,
}: {
  label: string
  active: boolean
  color: string
  onPress: () => void
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.82}
      onPress={onPress}
      style={{
        minHeight: 32,
        justifyContent: 'center',
        borderRadius: 7,
        borderWidth: 1,
        borderColor: active ? color : '#1e252e',
        backgroundColor: active ? color + '22' : 'transparent',
        paddingHorizontal: 10,
        paddingVertical: 6,
      }}
    >
      <MonoText size={10} color={active ? color : '#6b7280'} style={{ fontWeight: active ? '700' : '500' }}>
        {label}
      </MonoText>
    </TouchableOpacity>
  )
}

function StatLine({ label, value, color = '#d4dae3' }: { label: string; value: string; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
      <MonoText size={10} color="#6b7280">{label}</MonoText>
      <MonoText size={10} color={color} style={{ flex: 1, textAlign: 'right' }} numberOfLines={1}>{value}</MonoText>
    </View>
  )
}

function GaugeCard({
  title,
  value,
  detail,
  timestamp,
  children,
}: {
  title: string
  value: number
  detail?: string
  timestamp?: string
  children?: React.ReactNode
}) {
  const clamped = clamp(safeNumber(value), 0, 100)
  const color = gaugeColor(clamped)
  return (
    <Card style={{ flex: 1, padding: 12, minHeight: 150 }}>
      <MonoText size={10} color="#6b7280" style={{ textTransform: 'uppercase', fontWeight: '700', marginBottom: 8 }}>
        {title}
      </MonoText>
      <Text style={{
        fontSize: 26,
        lineHeight: 31,
        color,
        fontFamily: 'SpaceMono-Regular',
        fontWeight: '700',
      }}>
        {clamped.toFixed(1)}%
      </Text>
      <MetricBar value={clamped} color={color} height={4} style={{ marginVertical: 9 }} />
      {detail ? <MonoText size={10} color="#d4dae3" numberOfLines={1}>{detail}</MonoText> : null}
      {children ? <View style={{ marginTop: 7, gap: 4 }}>{children}</View> : null}
      {timestamp ? <MonoText size={8} color="#3a4555" style={{ marginTop: 'auto' }}>{formatTs(timestamp, 'HH:mm:ss')}</MonoText> : null}
    </Card>
  )
}

function ChartCard({
  title,
  subtitle,
  data,
  color,
  suffix,
}: {
  title: string
  subtitle: string
  data: number[]
  color: string
  suffix: string
}) {
  const latest = data.length ? data[data.length - 1] : null
  const max = data.length ? Math.max(...data, 0) : 0
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <View style={{
        paddingHorizontal: 12,
        paddingTop: 12,
        paddingBottom: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#1e252e',
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 10,
      }}>
        <View style={{ flex: 1 }}>
          <MonoText size={10} color="#6b7280" style={{ textTransform: 'uppercase', fontWeight: '700' }}>{title}</MonoText>
          <MonoText size={9} color="#3a4555">{subtitle}</MonoText>
        </View>
        <MonoText size={11} color={color} style={{ fontWeight: '700' }}>
          {latest == null ? '--' : `${latest.toFixed(suffix === '%' ? 1 : 0)}${suffix}`}
        </MonoText>
      </View>
      {data.length < 2 ? (
        <EmptyState label="No data for selected range" icon="⌁" />
      ) : (
        <View style={{ height: 190, padding: 12 }}>
          <LineChart
            style={{ flex: 1 }}
            data={data.map(v => Math.max(0, v))}
            svg={{ stroke: color, strokeWidth: 2 }}
            contentInset={{ top: 12, bottom: 12, left: 4, right: 4 }}
          >
            <Grid svg={{ stroke: '#1e252e' }} />
          </LineChart>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
            <MonoText size={9} color="#3a4555">{data.length} points</MonoText>
            <MonoText size={9} color="#3a4555">max {max.toFixed(suffix === '%' ? 1 : 0)}{suffix}</MonoText>
          </View>
        </View>
      )}
    </Card>
  )
}

function InterfaceMiniCard({ iface }: { iface: NetworkData['interfaces'][number] }) {
  return (
    <View style={{
      borderWidth: 1,
      borderColor: '#1e252e',
      borderRadius: 8,
      overflow: 'hidden',
      backgroundColor: '#0d1117',
    }}>
      <View style={{ paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1e252e' }}>
        <MonoText size={11} color="#d4dae3" style={{ fontWeight: '700' }} numberOfLines={1}>{iface.name}</MonoText>
      </View>
      <View style={{ flexDirection: 'row' }}>
        <View style={{ flex: 1, padding: 9, borderRightWidth: 1, borderRightColor: '#1e252e' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <ArrowDownRight size={12} color="#22c55e" />
            <MonoText size={9} color="#6b7280">In</MonoText>
          </View>
          <MonoText size={11} color="#d4dae3">{formatBandwidth(iface.rx_bytes_rate)}</MonoText>
        </View>
        <View style={{ flex: 1, padding: 9 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <ArrowUpRight size={12} color="#3b82f6" />
            <MonoText size={9} color="#6b7280">Out</MonoText>
          </View>
          <MonoText size={11} color="#d4dae3">{formatBandwidth(iface.tx_bytes_rate)}</MonoText>
        </View>
      </View>
    </View>
  )
}

function StorageLayout({
  disks,
  partitions,
}: {
  disks: StorageDisk[]
  partitions: StoragePartition[]
}) {
  if (!disks.length && !partitions.length) return null

  const partitionsByDisk = partitions.reduce<Record<string, StoragePartition[]>>((acc, part) => {
    const key = part.parent_disk ?? part.device ?? part.name
    acc[key] = [...(acc[key] ?? []), part]
    return acc
  }, {})

  const treeDisks = disks.length
    ? disks
    : Object.entries(partitionsByDisk).map(([key, parts]) => {
        const total = parts.reduce((sum, part) => sum + safeNumber(part.total_bytes), 0)
        const used = parts.reduce((sum, part) => sum + safeNumber(part.used_bytes), 0)
        return {
          device: key,
          name: key,
          fs_type: Array.from(new Set(parts.map(part => part.fs_type))).join(', ') || 'unknown',
          total_bytes: total,
          used_bytes: used,
          free_bytes: Math.max(total - used, 0),
          usage_pct: total > 0 ? (used / total) * 100 : 0,
          is_removable: parts.every(part => part.is_removable),
          mount_points: parts.map(part => part.mount_point),
          partition_count: parts.length,
          partitions: parts,
        } as StorageDisk
      })

  return (
    <Card>
      <SectionHeader title="Storage layout" count={treeDisks.length} />
      <View style={{ gap: 10 }}>
        {treeDisks.map((disk, diskIdx) => {
          const parts = partitionsByDisk[disk.device] ?? disk.partitions ?? []
          const pct = clamp(safeNumber(disk.usage_pct), 0, 100)
          const color = SERIES_COLORS[diskIdx % SERIES_COLORS.length]
          return (
            <View key={disk.device} style={{ borderWidth: 1, borderColor: '#1e252e', borderRadius: 8, padding: 10, gap: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <MonoText size={12} color="#d4dae3" style={{ fontWeight: '700' }} numberOfLines={1}>{disk.name || disk.device}</MonoText>
                  <MonoText size={9} color="#6b7280" numberOfLines={1}>{disk.mount_points?.join(', ') || disk.fs_type || 'unknown'}</MonoText>
                </View>
                <MonoText size={11} color={color}>{formatPct(pct)}</MonoText>
              </View>
              <MetricBar value={pct} color={color} height={4} />
              <StatLine label="Used" value={`${formatBytes(disk.used_bytes)} / ${formatBytes(disk.total_bytes)}`} />
              {parts.map((part, idx) => {
                const partPct = clamp(safeNumber(part.usage_pct), 0, 100)
                return (
                  <View key={`${part.device}-${idx}`} style={{ paddingLeft: 10, borderLeftWidth: 1, borderLeftColor: '#1e252e', gap: 5 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                      <MonoText size={10} color="#d4dae3" numberOfLines={1}>{part.mount_point || part.name}</MonoText>
                      <MonoText size={10} color="#6b7280">{part.fs_type}</MonoText>
                    </View>
                    <MetricBar value={partPct} color={SERIES_COLORS[(diskIdx + idx + 1) % SERIES_COLORS.length]} height={3} />
                  </View>
                )
              })}
            </View>
          )
        })}
      </View>
    </Card>
  )
}

export function MetricsScreen() {
  const qc = useQueryClient()
  const { palette: c } = useTheme()
  const { role } = useAuthStore()
  const canControl = role === 'administrator' || role === 'moderator'
  const [selectedAgent, setSelectedAgent] = useState<string>('')
  const [metricType, setMetricType] = useState<MetricType>('cpu')
  const [timeRangeIdx, setTimeRangeIdx] = useState(1)
  const [storageView, setStorageView] = useState<'partitions' | 'disks'>('partitions')
  const [procSearch, setProcSearch] = useState('')
  const [procMinCpu, setProcMinCpu] = useState(0)
  const [procGrouping, setProcGrouping] = useState<'flat' | 'byExe'>('flat')

  const agentsQ = useQuery({
    queryKey: ['agents-brief'],
    queryFn: () => agentsApi.list().then(r => r.data),
  })

  const agents = agentsQ.data ?? []

  useEffect(() => {
    if (!agents.length) {
      if (selectedAgent) setSelectedAgent('')
      return
    }
    if (!selectedAgent || !agents.some(agent => agent.agent_id === selectedAgent)) {
      setSelectedAgent(agents[0].agent_id)
    }
  }, [agents, selectedAgent])

  const timeRange = TIME_RANGES[timeRangeIdx]
  const telemetryParams = useMemo(() => ({
    agent_id: selectedAgent,
    metric_type: metricType,
    resolution: timeRange.resolution,
    start: isoAgo(timeRange.hours),
    limit: 1000,
  }), [metricType, selectedAgent, timeRange])

  const telemetryQ = useTelemetry(telemetryParams, !!selectedAgent)
  const liveMetrics = useLiveMetrics(selectedAgent || null)
  const latest = liveMetrics.latest

  const killMutation = useMutation({
    mutationFn: ({ agentId, pid }: { agentId: string; pid: number }) => agentsApi.killProcess(agentId, pid),
    onSuccess: (_res, vars) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      Alert.alert('Kill dispatched', `PID ${vars.pid} sent to agent.`)
    },
    onError: (err: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      Alert.alert('Kill failed', err.message)
    },
  })

  const onRefresh = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    qc.invalidateQueries({ queryKey: ['agents-brief'] })
    qc.invalidateQueries({ queryKey: ['telemetry'] })
  }, [qc])

  const setMetric = useCallback((type: MetricType) => {
    setMetricType(type)
    Haptics.selectionAsync()
  }, [])

  const setRange = useCallback((idx: number) => {
    setTimeRangeIdx(idx)
    Haptics.selectionAsync()
  }, [])

  const series = telemetryQ.data ?? []
  const sortedSeries = useMemo(
    () => [...series].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
    [series],
  )

  const cpu = latest.cpu?.data as unknown as CpuData | undefined
  const ram = latest.ram?.data as unknown as RamData | undefined
  const gpu = latest.gpu?.data as unknown as GpuData | undefined
  const network = latest.network?.data as unknown as NetworkData | undefined
  const storage = latest.storage?.data as unknown as StorageData | undefined
  const processData = latest.process?.data as unknown as ProcessData | undefined
  const kernel = latest.kernel?.data as unknown as KernelData | undefined

  const storagePartitions = useMemo(() => {
    if (!storage) return [] as StoragePartition[]
    return storage.partitions?.length ? storage.partitions : storage.filesystems ?? []
  }, [storage])
  const storageDisks = storage?.disks ?? []
  const rootDisk = storage?.os_disk ?? storageDisks[0] ?? (storagePartitions[0]
    ? {
        device: storagePartitions[0].device,
        name: storagePartitions[0].name,
        fs_type: storagePartitions[0].fs_type,
        total_bytes: storagePartitions[0].total_bytes,
        used_bytes: storagePartitions[0].used_bytes,
        free_bytes: storagePartitions[0].free_bytes,
        usage_pct: storagePartitions[0].usage_pct,
        is_removable: storagePartitions[0].is_removable,
        mount_points: [storagePartitions[0].mount_point],
        partition_count: 1,
        partitions: [storagePartitions[0]],
      } as StorageDisk
    : undefined)
  const primaryInterface = network?.interfaces?.find(iface => iface.name !== 'lo') ?? network?.interfaces?.[0]

  const chartData = useMemo(() => {
    if (!sortedSeries.length) return [] as number[]
    if (metricType === 'cpu' || metricType === 'ram') {
      return sortedSeries.map(metric => safeNumber((metric.data as { usage_pct?: number }).usage_pct))
    }
    if (metricType === 'gpu') {
      return sortedSeries.map(metric => safeNumber((metric.data as unknown as GpuData).summary?.avg_utilization_pct))
    }
    if (metricType === 'storage') {
      return sortedSeries.map(metric => {
        const payload = metric.data as unknown as StorageData
        const list = storageView === 'disks'
          ? payload.disks ?? []
          : (payload.partitions?.length ? payload.partitions : payload.filesystems ?? [])
        return safeNumber(list[0]?.usage_pct)
      })
    }
    if (metricType === 'network') {
      return sortedSeries.map(metric => {
        const payload = metric.data as unknown as NetworkData
        const iface = payload.interfaces?.find(item => item.name !== 'lo') ?? payload.interfaces?.[0]
        return safeNumber(iface?.rx_bytes_rate) / 1024
      })
    }
    return []
  }, [metricType, sortedSeries, storageView])

  const networkTxChart = useMemo(() => {
    if (metricType !== 'network') return []
    return sortedSeries.map(metric => {
      const payload = metric.data as unknown as NetworkData
      const iface = payload.interfaces?.find(item => item.name !== 'lo') ?? payload.interfaces?.[0]
      return safeNumber(iface?.tx_bytes_rate) / 1024
    })
  }, [metricType, sortedSeries])

  const dedupedProcesses = useMemo(() => {
    const rows = processData?.processes ?? []
    const byPid = new Map<number, ProcessData['processes'][number]>()
    rows.forEach(row => {
      const existing = byPid.get(row.pid)
      if (!existing || safeNumber(row.cpu_pct) > safeNumber(existing.cpu_pct)) {
        byPid.set(row.pid, row)
      }
    })
    return Array.from(byPid.values())
  }, [processData])

  const filteredProcesses = useMemo(() => {
    const term = procSearch.trim().toLowerCase()
    return dedupedProcesses
      .filter(row => safeNumber(row.cpu_pct) >= procMinCpu)
      .filter(row => !term
        || String(row.pid).includes(term)
        || row.name.toLowerCase().includes(term)
        || (row.exe ?? '').toLowerCase().includes(term))
      .sort((a, b) => safeNumber(b.cpu_pct) - safeNumber(a.cpu_pct))
      .slice(0, 60)
  }, [dedupedProcesses, procMinCpu, procSearch])

  const processGroups = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; cpu: number; mem: number; count: number; pids: number[] }>()
    filteredProcesses.forEach(row => {
      const key = (row.exe || row.name || 'unknown').toLowerCase()
      const existing = groups.get(key)
      if (!existing) {
        groups.set(key, {
          key,
          label: row.exe || row.name || 'unknown',
          cpu: safeNumber(row.cpu_pct),
          mem: safeNumber(row.mem_bytes),
          count: 1,
          pids: [row.pid],
        })
      } else {
        existing.cpu += safeNumber(row.cpu_pct)
        existing.mem += safeNumber(row.mem_bytes)
        existing.count += 1
        existing.pids.push(row.pid)
      }
    })
    return Array.from(groups.values()).sort((a, b) => b.cpu - a.cpu)
  }, [filteredProcesses])

  const confirmKill = useCallback((pid: number, name: string) => {
    if (!canControl) {
      Alert.alert('Not permitted', 'Only administrators and moderators can kill processes.')
      return
    }
    if (!selectedAgent) return
    Alert.alert('Kill process', `Send kill to PID ${pid} (${name || 'process'})?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Kill',
        style: 'destructive',
        onPress: () => killMutation.mutate({ agentId: selectedAgent, pid }),
      },
    ])
  }, [canControl, killMutation, selectedAgent])

  const confirmKillGroup = useCallback((label: string, pids: number[]) => {
    if (!canControl) {
      Alert.alert('Not permitted', 'Only administrators and moderators can kill processes.')
      return
    }
    if (!selectedAgent || !pids.length) return
    Alert.alert('Kill process group', `Send kill to ${pids.length} process(es) for ${label}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Kill all',
        style: 'destructive',
        onPress: () => pids.forEach(pid => killMutation.mutate({ agentId: selectedAgent, pid })),
      },
    ])
  }, [canControl, killMutation, selectedAgent])

  const chartTitle = `${METRIC_OPTIONS.find(o => o.value === metricType)?.label ?? 'Metric'} - ${timeRange.label}`
  const chartSuffix = metricType === 'network' ? 'KB/s' : '%'

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 12, gap: 8 }}>
          {agents.map(agent => {
            const active = selectedAgent === agent.agent_id
            return (
              <TouchableOpacity
                key={agent.agent_id}
                activeOpacity={0.82}
                onPress={() => {
                  setSelectedAgent(agent.agent_id)
                  Haptics.selectionAsync()
                }}
                style={{
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: active ? c.primary : c.border,
                  backgroundColor: active ? c.primary + '22' : 'transparent',
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                }}
              >
                <MonoText size={11} color={active ? c.primary : c.textMuted}>{agent.hostname}</MonoText>
              </TouchableOpacity>
            )
          })}
          {!agents.length && <MonoText size={11} color={c.textMuted}>No agents</MonoText>}
        </ScrollView>
      </View>

      {!selectedAgent ? (
        <EmptyState label={agentsQ.isLoading ? 'Loading agents...' : 'Select an agent'} icon="◎" />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 14 }}
          refreshControl={<RefreshControl refreshing={telemetryQ.isFetching} onRefresh={onRefresh} tintColor="#3b82f6" />}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <View>
              <MonoText size={16} style={{ fontWeight: '700' }}>metrics</MonoText>
              <MonoText size={11} color={c.textMuted}>Historical and live telemetry</MonoText>
            </View>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={onRefresh}
              style={{
                borderWidth: 1,
                borderColor: c.border,
                borderRadius: 8,
                paddingHorizontal: 12,
                paddingVertical: 8,
              }}
            >
              <MonoText size={11} color={c.text}>Refresh</MonoText>
            </TouchableOpacity>
          </View>

          <View style={{ gap: 8 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7 }}>
              {METRIC_OPTIONS.map(option => (
                <Chip
                  key={option.value}
                  label={option.label}
                  active={metricType === option.value}
                  color={option.color}
                  onPress={() => setMetric(option.value)}
                />
              ))}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7 }}>
              {TIME_RANGES.map((range, idx) => (
                <Chip
                  key={range.label}
                  label={range.label}
                  active={timeRangeIdx === idx}
                  color={metricColor(metricType)}
                  onPress={() => setRange(idx)}
                />
              ))}
              {metricType === 'storage' && (
                <>
                  <Chip label="Partitions" active={storageView === 'partitions'} color="#f97316" onPress={() => { setStorageView('partitions'); Haptics.selectionAsync() }} />
                  <Chip label="Disks" active={storageView === 'disks'} color="#f97316" onPress={() => { setStorageView('disks'); Haptics.selectionAsync() }} />
                </>
              )}
            </ScrollView>
          </View>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            {cpu ? (
              <GaugeCard title="CPU" value={cpu.usage_pct} detail={`${cpu.core_count} cores`} timestamp={latest.cpu?.timestamp}>
                <StatLine label="Load" value={cpu.load_avg_1m.toFixed(2)} />
              </GaugeCard>
            ) : null}
            {ram ? (
              <GaugeCard title="RAM" value={ram.usage_pct} detail={`${formatBytes(ram.used_bytes)} / ${formatBytes(ram.total_bytes)}`} timestamp={latest.ram?.timestamp}>
                {ram.swap.total_bytes > 0 ? <StatLine label="Swap" value={formatPct(ram.swap.usage_pct)} /> : null}
              </GaugeCard>
            ) : null}
          </View>

          {(gpu && !gpu.collector_disabled && gpu.gpus.length > 0) || primaryInterface || rootDisk ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {gpu && !gpu.collector_disabled && gpu.gpus.length > 0 ? (
                <View style={{ width: '48%' }}>
                  <GaugeCard title="GPU" value={gpu.summary.avg_utilization_pct} detail={`${gpu.gpus.length} device${gpu.gpus.length > 1 ? 's' : ''}`}>
                    <StatLine label="Mem avg" value={formatPct(gpu.summary.avg_mem_utilization_pct, 0)} />
                  </GaugeCard>
                </View>
              ) : null}
              {primaryInterface ? (
                <Card style={{ width: '48%', minHeight: 150 }}>
                  <MonoText size={10} color="#6b7280" style={{ textTransform: 'uppercase', fontWeight: '700', marginBottom: 8 }}>Network</MonoText>
                  <MonoText size={12} color="#d4dae3" style={{ marginBottom: 8 }} numberOfLines={1}>{primaryInterface.name}</MonoText>
                  <StatLine label="RX" value={formatBandwidth(primaryInterface.rx_bytes_rate)} color="#22c55e" />
                  <StatLine label="TX" value={formatBandwidth(primaryInterface.tx_bytes_rate)} color="#3b82f6" />
                  <StatLine label="TCP" value={String(network?.tcp?.established ?? 0)} />
                </Card>
              ) : null}
              {rootDisk ? (
                <View style={{ width: '48%' }}>
                  <GaugeCard title="Disk" value={rootDisk.usage_pct} detail={rootDisk.mount_points?.[0] ?? rootDisk.name}>
                    <StatLine label="Used" value={`${formatBytes(rootDisk.used_bytes)} / ${formatBytes(rootDisk.total_bytes)}`} />
                  </GaugeCard>
                </View>
              ) : null}
            </View>
          ) : null}

          {telemetryQ.isLoading ? (
            <Card><LoadingState label="Loading telemetry..." /></Card>
          ) : metricType === 'network' ? (
            <View style={{ gap: 12 }}>
              <ChartCard title="Ingress" subtitle={`${timeRange.resolution} · ${chartData.length} points`} data={chartData} color="#22c55e" suffix="KB/s" />
              <ChartCard title="Egress" subtitle={`${timeRange.resolution} · ${networkTxChart.length} points`} data={networkTxChart} color="#3b82f6" suffix="KB/s" />
            </View>
          ) : (
            <ChartCard
              title={chartTitle}
              subtitle={`${timeRange.resolution} · ${sortedSeries.length} points`}
              data={chartData}
              color={metricColor(metricType)}
              suffix={chartSuffix}
            />
          )}

          {metricType === 'network' && network?.interfaces?.filter(iface => iface.name !== 'lo').length ? (
            <Card>
              <SectionHeader title="Interfaces" count={network.interfaces.filter(iface => iface.name !== 'lo').length} />
              <View style={{ gap: 8 }}>
                {network.interfaces.filter(iface => iface.name !== 'lo').map(iface => <InterfaceMiniCard key={iface.name} iface={iface} />)}
              </View>
            </Card>
          ) : null}

          {metricType === 'storage' ? (
            <StorageLayout disks={storageDisks} partitions={storagePartitions} />
          ) : null}

          {metricType === 'cpu' && (processData?.processes?.length ?? 0) > 0 ? (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              <View style={{ padding: 12, gap: 10, borderBottomWidth: 1, borderBottomColor: c.border }}>
                <SectionHeader title="Processes" count={filteredProcesses.length} />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput
                    value={procSearch}
                    onChangeText={setProcSearch}
                    placeholder="Search by name or pid"
                    placeholderTextColor="#3a4555"
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={{
                      flex: 1,
                      borderWidth: 1,
                      borderColor: c.border,
                      backgroundColor: c.inputBg,
                      color: c.text,
                      borderRadius: 7,
                      paddingHorizontal: 10,
                      paddingVertical: 8,
                      fontFamily: 'SpaceMono-Regular',
                      fontSize: 11,
                    }}
                  />
                  <TouchableOpacity
                    onPress={() => {
                      setProcMinCpu(prev => (prev >= 25 ? 0 : prev + 5))
                      Haptics.selectionAsync()
                    }}
                    style={{ borderWidth: 1, borderColor: c.border, borderRadius: 7, paddingHorizontal: 10, justifyContent: 'center' }}
                  >
                    <MonoText size={10} color={c.textMuted}>CPU {procMinCpu}%</MonoText>
                  </TouchableOpacity>
                </View>
                <View style={{ flexDirection: 'row', gap: 7 }}>
                  <Chip label="Flat list" active={procGrouping === 'flat'} color="#3b82f6" onPress={() => { setProcGrouping('flat'); Haptics.selectionAsync() }} />
                  <Chip label="Group by exe" active={procGrouping === 'byExe'} color="#3b82f6" onPress={() => { setProcGrouping('byExe'); Haptics.selectionAsync() }} />
                </View>
              </View>

              {procGrouping === 'byExe' ? (
                processGroups.map(group => (
                  <View key={group.key} style={{ padding: 10, borderBottomWidth: 1, borderBottomColor: '#1e252e', gap: 5 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <MonoText size={11} color="#d4dae3" numberOfLines={1}>{group.label}</MonoText>
                        <MonoText size={9} color="#6b7280">{group.count} proc · {formatBytes(group.mem)}</MonoText>
                      </View>
                      <MonoText size={11} color={gaugeColor(group.cpu)}>{formatPct(group.cpu)}</MonoText>
                    </View>
                    <TouchableOpacity onPress={() => confirmKillGroup(group.label, group.pids)} disabled={killMutation.isPending} style={{ alignSelf: 'flex-end' }}>
                      <MonoText size={10} color="#ef4444">Kill all</MonoText>
                    </TouchableOpacity>
                  </View>
                ))
              ) : (
                filteredProcesses.map(proc => (
                  <View key={`${proc.pid}-${proc.start_time}`} style={{ padding: 10, borderBottomWidth: 1, borderBottomColor: '#1e252e', gap: 4 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <MonoText size={11} color="#d4dae3" numberOfLines={1}>{proc.name || 'process'} · {proc.pid}</MonoText>
                        <MonoText size={9} color="#6b7280" numberOfLines={1}>{proc.exe || 'unknown exe'}</MonoText>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <MonoText size={11} color={gaugeColor(proc.cpu_pct)}>{formatPct(proc.cpu_pct)}</MonoText>
                        <MonoText size={9} color="#6b7280">{formatBytes(proc.mem_bytes)}</MonoText>
                      </View>
                    </View>
                    <TouchableOpacity onPress={() => confirmKill(proc.pid, proc.name)} disabled={killMutation.isPending} style={{ alignSelf: 'flex-end' }}>
                      <MonoText size={10} color="#ef4444">Kill</MonoText>
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </Card>
          ) : null}

          {kernel ? (
            <Card>
              <SectionHeader title="System info" />
              <View style={{ gap: 7 }}>
                <StatLine label="Kernel" value={kernel.kernel_version} />
                <StatLine label="OS" value={kernel.os_version} />
                <StatLine label="Uptime" value={formatUptime(kernel.uptime_secs)} />
                <StatLine label="CPUs" value={String(kernel.cpu_count)} />
              </View>
            </Card>
          ) : null}

          {!Object.keys(latest).length && !telemetryQ.isLoading ? (
            <EmptyState label="No metrics available for this agent" icon="▦" />
          ) : null}
        </ScrollView>
      )}
    </View>
  )
}
