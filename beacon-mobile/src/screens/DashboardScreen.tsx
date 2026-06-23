import React, { useEffect, useMemo } from 'react'
import {
  View, Text, ScrollView, RefreshControl, TouchableOpacity,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import { useTheme } from '@/theme'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import { useFleetHealth, useAgents, useLiveMetrics, useLogs } from '@/hooks'
import { Card, SectionHeader, LoadingState, ErrorState, MonoText, StatusDot } from '@/components/common'
import { ArcGauge, Sparkline } from '@/components/charts'
import { formatBytes, formatBandwidth, timeAgo } from '@/utils/format'

function AgentPill({
  hostname,
  selected,
  onPress,
}: {
  hostname: string
  selected: boolean
  onPress: () => void
}) {
  const { palette: c } = useTheme()
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: selected ? c.primary : c.border,
        backgroundColor: selected ? c.primary + '22' : c.surface,
        marginRight: 8,
      }}
    >
      <MonoText size={11} color={selected ? c.primary : c.text}>{hostname}</MonoText>
    </TouchableOpacity>
  )
}

function SummaryTile({ label, value, hint, color }: { label: string; value: string | number; hint?: string; color?: string }) {
  const { palette: c } = useTheme()
  return (
    <View style={{ flex: 1, minWidth: 120, borderWidth: 1, borderColor: c.border, borderRadius: 12, backgroundColor: c.surface, padding: 14 }}>
      <MonoText size={10} color={c.textMuted} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>{label}</MonoText>
      <MonoText size={20} color={color ?? c.text} style={{ fontWeight: '700', marginTop: 6 }}>{value}</MonoText>
      {hint && <MonoText size={10} color={c.textMuted} style={{ marginTop: 4 }}>{hint}</MonoText>}
    </View>
  )
}

function LogsList({ logs }: { logs: Array<{ id?: number; agent_id?: string; message: string; severity: string; timestamp: string }> }) {
  const { palette: c } = useTheme()
  if (!logs.length) {
    return <MonoText size={11} color={c.textMuted}>No recent logs</MonoText>
  }
  return (
    <View style={{ gap: 10 }}>
      {logs.slice(0, 8).map((log, idx) => (
        <View
          key={`${log.id ?? idx}-${log.timestamp}`}
          style={{
            padding: 12,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.surface,
            gap: 4,
          }}
        >
          <MonoText size={10} color={c.textMuted}>{timeAgo(log.timestamp)} · {log.agent_id ?? 'unknown'}</MonoText>
          <MonoText size={12} color={c.text}>{log.message}</MonoText>
        </View>
      ))}
    </View>
  )
}

