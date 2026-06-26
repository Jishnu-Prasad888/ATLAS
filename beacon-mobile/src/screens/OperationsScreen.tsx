import React, {
  useState, useMemo, useCallback, useRef,
} from 'react'
import {
  View, Text, TouchableOpacity, ScrollView, FlatList, RefreshControl, TextInput,
} from 'react-native'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as Haptics from 'expo-haptics'
import { agentsApi, telemetryApi, logsApi } from '@/api/endpoints'
import {
  Agent, Metric, LogEntry, NetworkData, NetworkInterface, ProcessConnection, OpenPort,
} from '@/types'
import {
  Card, SectionHeader, MonoText, LoadingState, EmptyState, Badge, StatusDot,
} from '@/components/common'
import { statusColor, severityColor, timeAgo, formatTs, formatBytes, formatPct, formatBandwidth } from '@/utils/format'
import { useTheme } from '@/theme'
import {
  ArrowDownRight, ArrowUpRight, ArrowUpToLine, ChevronDown, ChevronUp, Search, Maximize2,
} from 'lucide-react-native'

const DOCKER_SOURCES = new Set(['docker', 'docker_engine'])
const K8S_SOURCES = new Set(['kubernetes', 'k3s_engine'])
const COLLECTOR_SOURCES = new Set<string>([...DOCKER_SOURCES, ...K8S_SOURCES])

function useOpsColors() {
  const { palette: c } = useTheme()
  const light = c.mode === 'light'
  return {
    c,
    border: c.border,
    borderSoft: light ? '#93c5fd' : '#25303b',
    surface: c.surface,
    surface2: c.surface2,
    rowA: light ? '#ffffff' : '#0d1117',
    rowB: light ? '#eef6ff' : '#10151c',
    header: light ? '#dbeafe' : '#12171d',
    input: c.inputBg,
    text: c.text,
    dim: c.textDim,
    muted: c.textMuted,
    greenCell: light ? '#dcfce7' : '#102019',
    blueCell: light ? '#dbeafe' : '#0f1a2b',
    cyanCell: light ? '#e0f2fe' : '#0e1a22',
    purpleCell: light ? '#ede9fe' : '#171529',
  }
}

function AgentRow({
  agent,
  selected,
  onPress,
  hasDockerData,
  hasK8sData,
  hasNetworkData,
}: {
  agent: Agent
  selected: boolean
  onPress: () => void
  hasDockerData?: boolean
  hasK8sData?: boolean
  hasNetworkData?: boolean
}) {
  const oc = useOpsColors()
  const color = statusColor(agent.status)
  const tags = [
    hasDockerData ? 'Docker' : null,
    hasK8sData ? 'Kubernetes' : null,
    hasNetworkData ? 'Network' : null,
  ].filter(Boolean) as string[]
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={{
        padding: 12,
        borderBottomWidth: 1,
        borderBottomColor: oc.border,
        backgroundColor: selected ? oc.c.primary + '18' : 'transparent',
        borderLeftWidth: 2,
        borderLeftColor: selected ? oc.c.warning : 'transparent',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <StatusDot color={color} size={8} />
        <MonoText size={13} style={{ flex: 1, fontWeight: '700' }}>{agent.hostname}</MonoText>
        <Badge label={agent.status.toLowerCase()} color={color} bg={color + '22'} />
      </View>
      {tags.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 7 }}>
          {tags.map(tag => (
            <Badge key={tag} label={tag} color={oc.c.chipText} bg={oc.c.chipBg} />
          ))}
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, alignItems: 'center' }}>
        <MonoText size={10} color={oc.muted}>{timeAgo(agent.last_seen)}</MonoText>
      </View>
    </TouchableOpacity>
  )
}

