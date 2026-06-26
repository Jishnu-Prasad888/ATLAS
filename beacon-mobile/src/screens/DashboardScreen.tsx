import React, {
  useCallback, useEffect, useMemo, useState,
} from 'react'
import {
  Modal,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useQuery } from '@tanstack/react-query'
import * as Haptics from 'expo-haptics'

import { configApi, usersApi } from '@/api/endpoints'
import { useAgents, useFleetHealth, useLiveMetrics, useLogs } from '@/hooks'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import { useTheme } from '@/theme'
import {
  Agent,
  CpuData,
  GpuData,
  KernelData,
  NetworkData,
  RamData,
  StorageData,
  StorageDisk,
  StoragePartition,
} from '@/types'
import {
  Card,
  EmptyState,
  LoadingState,
  MonoText,
  SectionHeader,
  StatusDot,
  Badge,
} from '@/components/common'
import { ArcGauge, Sparkline } from '@/components/charts'
import {
  formatBandwidth,
  formatBytes,
  formatTs,
  formatUptime,
  severityColor,
  statusColor,
  timeAgo,
} from '@/utils/format'

const shortAgentId = (id: string) => (id.length > 12 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id)
const isMetricLog = (severity: string) => severity !== 'Trace' && severity !== 'Debug'

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, minWidth: 120 }}>
      <MonoText size={9} color="#6b7280" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
        {label}
      </MonoText>
      <MonoText size={12} color="#d4dae3" numberOfLines={1} style={{ marginTop: 2 }}>
        {value}
      </MonoText>
    </View>
  )
}