export function DashboardScreen() {
  const { palette: c } = useTheme()
  const { user, role } = useAuthStore()
  const { selectedAgentId, selectAgent } = useUiStore()

  const fleetQ = useFleetHealth()
  const agentsQ = useAgents()
  const logsQ = useLogs({ limit: 20 }, true)

  const agents = agentsQ.data ?? []

  useEffect(() => {
    if (!agents.length) return
    if (!selectedAgentId) {
      selectAgent(agents[0].agent_id)
    }
  }, [agents, selectedAgentId, selectAgent])

  const activeAgentId = selectedAgentId ?? agents[0]?.agent_id ?? null
  const activeAgent = useMemo(() => agents.find((a) => a.agent_id === activeAgentId) ?? null, [agents, activeAgentId])

  const liveMetrics = useLiveMetrics(activeAgentId)

  const refreshing = fleetQ.isFetching || agentsQ.isFetching || logsQ.isFetching

  const handleRefresh = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    fleetQ.refetch()
    agentsQ.refetch()
    logsQ.refetch()
  }

  const cpuData = liveMetrics.latest.cpu?.data as Record<string, any> | undefined
  const ramData = liveMetrics.latest.ram?.data as Record<string, any> | undefined
  const storageData = liveMetrics.latest.storage?.data as Record<string, any> | undefined
  const gpuData = liveMetrics.latest.gpu?.data as Record<string, any> | undefined
  const networkData = liveMetrics.latest.network?.data as Record<string, any> | undefined

  const osDisk = storageData?.os_disk
    ?? storageData?.disks?.[0]
    ?? storageData?.partitions?.find((p: any) => p.mount_point === '/')
    ?? storageData?.partitions?.[0]

  const cpuUsage = Number(cpuData?.usage_pct ?? 0)
  const ramUsage = Number(ramData?.usage_pct ?? 0)
  const gpuUsage = Number(gpuData?.summary?.avg_utilization_pct ?? 0)
  const osDiskUsage = Number(osDisk?.usage_pct ?? 0)

  const ramDetail = ramData ? `${formatBytes(ramData.used_bytes ?? 0)} / ${formatBytes(ramData.total_bytes ?? 0)}` : undefined
  const osDiskDetail = osDisk ? `${formatBytes(osDisk.used_bytes ?? 0)} / ${formatBytes(osDisk.total_bytes ?? 0)}` : undefined

  const primaryIface = networkData?.interfaces?.find((i: any) => i.name && i.name !== 'lo') ?? networkData?.interfaces?.[0]
  const netRxHistory = liveMetrics.history.netRx.map((v) => v / 1024)
  const netTxHistory = liveMetrics.history.netTx.map((v) => v / 1024)

  const fleet = fleetQ.data

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 40 }}
        refreshControl={(
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={c.primary} />
        )}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <MonoText size={18} style={{ fontWeight: '700' }}>dashboard</MonoText>
            <MonoText size={11} color={c.textMuted}>
              {user ? `${user.username} · ${role}` : 'monitoring'}
            </MonoText>
          </View>
          <StatusDot color={fleetQ.isError ? c.danger : c.success} />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 4 }}>
          {agents.map((agent) => (
            <AgentPill
              key={agent.agent_id}
              hostname={agent.hostname}
              selected={agent.agent_id === activeAgentId}
              onPress={() => selectAgent(agent.agent_id)}
            />
          ))}
        </ScrollView>

        {fleetQ.isLoading ? (
          <LoadingState label="Loading fleet…" />
        ) : fleetQ.isError ? (
          <ErrorState message="Failed to load fleet" onRetry={() => fleetQ.refetch()} />
        ) : fleet && (
          <Card>
            <SectionHeader title="Fleet" count={fleet.agents.total} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              <SummaryTile label="Online" value={fleet.agents.online} color={c.success} hint="Active agents" />
              <SummaryTile label="Degraded" value={fleet.agents.degraded} color={c.warning} hint="Collector issues" />
              <SummaryTile label="Offline" value={fleet.agents.offline} color={c.danger} hint="Not reporting" />
              <SummaryTile label="Last update" value={fleet.timestamp ? timeAgo(fleet.timestamp) : '—'} />
            </View>
          </Card>
        )}

        <Card>
          <SectionHeader title="Live Metrics" description={activeAgent ? activeAgent.hostname : 'Select an agent'} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
            <ArcGauge value={cpuUsage} label="CPU" history={liveMetrics.history.cpu} />
            <ArcGauge value={ramUsage} label="RAM" detail={ramDetail} history={liveMetrics.history.ram} />
            <ArcGauge value={osDiskUsage} label="OS Disk" detail={osDiskDetail} />
            <ArcGauge value={gpuUsage} label="GPU" history={liveMetrics.history.gpu} />
          </View>
          {primaryIface && (
            <View style={{ marginTop: 24, gap: 12 }}>
              <SectionHeader title="Network" description={primaryIface.name} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 16 }}>
                <View style={{ flex: 1 }}>
                  <MonoText size={10} color={c.textMuted}>Download</MonoText>
                  <MonoText size={16} color={c.success} style={{ fontWeight: '700' }}>{formatBandwidth(primaryIface.rx_bytes_rate ?? 0)}</MonoText>
                  <Sparkline data={netRxHistory} color={c.success} />
                </View>
                <View style={{ flex: 1 }}>
                  <MonoText size={10} color={c.textMuted}>Upload</MonoText>
                  <MonoText size={16} color={c.primary} style={{ fontWeight: '700' }}>{formatBandwidth(primaryIface.tx_bytes_rate ?? 0)}</MonoText>
                  <Sparkline data={netTxHistory} color={c.primary} />
                </View>
              </View>
            </View>
          )}
        </Card>

        <Card>
          <SectionHeader title="Recent Logs" description="Latest ingested events" />
          {logsQ.isLoading ? (
            <LoadingState label="Loading logs…" />
          ) : logsQ.isError ? (
            <ErrorState message="Failed to load logs" onRetry={() => logsQ.refetch()} />
          ) : (
            <LogsList logs={logsQ.data ?? []} />
          )}
        </Card>
      </ScrollView>
    </View>
  )
}