function CollectorLogRow({ log }: { log: LogEntry }) {
  const oc = useOpsColors()
  const color = severityColor(log.severity)
  return (
    <View style={{ paddingVertical: 8, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: oc.border, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
      <View style={{
        paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
        borderWidth: 1, borderColor: oc.border, backgroundColor: oc.surface2,
      }}>
        <MonoText size={9} color={oc.muted} style={{ textTransform: 'uppercase' }}>
          {DOCKER_SOURCES.has(log.source) ? 'Docker' : K8S_SOURCES.has(log.source) ? 'K8s' : log.source}
        </MonoText>
      </View>
      <MonoText size={10} color={color} style={{ textTransform: 'uppercase' }}>{log.severity}</MonoText>
      <MonoText size={10} color={oc.muted}>{formatTs(log.timestamp, 'HH:mm:ss')}</MonoText>
      <MonoText size={11} color={oc.text} style={{ flex: 1 }}>{log.message}</MonoText>
    </View>
  )
}

const toNumber = (v: unknown): number | null => (typeof v === 'number' && !Number.isNaN(v) ? v : null)
const pick = (obj: any, keys: string[]): any => keys.reduce((acc, k) => (acc != null ? acc : obj?.[k]), null)

function LabeledStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  const oc = useOpsColors()
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <MonoText size={11} color={oc.muted}>{label}</MonoText>
      <MonoText size={12} color={accent ?? oc.text}>{value}</MonoText>
    </View>
  )
}

function DockerCard({ metric, loading }: { metric?: Metric; loading: boolean }) {
  const oc = useOpsColors()
  const data = metric?.data as Record<string, unknown> | undefined
  const running = toNumber(pick(data, ['containers_running', 'running']))
  const total = toNumber(pick(data, ['containers_total', 'total']))
  const images = toNumber(pick(data, ['images']))
  const cpu = toNumber(pick(data, ['cpu_pct', 'cpu']))
  const memPct = toNumber(pick(data, ['mem_pct', 'memory_pct']))
  const memBytes = toNumber(pick(data, ['mem_bytes', 'memory_bytes', 'mem_used_bytes']))
  const pids = toNumber(pick(data, ['pids']))

  return (
    <Card style={{ flex: 1 }}>
      <SectionHeader
        title="Docker"
        right={metric ? <MonoText size={9} color={oc.muted}>{formatTs(metric.timestamp, 'HH:mm:ss')}</MonoText> : null}
      />
      {loading ? (
        <LoadingState label="Loading docker…" />
      ) : !data ? (
        <EmptyState label="No docker metrics" icon="▦" />
      ) : (
        <View style={{ gap: 8 }}>
          <LabeledStat label="Containers" value={`${running ?? '–'} / ${total ?? '–'}`} accent="#3b82f6" />
          <LabeledStat label="Images" value={images != null ? images.toString() : '–'} />
          <LabeledStat label="CPU" value={cpu != null ? formatPct(cpu) : '–'} accent="#22c55e" />
          <LabeledStat label="Memory" value={memPct != null ? formatPct(memPct) : '–'} accent="#f97316" />
          <LabeledStat label="Mem used" value={memBytes != null ? formatBytes(memBytes) : '–'} />
          <LabeledStat label="PIDs" value={pids != null ? pids.toString() : '–'} />
        </View>
      )}
    </Card>
  )
}

function KubernetesCard({ metric, loading }: { metric?: Metric; loading: boolean }) {
  const oc = useOpsColors()
  const data = metric?.data as Record<string, unknown> | undefined
  const nodes = toNumber(pick(data, ['nodes', 'node_count']))
  const pods = toNumber(pick(data, ['pods', 'pod_count']))
  const namespaces = toNumber(pick(data, ['namespaces']))
  const deployments = toNumber(pick(data, ['deployments']))
  const cpuPct = toNumber(pick(data, ['cpu_pct', 'cpu_usage_pct']))
  const memPct = toNumber(pick(data, ['mem_pct', 'memory_pct']))

  return (
    <Card style={{ flex: 1 }}>
      <SectionHeader
        title="Kubernetes"
        right={metric ? <MonoText size={9} color={oc.muted}>{formatTs(metric.timestamp, 'HH:mm:ss')}</MonoText> : null}
      />
      {loading ? (
        <LoadingState label="Loading k8s…" />
      ) : !data ? (
        <EmptyState label="No k8s metrics" icon="◈" />
      ) : (
        <View style={{ gap: 8 }}>
          <LabeledStat label="Nodes" value={nodes != null ? nodes.toString() : '–'} accent="#3b82f6" />
          <LabeledStat label="Pods" value={pods != null ? pods.toString() : '–'} accent="#22c55e" />
          <LabeledStat label="Namespaces" value={namespaces != null ? namespaces.toString() : '–'} />
          <LabeledStat label="Deployments" value={deployments != null ? deployments.toString() : '–'} />
          <LabeledStat label="CPU" value={cpuPct != null ? formatPct(cpuPct) : '–'} accent="#22c55e" />
          <LabeledStat label="Memory" value={memPct != null ? formatPct(memPct) : '–'} accent="#f97316" />
        </View>
      )}
    </Card>
  )
}