function StatCard({
  label,
  value,
  hint,
  accent,
  badge,
}: {
  label: string
  value: string | number
  hint?: string
  accent?: string
  badge?: string
}) {
  const { palette: c } = useTheme()
  return (
    <View style={{
      width: '31%',
      minHeight: 72,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 8,
      backgroundColor: c.surface,
      padding: 8,
      justifyContent: 'space-between',
    }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <MonoText size={8} color={c.textMuted} style={{ textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '700' }} numberOfLines={1}>
          {label}
        </MonoText>
        {badge ? <Badge label={badge} color="#eab308" bg="#eab30822" /> : null}
      </View>
      <MonoText size={14} color={accent ?? c.text} style={{ fontWeight: '700' }} numberOfLines={1}>
        {value}
      </MonoText>
      {hint ? <MonoText size={8} color={c.textMuted} numberOfLines={1}>{hint}</MonoText> : null}
    </View>
  )
}

function AgentDropdown({
  agents,
  selectedAgentId,
  onSelect,
}: {
  agents: Agent[]
  selectedAgentId: string | null
  onSelect: (id: string) => void
}) {
  const { palette: c } = useTheme()
  const [open, setOpen] = useState(false)
  const selected = agents.find(agent => agent.agent_id === selectedAgentId) ?? agents[0]

  if (!agents.length) return null

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.82}
        onPress={() => {
          setOpen(true)
          Haptics.selectionAsync()
        }}
        style={{
          minWidth: 150,
          maxWidth: 210,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface2,
          borderRadius: 8,
          paddingHorizontal: 10,
          paddingVertical: 8,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <View style={{ flex: 1 }}>
          <MonoText size={10} color="#6b7280" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>Agent</MonoText>
          <MonoText size={11} color="#d4dae3" numberOfLines={1}>{selected?.hostname ?? 'Select agent'}</MonoText>
        </View>
        <MonoText size={13} color="#6b7280">⌄</MonoText>
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setOpen(false)}
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.55)',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <View style={{
            maxHeight: '70%',
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: 10,
            backgroundColor: c.surface,
            overflow: 'hidden',
          }}>
            <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: c.border }}>
              <MonoText size={10} color="#6b7280" style={{ textTransform: 'uppercase', letterSpacing: 1, fontWeight: '700' }}>Select agent</MonoText>
            </View>
            <ScrollView>
              {agents.map(agent => {
                const active = agent.agent_id === selectedAgentId
                const color = statusColor(agent.status)
                return (
                  <TouchableOpacity
                    key={agent.agent_id}
                    activeOpacity={0.82}
                    onPress={() => {
                      onSelect(agent.agent_id)
                      setOpen(false)
                    }}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      borderBottomWidth: 1,
                      borderBottomColor: c.border,
                      backgroundColor: active ? color + '14' : 'transparent',
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    <StatusDot color={color} size={8} />
                    <View style={{ flex: 1 }}>
                      <MonoText size={12} color="#d4dae3" numberOfLines={1}>{agent.hostname}</MonoText>
                      <MonoText size={9} color="#6b7280">{shortAgentId(agent.agent_id)} · {timeAgo(agent.last_seen)}</MonoText>
                    </View>
                    {active ? <Badge label="selected" color={color} bg={color + '22'} /> : null}
                  </TouchableOpacity>
                )
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  )
}

function GuestDashboard({
  username,
  accessibleCount,
  organizations,
  expiresAt,
}: {
  username?: string
  accessibleCount: number
  organizations: number
  expiresAt?: string | null
}) {
  return (
    <View style={{ gap: 14 }}>
      <View>
        <MonoText size={18} style={{ fontWeight: '700' }}>Guest Monitoring Dashboard</MonoText>
        <MonoText size={11} color="#6b7280">{username ? `Welcome, ${username}` : `Accessible agents: ${accessibleCount}`}</MonoText>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <StatCard label="Agents" value={accessibleCount} hint="Assigned access" accent="#93c5fd" />
        <StatCard label="Organizations" value={organizations} hint="Scope" accent="#34d399" />
        <StatCard label="Access mode" value="Read-only" hint="Controls hidden" accent="#a78bfa" />
      </View>
      <Card>
        <SectionHeader title="Guest access" />
        <MonoText size={11} color="#6b7280">
          You can view assigned agents and organizations. Administration, audit, and controls are hidden for guest access.
        </MonoText>
        {expiresAt ? (
          <MonoText size={11} color="#d4dae3" style={{ marginTop: 10 }}>
            Expires {formatTs(expiresAt)}
          </MonoText>
        ) : null}
      </Card>
    </View>
  )
}

function AgentFocusCard({
  activeAgent,
  agents,
  selectedAgentId,
  onSelect,
  loading,
}: {
  activeAgent: Agent | null
  agents: Agent[]
  selectedAgentId: string | null
  onSelect: (id: string) => void
  loading: boolean
}) {
  if (loading) return <Card><LoadingState label="Loading agents..." /></Card>
  if (!activeAgent) return <Card><EmptyState label="No agents available for your account" icon="◎" /></Card>

  const color = statusColor(activeAgent.status)
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
        <SectionHeader title="Agent focus" />
        <AgentDropdown agents={agents} selectedAgentId={selectedAgentId} onSelect={onSelect} />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <MonoText size={17} color="#d4dae3" style={{ fontWeight: '700' }} numberOfLines={1}>{activeAgent.hostname}</MonoText>
          <MonoText size={10} color="#6b7280">{shortAgentId(activeAgent.agent_id)}</MonoText>
        </View>
        <Badge label={activeAgent.status.toLowerCase()} color={color} bg={color + '22'} />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <MonoText size={10} color="#6b7280">{timeAgo(activeAgent.last_seen)}</MonoText>
        {activeAgent.is_stale ? <Badge label="stale" color="#eab308" bg="#eab30822" /> : null}
      </View>

      {activeAgent.tags.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
          {activeAgent.tags.slice(0, 5).map(tag => <Badge key={tag} label={tag} color="#d4dae3" bg="#1e252e" />)}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
        <InfoCell label="OS" value={activeAgent.os || '—'} />
        <InfoCell label="Arch" value={activeAgent.architecture || '—'} />
        <InfoCell label="Version" value={activeAgent.version || '—'} />
        <InfoCell label="Status" value={activeAgent.is_active ? 'Active' : 'Disabled'} />
      </View>

    </Card>
  )
}

function MetricPanel({
  agentId,
  hostname,
  agents,
  agentsLoading,
  onSelectAgent,
}: {
  agentId: string | null
  hostname?: string
  agents: Agent[]
  agentsLoading: boolean
  onSelectAgent: (id: string) => void
}) {
  const { latest, history } = useLiveMetrics(agentId)
  const cpu = latest.cpu?.data as unknown as CpuData | undefined
  const ram = latest.ram?.data as unknown as RamData | undefined
  const storage = latest.storage?.data as unknown as StorageData | undefined
  const network = latest.network?.data as unknown as NetworkData | undefined
  const kernel = latest.kernel?.data as unknown as KernelData | undefined
  const gpu = latest.gpu?.data as unknown as GpuData | undefined

  const storagePartitions: StoragePartition[] = storage?.partitions?.length ? storage.partitions : storage?.filesystems ?? []
  const storageDisks = storage?.disks ?? []
  const rootPartition = storagePartitions.find(p => p.mount_point === '/') ?? storagePartitions[0]
  const osDisk = storage?.os_disk
    ?? (rootPartition
      ? storageDisks.find(d => d.device === (rootPartition.parent_disk ?? rootPartition.device) || d.name === rootPartition.parent_disk) ?? storageDisks[0]
      : storageDisks[0])
  const primaryInterface = network?.interfaces.find(i => i.name !== 'lo') ?? network?.interfaces[0]
  const showGpuGauge = Boolean(latest.gpu)
  const hasGpuDevices = Boolean(gpu?.gpus?.length)
  const netRxHistory = history.netRx.map(v => Math.max(0, v) / 1024)
  const netTxHistory = history.netTx.map(v => Math.max(0, v) / 1024)

  if (agentsLoading) return <Card><LoadingState label="Loading agents..." /></Card>
  if (!agentId) return <Card><EmptyState label="Select an agent to view metrics" icon="▦" /></Card>

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
        <SectionHeader title="Live metrics" description={hostname ?? '—'} />
        <AgentDropdown agents={agents} selectedAgentId={agentId} onSelect={onSelectAgent} />
      </View>
      {cpu || ram || osDisk || showGpuGauge ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 16 }}>
          {cpu ? <ArcGauge value={cpu.usage_pct} label="CPU" history={history.cpu} /> : null}
          {ram ? <ArcGauge value={ram.usage_pct} label="RAM" detail={`${formatBytes(ram.used_bytes)} / ${formatBytes(ram.total_bytes)}`} history={history.ram} /> : null}
          {osDisk ? <ArcGauge value={osDisk.usage_pct} label="OS Disk" detail={`${formatBytes(osDisk.used_bytes)} / ${formatBytes(osDisk.total_bytes)}`} /> : null}
          {showGpuGauge ? (
            <ArcGauge
              value={gpu?.summary?.avg_utilization_pct ?? 0}
              label="GPU"
              detail={hasGpuDevices
                ? `${gpu?.gpus.length ?? 0} GPU${(gpu?.gpus.length ?? 0) > 1 ? 's' : ''} · ${Math.round(gpu?.summary?.avg_mem_utilization_pct ?? 0)}% mem`
                : gpu?.collector_disabled ? 'Collector disabled' : 'No GPUs detected'}
              history={history.gpu}
            />
          ) : null}
        </View>
      ) : (
        <EmptyState label="Waiting for metrics..." icon="⌁" />
      )}

      {primaryInterface ? (
        <View style={{ marginTop: 18, gap: 12 }}>
          <SectionHeader title="Network" description={primaryInterface.name} />
          <View style={{ flexDirection: 'row', gap: 14 }}>
            <View style={{ flex: 1 }}>
              <MonoText size={9} color="#6b7280" style={{ textTransform: 'uppercase' }}>RX</MonoText>
              <MonoText size={16} color="#22c55e" style={{ fontWeight: '700' }}>{formatBandwidth(primaryInterface.rx_bytes_rate)}</MonoText>
              <Sparkline data={netRxHistory} color="#22c55e" />
            </View>
            <View style={{ flex: 1 }}>
              <MonoText size={9} color="#6b7280" style={{ textTransform: 'uppercase' }}>TX</MonoText>
              <MonoText size={16} color="#3b82f6" style={{ fontWeight: '700' }}>{formatBandwidth(primaryInterface.tx_bytes_rate)}</MonoText>
              <Sparkline data={netTxHistory} color="#3b82f6" />
            </View>
          </View>
        </View>
      ) : null}

      {hasGpuDevices && gpu ? (
        <View style={{ marginTop: 16, gap: 8 }}>
          {gpu.gpus.map(g => (
            <View key={g.uuid || String(g.index)} style={{ borderWidth: 1, borderColor: '#1e252e', borderRadius: 8, padding: 10, gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <MonoText size={11} color="#d4dae3" numberOfLines={1} style={{ flex: 1 }}>{g.name || `GPU ${g.index}`}</MonoText>
                <MonoText size={10} color="#a78bfa">{g.utilization_pct.toFixed(0)}%</MonoText>
              </View>
              <MonoText size={10} color="#6b7280">
                Mem {Math.round(g.memory_utilization_pct)}% · {formatBytes(g.memory_used_mb * 1024 * 1024)} / {formatBytes(g.memory_total_mb * 1024 * 1024)}
              </MonoText>
            </View>
          ))}
        </View>
      ) : null}

      {cpu || kernel ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 16 }}>
          {cpu ? <InfoCell label="Load 1m" value={cpu.load_avg_1m.toFixed(2)} /> : null}
          {cpu ? <InfoCell label="Load 15m" value={cpu.load_avg_15m.toFixed(2)} /> : null}
          {kernel ? <InfoCell label="Uptime" value={formatUptime(kernel.uptime_secs)} /> : null}
          {kernel ? <InfoCell label="Kernel" value={kernel.kernel_version} /> : null}
        </View>
      ) : null}
    </Card>
  )
}

