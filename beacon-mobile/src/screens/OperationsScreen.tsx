import React, {
  useState, useMemo, useCallback, useRef,
} from 'react'
import {
  View, Text, TouchableOpacity, ScrollView, FlatList, RefreshControl,
} from 'react-native'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as Haptics from 'expo-haptics'
import { agentsApi, telemetryApi, logsApi } from '@/api/endpoints'
import { Agent, Metric, LogEntry } from '@/types'
import {
  Card, SectionHeader, MonoText, LoadingState, EmptyState, Badge, StatusDot,
} from '@/components/common'
import { statusColor, severityColor, timeAgo, formatTs, formatBytes, formatPct } from '@/utils/format'

const DOCKER_SOURCES = new Set(['docker', 'docker_engine'])
const K8S_SOURCES = new Set(['kubernetes', 'k3s_engine'])
const COLLECTOR_SOURCES = new Set<string>([...DOCKER_SOURCES, ...K8S_SOURCES])

function AgentRow({ agent, selected, onPress }: {
  agent: Agent
  selected: boolean
  onPress: () => void
}) {
  const color = statusColor(agent.status)
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={{
        padding: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#1e252e',
        backgroundColor: selected ? '#1e2e42' : 'transparent',
        borderLeftWidth: 2,
        borderLeftColor: selected ? '#f59e0b' : 'transparent',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <StatusDot color={color} size={8} />
        <MonoText size={13} style={{ flex: 1, fontWeight: '700' }}>{agent.hostname}</MonoText>
      </View>
      <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, alignItems: 'center' }}>
        <Badge label={agent.status.toLowerCase()} color={color} bg={color + '22'} />
        <MonoText size={10} color="#5a6878">{timeAgo(agent.last_seen)}</MonoText>
      </View>
    </TouchableOpacity>
  )
}

function CollectorLogRow({ log }: { log: LogEntry }) {
  const color = severityColor(log.severity)
  return (
    <View style={{ paddingVertical: 8, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#1e252e', flexDirection: 'row', gap: 8, alignItems: 'center' }}>
      <View style={{
        paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
        borderWidth: 1, borderColor: '#1e252e', backgroundColor: '#111418',
      }}>
        <MonoText size={9} color="#5a6878" style={{ textTransform: 'uppercase' }}>
          {DOCKER_SOURCES.has(log.source) ? 'Docker' : K8S_SOURCES.has(log.source) ? 'K8s' : log.source}
        </MonoText>
      </View>
      <MonoText size={10} color={color} style={{ textTransform: 'uppercase' }}>{log.severity}</MonoText>
      <MonoText size={10} color="#3a4555">{formatTs(log.timestamp, 'HH:mm:ss')}</MonoText>
      <MonoText size={11} color="#d4dae3" style={{ flex: 1 }}>{log.message}</MonoText>
    </View>
  )
}

const toNumber = (v: unknown): number | null => (typeof v === 'number' && !Number.isNaN(v) ? v : null)
const pick = (obj: any, keys: string[]): any => keys.reduce((acc, k) => (acc != null ? acc : obj?.[k]), null)

function LabeledStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <MonoText size={11} color="#5a6878">{label}</MonoText>
      <MonoText size={12} color={accent ?? '#d4dae3'}>{value}</MonoText>
    </View>
  )
}

function DockerCard({ metric, loading }: { metric?: Metric; loading: boolean }) {
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
        right={metric ? <MonoText size={9} color="#3a4555">{formatTs(metric.timestamp, 'HH:mm:ss')}</MonoText> : null}
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
        right={metric ? <MonoText size={9} color="#3a4555">{formatTs(metric.timestamp, 'HH:mm:ss')}</MonoText> : null}
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

export function OperationsScreen() {
  const qc = useQueryClient()
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [logFilter, setLogFilter] = useState<'all' | 'docker' | 'k8s'>('all')
  const [refreshing, setRefreshing] = useState(false)

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
  })

  const logsQ = useQuery({
    queryKey: ['ops-logs', activeAgentId, logFilter],
    queryFn: () => logsApi.list({ agent_id: activeAgentId ?? undefined, limit: 200 }).then(r => r.data),
    enabled: !!activeAgentId,
    refetchInterval: 15_000,
  })

  const dockerMetric = metricsQ.data?.docker as Metric | undefined
  const k8sMetric = metricsQ.data?.kubernetes as Metric | undefined

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
    <View style={{ flex: 1, backgroundColor: '#0b0d0f' }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 14 }}
        refreshControl={
          <RefreshControl refreshing={refreshing || agentsQ.isFetching || metricsQ.isFetching || logsQ.isFetching} onRefresh={handleRefresh} tintColor="#3b82f6" />
        }
      >
        {/* Header */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <MonoText size={16} style={{ fontWeight: '700' }}>operations</MonoText>
            <MonoText size={11} color="#5a6878">Docker & Kubernetes</MonoText>
          </View>
          <TouchableOpacity
            onPress={handleRefresh}
            style={{
              paddingHorizontal: 12, paddingVertical: 8,
              borderRadius: 8, borderWidth: 1, borderColor: '#1e252e',
              flexDirection: 'row', alignItems: 'center', gap: 6,
            }}
          >
            <Text style={{ color: '#d4dae3', fontSize: 14 }}>⟳</Text>
            <MonoText size={11} color="#d4dae3">Refresh</MonoText>
          </TouchableOpacity>
        </View>

        {/* Agent list */}
        <Card style={{ padding: 0 }}>
          <SectionHeader title="Agents" count={agents.length} />
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
                />
              )}
              scrollEnabled={false}
            />
          )}
        </Card>

        {/* Metrics */}
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <DockerCard metric={dockerMetric} loading={metricsQ.isLoading} />
          <KubernetesCard metric={k8sMetric} loading={metricsQ.isLoading} />
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
                      borderColor: active ? '#f59e0b' : '#1e252e',
                      backgroundColor: active ? '#f59e0b22' : 'transparent',
                    }}
                  >
                    <MonoText size={10} color={active ? '#f59e0b' : '#5a6878'} style={{ textTransform: 'uppercase' }}>{f}</MonoText>
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
    </View>
  )
}