type OpsView = 'docker' | 'kubernetes' | 'network'

const STATE_COLOR: Record<string, string> = {
  ESTABLISHED: '#22c55e',
  LISTEN: '#3b82f6',
  TIME_WAIT: '#f97316',
  CLOSE_WAIT: '#f97316',
  SYN_SENT: '#eab308',
  SYN_RECV: '#eab308',
  FIN_WAIT1: '#eab308',
  FIN_WAIT2: '#eab308',
  CLOSE: '#9ca3af',
  LAST_ACK: '#9ca3af',
  CLOSING: '#9ca3af',
}

const stateTone = (state?: string) => {
  const normalized = (state ?? 'unknown').toUpperCase()
  if (normalized === 'UP') return '#22c55e'
  if (normalized === 'DOWN' || normalized === 'LOWERLAYERDOWN') return '#ef4444'
  return STATE_COLOR[normalized] ?? '#eab308'
}

const protoTone = (protocol?: string) => (protocol?.toLowerCase().startsWith('udp') ? '#22c55e' : '#3b82f6')
const endpoint = (addr?: string, port?: number) => `${addr ?? '0.0.0.0'}:${port ?? 0}`

function Pill({ label, color, filled = true }: { label: string; color: string; filled?: boolean }) {
  return (
    <View style={{
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: color + '55',
      backgroundColor: filled ? color + '1f' : 'transparent',
    }}>
      <MonoText size={9} color={color} style={{ textTransform: 'uppercase', fontWeight: '700' }} numberOfLines={1}>
        {label}
      </MonoText>
    </View>
  )
}