function SignalsPanel({
  logs,
  loading,
  errorCount,
  warningCount,
}: {
  logs: Array<{ id: number; source: string; severity: string; message: string; timestamp: string }>
  loading: boolean
  errorCount: number
  warningCount: number
}) {
  const recentLogs = (logs.filter(log => isMetricLog(log.severity)).length
    ? logs.filter(log => isMetricLog(log.severity))
    : logs).slice(0, 4)

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: '#1e252e', flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
        <SectionHeader title="Signals" />
        <MonoText size={10} color="#6b7280">{errorCount} errors · {warningCount} warnings</MonoText>
      </View>
      {loading ? (
        <View style={{ padding: 16 }}><LoadingState label="Loading logs..." /></View>
      ) : !recentLogs.length ? (
        <EmptyState label="No recent logs" icon="≡" />
      ) : recentLogs.map(log => {
        const color = severityColor(log.severity)
        return (
          <View key={log.id} style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: '#1e252e', gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Badge label={log.severity} color={color} bg={color + '22'} />
              <MonoText size={10} color="#6b7280">{timeAgo(log.timestamp)}</MonoText>
            </View>
            <MonoText size={11} color="#d4dae3" numberOfLines={2}>{log.message}</MonoText>
            <MonoText size={9} color="#3a4555">{log.source}</MonoText>
          </View>
        )
      })}
    </Card>
  )
}