function ViewTabs({
  view,
  onChange,
  disabled,
}: {
  view: OpsView
  onChange: (view: OpsView) => void
  disabled: Partial<Record<OpsView, boolean>>
}) {
  const { c } = useOpsColors()
  const tabs: Array<{ key: OpsView; label: string; color: string }> = [
    { key: 'docker', label: 'Docker', color: '#38bdf8' },
    { key: 'kubernetes', label: 'Kubernetes', color: '#a78bfa' },
    { key: 'network', label: 'Network', color: '#22c55e' },
  ]
  return (
    <View style={{
      flexDirection: 'row',
      gap: 6,
      backgroundColor: c.surface2,
      borderWidth: 1,
      borderColor: c.border,
      padding: 4,
      borderRadius: 8,
    }}>
      {tabs.map(tab => {
        const active = view === tab.key
        const isDisabled = disabled[tab.key]
        return (
          <TouchableOpacity
            key={tab.key}
            disabled={isDisabled}
            activeOpacity={0.82}
            onPress={() => onChange(tab.key)}
            style={{
              flex: 1,
              minHeight: 32,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 6,
              borderWidth: 1,
              borderColor: active ? tab.color : 'transparent',
              backgroundColor: active ? tab.color + '16' : 'transparent',
              opacity: isDisabled ? 0.42 : 1,
            }}
          >
            <MonoText size={10} color={active ? tab.color : c.textMuted} style={{ fontWeight: active ? '700' : '500' }}>
              {tab.label}
            </MonoText>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

function NetworkInterfaceCard({ iface }: { iface: NetworkInterface }) {
  const oc = useOpsColors()
  const addresses = iface.addresses ?? []
  const color = stateTone(iface.state)
  return (
    <View style={{
      borderWidth: 1,
      borderColor: oc.border,
      borderRadius: 8,
      overflow: 'hidden',
      backgroundColor: oc.rowA,
    }}>
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: oc.borderSoft,
      }}>
        <MonoText size={12} color={oc.text} style={{ flex: 1, fontWeight: '700' }} numberOfLines={1}>
          {iface.name}
        </MonoText>
        <Pill label={iface.state ?? 'unknown'} color={color} />
      </View>

      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: oc.borderSoft }}>
        <View style={{ flex: 1, padding: 8, backgroundColor: oc.surface2, borderRightWidth: 1, borderRightColor: oc.borderSoft }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <ArrowDownRight size={13} color={oc.muted} />
              <MonoText size={10} color={oc.muted}>In</MonoText>
            </View>
            <MonoText size={10} color={oc.text} style={{ fontWeight: '700' }}>{formatBandwidth(iface.rx_bytes_rate ?? 0)}</MonoText>
          </View>
        </View>
        <View style={{ flex: 1, padding: 8, backgroundColor: oc.surface2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <ArrowUpRight size={13} color={oc.muted} />
              <MonoText size={10} color={oc.muted}>Out</MonoText>
            </View>
            <MonoText size={10} color={oc.text} style={{ fontWeight: '700' }}>{formatBandwidth(iface.tx_bytes_rate ?? 0)}</MonoText>
          </View>
        </View>
      </View>

      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: oc.borderSoft }}>
        <View style={{ flex: 1, paddingHorizontal: 10, paddingVertical: 6, borderRightWidth: 1, borderRightColor: oc.borderSoft }}>
          <LabeledStat label="MTU" value={iface.mtu != null ? String(iface.mtu) : '–'} />
        </View>
        <View style={{ flex: 1, paddingHorizontal: 10, paddingVertical: 6 }}>
          <LabeledStat label="qdisc" value={iface.qdisc ?? '–'} />
        </View>
      </View>

      <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderBottomWidth: addresses.length ? 1 : 0, borderBottomColor: oc.borderSoft }}>
        <LabeledStat label="MAC" value={iface.mac ?? '–'} />
      </View>

      {addresses.length > 0 && (
        <View>
          <View style={{ paddingHorizontal: 10, paddingVertical: 6, backgroundColor: oc.header, borderBottomWidth: 1, borderBottomColor: oc.borderSoft }}>
            <MonoText size={9} color={oc.muted} style={{ textTransform: 'uppercase', fontWeight: '700' }}>Addresses</MonoText>
          </View>
          {addresses.map((addr, idx) => (
            <View
              key={`${iface.name}-${addr.family}-${addr.address}-${idx}`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderTopWidth: idx === 0 ? 0 : 1,
                borderTopColor: oc.borderSoft,
              }}
            >
              <MonoText size={10} color={oc.muted}>{addr.family === 'inet6' ? 'v6' : 'v4'}</MonoText>
              <MonoText size={10} color={oc.text} style={{ flex: 1, textAlign: 'right' }} numberOfLines={1}>
                {addr.address}/{addr.prefix}
              </MonoText>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

function StateFilters({ states, selected, onChange }: {
  states: string[]
  selected: string
  onChange: (state: string) => void
}) {
  const oc = useOpsColors()
  if (!states.length) return null
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingRight: 2 }}>
      {['', ...states].map(state => {
        const active = selected === state
        const label = state || 'All states'
        return (
          <TouchableOpacity
            key={label}
            onPress={() => onChange(state)}
            activeOpacity={0.8}
            style={{
              paddingHorizontal: 8,
              paddingVertical: 5,
              borderRadius: 5,
              borderWidth: 1,
              borderColor: active ? oc.border : oc.borderSoft,
              backgroundColor: active ? oc.surface2 : 'transparent',
            }}
          >
            <MonoText size={9} color={active ? oc.text : oc.muted} numberOfLines={1}>
              {label}
            </MonoText>
          </TouchableOpacity>
        )
      })}
    </ScrollView>
  )
}

function SearchControls({
  search,
  onSearch,
  states,
  stateFilter,
  onStateFilter,
  count,
  total,
}: {
  search: string
  onSearch: (value: string) => void
  states: string[]
  stateFilter: string
  onStateFilter: (state: string) => void
  count: number
  total: number
}) {
  const oc = useOpsColors()
  return (
    <View style={{ gap: 8, paddingHorizontal: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: oc.borderSoft }}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <View style={{
          flex: 1,
          minHeight: 34,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 8,
          borderWidth: 1,
          borderColor: oc.borderSoft,
          borderRadius: 5,
          backgroundColor: oc.input,
        }}>
          <Search size={13} color={oc.muted} />
          <TextInput
            value={search}
            onChangeText={onSearch}
            placeholder="Search..."
            placeholderTextColor={oc.muted}
            autoCapitalize="none"
            autoCorrect={false}
            style={{
              flex: 1,
              color: oc.text,
              fontSize: 10,
              fontFamily: 'SpaceMono-Regular',
              paddingVertical: 0,
            }}
          />
        </View>
        <MonoText size={9} color={oc.muted}>{count} of {total}</MonoText>
      </View>
      <StateFilters states={states} selected={stateFilter} onChange={onStateFilter} />
    </View>
  )
}

function CollapsibleNetworkCard({
  title,
  count,
  countLabel,
  children,
}: {
  title: string
  count: number
  countLabel: string
  children: React.ReactNode
}) {
  const oc = useOpsColors()
  const [open, setOpen] = useState(true)
  const toggle = useCallback(() => {
    setOpen(v => !v)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  }, [])

  return (
    <Card style={{ padding: 0, borderRadius: 8, overflow: 'hidden' }}>
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 12,
        paddingVertical: 11,
        borderBottomWidth: open ? 1 : 0,
        borderBottomColor: oc.borderSoft,
      }}>
        <View>
          <MonoText size={10} color={oc.muted} style={{ textTransform: 'uppercase', fontWeight: '700' }}>{title}</MonoText>
          <MonoText size={9} color={oc.muted}>{count} {countLabel}</MonoText>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity onPress={toggle} hitSlop={10} activeOpacity={0.75}>
            <Maximize2 size={13} color={oc.muted} />
          </TouchableOpacity>
          <TouchableOpacity onPress={toggle} hitSlop={10} activeOpacity={0.75}>
            {open ? <ChevronUp size={18} color={oc.text} /> : <ChevronDown size={18} color={oc.text} />}
          </TouchableOpacity>
        </View>
      </View>
      {open && children}
    </Card>
  )
}

function ProcessConnectionsList({ rows }: { rows: ProcessConnection[] }) {
  const oc = useOpsColors()
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const states = useMemo(() => Array.from(new Set(rows.map(r => r.state).filter(Boolean))).sort(), [rows])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(row => {
      const matchesSearch = !q ||
        String(row.pid).includes(q) ||
        row.name.toLowerCase().includes(q) ||
        (row.exe ?? '').toLowerCase().includes(q) ||
        row.protocol.toLowerCase().includes(q) ||
        row.local_addr.toLowerCase().includes(q) ||
        row.remote_addr.toLowerCase().includes(q) ||
        String(row.local_port).includes(q) ||
        String(row.remote_port).includes(q) ||
        row.state.toLowerCase().includes(q)
      const matchesState = !stateFilter || row.state === stateFilter
      return matchesSearch && matchesState
    })
  }, [rows, search, stateFilter])

  if (!rows.length) return <EmptyState label="No process connections" icon="⇄" />

  return (
    <View>
      <SearchControls
        search={search}
        onSearch={setSearch}
        states={states}
        stateFilter={stateFilter}
        onStateFilter={(state) => { setStateFilter(state); Haptics.selectionAsync() }}
        count={filtered.length}
        total={rows.length}
      />
      {filtered.length === 0 ? (
        <EmptyState label="No matches" icon="⌕" />
      ) : filtered.map((row, idx) => {
        const stateColor = stateTone(row.state)
        const pColor = protoTone(row.protocol)
        return (
          <View
            key={`${row.pid}-${row.local_port}-${row.remote_port}-${idx}`}
            style={{
              borderTopWidth: idx === 0 ? 0 : 1,
              borderTopColor: oc.borderSoft,
              backgroundColor: idx % 2 === 0 ? oc.rowA : oc.rowB,
            }}
          >
            <View style={{ flexDirection: 'row', minHeight: 38 }}>
              <View style={{ width: 62, padding: 8, backgroundColor: oc.greenCell, justifyContent: 'center' }}>
                <MonoText size={10} color={oc.text} style={{ fontWeight: '700' }}>{row.pid}</MonoText>
              </View>
              <View style={{ flex: 1, padding: 8, backgroundColor: oc.cyanCell }}>
                <MonoText size={10} color={oc.text} numberOfLines={1}>{row.name}</MonoText>
                {row.exe ? <MonoText size={9} color={oc.muted} numberOfLines={1}>{row.exe}</MonoText> : null}
              </View>
            </View>
            <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: oc.borderSoft }}>
              <View style={{ width: 64, padding: 8, backgroundColor: oc.blueCell }}>
                <Pill label={row.protocol} color={pColor} />
              </View>
              <View style={{ flex: 1, padding: 8, backgroundColor: oc.purpleCell }}>
                <MonoText size={9} color={oc.muted}>Local</MonoText>
                <MonoText size={10} color={oc.text} numberOfLines={1}>{endpoint(row.local_addr, row.local_port)}</MonoText>
              </View>
            </View>
            <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: oc.borderSoft }}>
              <View style={{ flex: 1, padding: 8, backgroundColor: oc.purpleCell }}>
                <MonoText size={9} color={oc.muted}>Remote</MonoText>
                <MonoText size={10} color={oc.text} numberOfLines={1}>{endpoint(row.remote_addr, row.remote_port)}</MonoText>
              </View>
              <View style={{ width: 112, padding: 8, backgroundColor: oc.greenCell, gap: 4 }}>
                <Pill label={row.state} color={stateColor} />
                <MonoText size={9} color={oc.muted}>q {row.rx_queue}/{row.tx_queue}</MonoText>
              </View>
            </View>
          </View>
        )
      })}
    </View>
  )
}

function OpenPortsList({ rows }: { rows: OpenPort[] }) {
  const oc = useOpsColors()
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const states = useMemo(() => Array.from(new Set(rows.map(r => r.state).filter(Boolean))).sort(), [rows])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(row => {
      const matchesSearch = !q ||
        row.protocol.toLowerCase().includes(q) ||
        row.local_addr.toLowerCase().includes(q) ||
        String(row.local_port).includes(q) ||
        row.state.toLowerCase().includes(q) ||
        (row.name ?? '').toLowerCase().includes(q) ||
        String(row.pid ?? '').includes(q)
      const matchesState = !stateFilter || row.state === stateFilter
      return matchesSearch && matchesState
    })
  }, [rows, search, stateFilter])

  if (!rows.length) return <EmptyState label="No open ports" icon="◌" />

  return (
    <View>
      <SearchControls
        search={search}
        onSearch={setSearch}
        states={states}
        stateFilter={stateFilter}
        onStateFilter={(state) => { setStateFilter(state); Haptics.selectionAsync() }}
        count={filtered.length}
        total={rows.length}
      />
      {filtered.length === 0 ? (
        <EmptyState label="No matches" icon="⌕" />
      ) : filtered.map((row, idx) => {
        const stateColor = stateTone(row.state)
        const pColor = protoTone(row.protocol)
        return (
          <View
            key={`${row.protocol}-${row.local_addr}-${row.local_port}-${idx}`}
            style={{
              flexDirection: 'row',
              borderTopWidth: idx === 0 ? 0 : 1,
              borderTopColor: oc.borderSoft,
              minHeight: 44,
            }}
          >
            <View style={{ width: 58, padding: 8, backgroundColor: oc.blueCell, justifyContent: 'center' }}>
              <Pill label={row.protocol} color={pColor} />
            </View>
            <View style={{ flex: 1.2, padding: 8, backgroundColor: oc.purpleCell, justifyContent: 'center' }}>
              <MonoText size={10} color={oc.text} numberOfLines={1}>{endpoint(row.local_addr, row.local_port)}</MonoText>
            </View>
            <View style={{ width: 86, padding: 8, backgroundColor: oc.greenCell, justifyContent: 'center' }}>
              <Pill label={row.state} color={stateColor} />
            </View>
            <View style={{ flex: 1, padding: 8, backgroundColor: oc.cyanCell, justifyContent: 'center' }}>
              <MonoText size={10} color={oc.text} numberOfLines={1}>{row.name ?? (row.pid ? `pid ${row.pid}` : '–')}</MonoText>
              {row.exe ? <MonoText size={8} color={oc.muted} numberOfLines={1}>{row.exe}</MonoText> : null}
            </View>
          </View>
        )
      })}
    </View>
  )
}