export function DashboardScreen() {
  const { palette: c } = useTheme()
  const {
    user, role, accessScope,
  } = useAuthStore()
  const { selectedAgentId, selectAgent, wsConnected } = useUiStore()
  const [refreshing, setRefreshing] = useState(false)

  const fleetQ = useFleetHealth()
  const agentsQ = useAgents()
  const logsQ = useLogs({ limit: 40 }, true)
  const isAdmin = role === 'administrator'
  const isModerator = role === 'moderator'
  const isGuest = role === 'guest'

  const usersQ = useQuery({
    queryKey: ['dashboard', 'users', isAdmin],
    queryFn: () => usersApi.list().then(res => res.data),
    enabled: isAdmin,
    staleTime: 60_000,
  })
  const configQ = useQuery({
    queryKey: ['dashboard', 'config', isAdmin],
    queryFn: () => configApi.list().then(res => res.data),
    enabled: isAdmin,
    staleTime: 60_000,
  })

  const allAgents = agentsQ.data ?? []
  const accessibleAgents = useMemo(() => {
    if (accessScope?.access_all_agents || isAdmin || isModerator) return allAgents
    const allowed = new Set(accessScope?.agent_ids ?? [])
    return allAgents.filter(agent => allowed.has(agent.agent_id))
  }, [accessScope, allAgents, isAdmin, isModerator])

  useEffect(() => {
    if (!accessibleAgents.length) {
      if (selectedAgentId) selectAgent(null)
      return
    }
    if (!selectedAgentId || !accessibleAgents.some(agent => agent.agent_id === selectedAgentId)) {
      selectAgent(accessibleAgents[0].agent_id)
    }
  }, [accessibleAgents, selectAgent, selectedAgentId])

  const activeAgentId = selectedAgentId ?? accessibleAgents[0]?.agent_id ?? null
  const activeAgent = useMemo(
    () => accessibleAgents.find(agent => agent.agent_id === activeAgentId) ?? null,
    [accessibleAgents, activeAgentId],
  )

  const handleSelectAgent = useCallback((id: string) => {
    selectAgent(id)
    Haptics.selectionAsync()
  }, [selectAgent])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    await Promise.all([
      fleetQ.refetch(),
      agentsQ.refetch(),
      logsQ.refetch(),
      isAdmin ? usersQ.refetch() : Promise.resolve(),
      isAdmin ? configQ.refetch() : Promise.resolve(),
    ])
    setRefreshing(false)
  }, [agentsQ, configQ, fleetQ, isAdmin, logsQ, usersQ])

  const fleet = fleetQ.data
  const logs = logsQ.data ?? []
  const logCounts = useMemo(() => logs.reduce<Record<string, number>>((acc, log) => {
    acc[log.severity] = (acc[log.severity] ?? 0) + 1
    return acc
  }, {}), [logs])

  const fleetTotal = fleet?.agents.total ?? 0
  const fleetOnline = fleet?.agents.online ?? 0
  const fleetDegraded = fleet?.agents.degraded ?? 0
  const fleetOffline = fleet?.agents.offline ?? 0
  const staleCount = accessibleAgents.filter(agent => agent.is_stale).length
  const errorCount = (logCounts.Error ?? 0) + (logCounts.Critical ?? 0)
  const warningCount = logCounts.Warning ?? 0
  const infoCount = logCounts.Info ?? 0
  const snapshot = (fleet?.latest_snapshot ?? {}) as Record<string, unknown>
  const metricsRate = typeof snapshot.metrics_rate === 'number' ? snapshot.metrics_rate : null
  const logsRate = typeof snapshot.logs_rate === 'number' ? snapshot.logs_rate : null
  const dbSize = typeof snapshot.db_size_bytes === 'number' ? formatBytes(snapshot.db_size_bytes) : null
  const snapshotTs = typeof snapshot.timestamp === 'string' ? snapshot.timestamp : null
  const roleLabel = isAdmin ? 'Administration Dashboard' : isModerator ? 'Operations Dashboard' : isGuest ? 'Guest Monitoring Dashboard' : 'Monitoring Dashboard'
  const screenRefreshing = refreshing || fleetQ.isFetching || agentsQ.isFetching || logsQ.isFetching

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={screenRefreshing} onRefresh={handleRefresh} tintColor={c.primary} />}
      >
        {isGuest ? (
          <GuestDashboard
            username={user?.username}
            accessibleCount={accessibleAgents.length}
            organizations={accessScope?.organization_ids.length ?? 0}
            expiresAt={user?.expires_at}
          />
        ) : (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <MonoText size={18} style={{ fontWeight: '700' }}>dashboard</MonoText>
                <MonoText size={11} color={c.textMuted}>{user ? `Welcome, ${user.username}` : roleLabel}</MonoText>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <StatusDot color={wsConnected ? c.success : c.textMuted} size={9} />
                <MonoText size={10} color={c.textMuted}>{wsConnected ? 'live' : 'polling'}</MonoText>
              </View>
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              <StatCard
                label="Fleet"
                value={`${fleetOnline}/${fleetTotal}`}
                hint={`${fleetDegraded} degraded · ${fleetOffline} offline`}
                accent="#34d399"
                badge={`${staleCount} stale`}
              />
              <StatCard
                label="Signals"
                value={errorCount ? `${errorCount} errors` : 'All clear'}
                hint={`${warningCount} warnings · ${infoCount} info`}
                accent={errorCount ? '#f87171' : '#93c5fd'}
              />
              <StatCard
                label="Ingest"
                value={metricsRate !== null ? `${metricsRate.toFixed(1)}/s` : '—'}
                hint={`logs ${logsRate !== null ? logsRate.toFixed(1) : '—'}/s${dbSize ? ` · db ${dbSize}` : ''}`}
                accent="#a78bfa"
              />
              <StatCard
                label="Agents"
                value={accessibleAgents.length || '—'}
                hint={activeAgent ? activeAgent.hostname : 'Select an agent'}
              />
              {isAdmin ? (
                <StatCard
                  label="Admin"
                  value={`${usersQ.data?.length ?? '—'} users`}
                  hint={`${configQ.data?.length ?? 0} config keys`}
                />
              ) : null}
            </View>

            <AgentFocusCard
              activeAgent={activeAgent}
              agents={accessibleAgents}
              selectedAgentId={activeAgentId}
              onSelect={handleSelectAgent}
              loading={agentsQ.isLoading}
            />

            <MetricPanel
              agentId={activeAgentId}
              hostname={activeAgent?.hostname}
              agents={accessibleAgents}
              agentsLoading={agentsQ.isLoading}
              onSelectAgent={handleSelectAgent}
            />

            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                <SectionHeader title="Health snapshot" />
                <Badge label={fleet?.server_status ?? '—'} color="#22c55e" bg="#22c55e22" />
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                <InfoCell label="Online" value={String(fleetOnline)} />
                <InfoCell label="Offline" value={String(fleetOffline)} />
                <InfoCell label="Metrics/s" value={metricsRate !== null ? metricsRate.toFixed(1) : '—'} />
                <InfoCell label="Logs/s" value={logsRate !== null ? logsRate.toFixed(1) : '—'} />
                <InfoCell label="DB size" value={dbSize ?? '—'} />
                <InfoCell label="Snapshot" value={snapshotTs ? timeAgo(snapshotTs) : '—'} />
              </View>
            </Card>

            <SignalsPanel
              logs={logs}
              loading={logsQ.isLoading}
              errorCount={errorCount}
              warningCount={warningCount}
            />

            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                <SectionHeader title="Account" />
                {isAdmin ? <MonoText size={10} color="#6b7280">Admin tools</MonoText> : null}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                <InfoCell label="Role" value={user?.role ?? role ?? '—'} />
                <InfoCell label="Agents" value={`${fleetTotal} total`} />
                <InfoCell label="Live mode" value={wsConnected ? 'WebSocket' : 'Polling'} />
                <InfoCell label="Snapshot" value={snapshotTs ? timeAgo(snapshotTs) : '—'} />
                {isAdmin ? <InfoCell label="Users" value={`${usersQ.data?.length ?? '—'}`} /> : null}
                {isAdmin ? <InfoCell label="Config keys" value={`${configQ.data?.length ?? 0}`} /> : null}
              </View>
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  )
}