function NetworkPanel({
  metric,
  loading,
}: {
  metric?: Metric
  loading: boolean
}) {
  const oc = useOpsColors()
  const data = metric?.data as NetworkData | undefined
  const interfaces = data?.interfaces ?? []
  const processConnections = data?.process_connections ?? []
  const openPorts = data?.open_ports ?? []

  if (loading) {
    return <Card><LoadingState label="Loading network…" /></Card>
  }

  if (!data) {
    return <Card><EmptyState label="No network data" detail="Enable the network collector for this agent to see interface, port, and process telemetry." icon="⇄" /></Card>
  }

  return (
    <View style={{ gap: 12 }}>
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <SectionHeader
            title="Interfaces"
            count={interfaces.length}
            right={metric ? <MonoText size={9} color={oc.muted}>{formatTs(metric.timestamp, 'HH:mm:ss')}</MonoText> : null}
          />
        </View>
        {interfaces.length === 0 ? (
          <Card><EmptyState label="No interfaces" icon="⇄" /></Card>
        ) : (
          <View style={{ gap: 8 }}>
            {interfaces.map(iface => <NetworkInterfaceCard key={iface.name} iface={iface} />)}
          </View>
        )}
      </View>

      <CollapsibleNetworkCard title="Per-process connections" count={processConnections.length} countLabel="entries">
        <ProcessConnectionsList rows={processConnections} />
      </CollapsibleNetworkCard>

      <CollapsibleNetworkCard title="Open ports" count={openPorts.length} countLabel="ports">
        <OpenPortsList rows={openPorts} />
      </CollapsibleNetworkCard>
    </View>
  )
}

export function OperationsScreen() {
  const qc = useQueryClient()
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [logFilter, setLogFilter] = useState<'all' | 'docker' | 'k8s'>('all')
  const [view, setView] = useState<OpsView>('network')
  const [refreshing, setRefreshing] = useState(false)
  const scrollRef = useRef<ScrollView>(null)
  const { palette: c } = useTheme()

  const agentsQ = useQuery({
    queryKey: ['ops-agents'],
    queryFn: () => agentsApi.list().then(r => r.data),
  })

  const agents = agentsQ.data ?? []
  const activeAgentId = useMemo(() => selectedAgent ?? agents[0]?.agent_id ?? null, [selectedAgent, agents])
  const activeAgent = useMemo(() => agents.find(a => a.agent_id === activeAgentId), [agents, activeAgentId])

  const metricsQ = useQuery({
    queryKey: ['ops-latest', activeAgentId],
    queryFn: () => telemetryApi.latest(activeAgentId!).then(r => r.data),
    enabled: !!activeAgentId,
    refetchInterval: 15_000,
    staleTime: 10_000,
  })

  const logsQ = useQuery({
    queryKey: ['ops-logs', activeAgentId, logFilter],
    queryFn: () => logsApi.list({ agent_id: activeAgentId ?? undefined, limit: 200 }).then(r => r.data),
    enabled: !!activeAgentId,
    refetchInterval: 15_000,
    staleTime: 10_000,
  })

  const dockerMetric = metricsQ.data?.docker as Metric | undefined
  const k8sMetric = metricsQ.data?.kubernetes as Metric | undefined
  const networkMetric = metricsQ.data?.network as Metric | undefined

  const filteredLogs = useMemo(() => {
    const logs = logsQ.data ?? []
    return logs.filter(l => {
      if (!COLLECTOR_SOURCES.has(l.source)) return false
      if (logFilter === 'docker') return DOCKER_SOURCES.has(l.source)
      if (logFilter === 'k8s') return K8S_SOURCES.has(l.source)
      return true
    })
  }, [logsQ.data, logFilter])

  const handleSelectAgent = useCallback((id: string) => {
    setSelectedAgent(id)
    Haptics.selectionAsync()
  }, [])

  const handleViewChange = useCallback((nextView: OpsView) => {
    setView(nextView)
    Haptics.selectionAsync()
  }, [])

  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: true })
  }, [])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    qc.invalidateQueries({ queryKey: ['ops-agents'] })
    if (activeAgentId) {
      qc.invalidateQueries({ queryKey: ['ops-latest', activeAgentId] })
      qc.invalidateQueries({ queryKey: ['ops-logs', activeAgentId, logFilter] })
    }
    setTimeout(() => setRefreshing(false), 600)
  }, [qc, activeAgentId, logFilter])

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 14 }}
        refreshControl={
          <RefreshControl refreshing={refreshing || agentsQ.isFetching || metricsQ.isFetching || logsQ.isFetching} onRefresh={handleRefresh} tintColor={c.primary} />
        }
      >
        {/* Header */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <MonoText size={16} style={{ fontWeight: '700' }}>operations</MonoText>
            <MonoText size={11} color={c.textMuted}>Docker, Kubernetes & Network</MonoText>
          </View>
          <TouchableOpacity
            onPress={handleRefresh}
            style={{
              paddingHorizontal: 12, paddingVertical: 8,
              borderRadius: 8, borderWidth: 1, borderColor: c.border,
              flexDirection: 'row', alignItems: 'center', gap: 6,
            }}
          >
            <Text style={{ color: c.text, fontSize: 14 }}>⟳</Text>
            <MonoText size={11} color={c.text}>Refresh</MonoText>
          </TouchableOpacity>
        </View>

        {/* Agent list */}
        <Card style={{ padding: 0 }}>
          <View style={{
            paddingHorizontal: 14,
            paddingTop: 14,
            paddingBottom: 10,
            borderBottomWidth: 1,
            borderBottomColor: c.border,
          }}>
            <SectionHeader title="Agents" count={agents.length} />
          </View>
          {agentsQ.isLoading ? (
            <LoadingState label="Loading agents…" />
          ) : agents.length === 0 ? (
            <EmptyState label="No agents registered" icon="◎" />
          ) : (
            <FlatList
              data={agents}
              keyExtractor={a => a.agent_id}
              renderItem={({ item }) => (
                <AgentRow
                  agent={item}
                  selected={item.agent_id === activeAgentId}
                  onPress={() => handleSelectAgent(item.agent_id)}
                  hasDockerData={item.agent_id === activeAgentId && !!dockerMetric}
                  hasK8sData={item.agent_id === activeAgentId && !!k8sMetric}
                  hasNetworkData={item.agent_id === activeAgentId && !!networkMetric}
                />
              )}
              scrollEnabled={false}
            />
          )}
        </Card>

        {/* Metrics */}
        <View style={{ gap: 10 }}>
          <ViewTabs view={view} onChange={handleViewChange} disabled={{}} />
          {view === 'docker' && <DockerCard metric={dockerMetric} loading={metricsQ.isLoading} />}
          {view === 'kubernetes' && <KubernetesCard metric={k8sMetric} loading={metricsQ.isLoading} />}
          {view === 'network' && <NetworkPanel metric={networkMetric} loading={metricsQ.isLoading} />}
        </View>

        {/* Logs */}
        <Card style={{ padding: 0 }}>
          <View style={{ paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <SectionHeader title="Collector Logs" count={filteredLogs.length} />
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {(['all', 'docker', 'k8s'] as const).map(f => {
                const active = logFilter === f
                return (
                  <TouchableOpacity
                    key={f}
                    onPress={() => { setLogFilter(f); Haptics.selectionAsync() }}
                    style={{
                      paddingHorizontal: 10, paddingVertical: 5,
                      borderRadius: 16, borderWidth: 1,
                      borderColor: active ? c.warning : c.border,
                      backgroundColor: active ? c.warning + '22' : 'transparent',
                    }}
                  >
                    <MonoText size={10} color={active ? c.warning : c.textMuted} style={{ textTransform: 'uppercase' }}>{f}</MonoText>
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>

          {logsQ.isLoading ? (
            <View style={{ padding: 12 }}><LoadingState label="Loading logs…" /></View>
          ) : filteredLogs.length === 0 ? (
            <EmptyState label={activeAgent ? 'No collector logs' : 'Select an agent'} icon="≡" />
          ) : (
            <FlatList
              data={filteredLogs}
              keyExtractor={(l, i) => l.id?.toString() ?? i.toString()}
              renderItem={({ item }) => <CollectorLogRow log={item} />}
              scrollEnabled={false}
            />
          )}
        </Card>
      </ScrollView>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Back to top"
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
          scrollToTop()
        }}
        activeOpacity={0.82}
        style={{
          position: 'absolute',
          right: 18,
          bottom: 22,
          width: 46,
          height: 46,
          borderRadius: 23,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: c.primary,
          borderWidth: 1,
          borderColor: c.mode === 'light' ? '#1d4ed8' : '#60a5fa',
          shadowColor: '#000',
          shadowOpacity: 0.24,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
          elevation: 7,
        }}
      >
        <ArrowUpToLine size={21} color="#ffffff" strokeWidth={2.5} />
      </TouchableOpacity>
    </View>
  )
}
