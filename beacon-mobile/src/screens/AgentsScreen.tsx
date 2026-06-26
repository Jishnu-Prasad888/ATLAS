import React, { useState, useCallback, useMemo } from 'react'
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  RefreshControl, Alert, Modal, ScrollView,
} from 'react-native'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as Haptics from 'expo-haptics'
import { agentsApi, telemetryApi, healthApi, metricsConfigApi } from '@/api/endpoints'
import { Agent, Metric, MetricConfig, GpuData, SystemInventoryData, KernelData } from '@/types'
import { Card, StatusDot, SectionHeader, LoadingState, ErrorState, EmptyState, MonoText, Badge, Toggle, Divider } from '@/components/common'
import { formatBytes, formatPct, formatTs, formatUptime, statusColor, timeAgo } from '@/utils/format'
import { useAuthStore } from '@/store/authStore'
import { useTheme } from '@/theme'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'

function AgentCard({ agent, onAction }: { agent: Agent; onAction: (a: Agent) => void }) {
  const color = agent.is_active ? '#22c55e' : '#ef4444'
  const status = agent.is_active ? 'active' : 'inactive'
  const { palette: c } = useTheme()

  return (
    <Card style={{ marginBottom: 10 }} onPress={() => onAction(agent)}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ marginTop: 3 }}>
          <StatusDot color={color} size={9} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <MonoText size={14} style={{ fontWeight: '700' }}>{agent.hostname}</MonoText>
          <MonoText size={10} color={c.textMuted}>{agent.agent_id.slice(0, 20)}…</MonoText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
            {agent.os && (
              <Badge label={agent.os} />
            )}
            {agent.version && (
              <Badge label={`v${agent.version}`} />
            )}
            {agent.tags.slice(0, 3).map(t => (
              <Badge key={t} label={t} color={c.primary} bg={c.primary + '18'} />
            ))}
          </View>
          <MonoText size={9} color={c.textDim} style={{ marginTop: 4 }}>
            last seen {timeAgo(agent.last_seen)}
          </MonoText>
        </View>
        <View style={{
          backgroundColor: color + '18', borderRadius: 20,
          paddingHorizontal: 8, paddingVertical: 3,
        }}>
          <MonoText size={10} color={color}>{status}</MonoText>
        </View>
      </View>
    </Card>
  )
}

export function AgentsScreen() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'stale'>('all')
  const [detailAgent, setDetailAgent] = useState<Agent | null>(null)
  const { role } = useAuthStore()
  const qc = useQueryClient()
  const canManage = role === 'administrator'
  const { palette: c } = useTheme()
  const debouncedSearch = useDebouncedValue(search, 200)

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['agents'],
    queryFn: () => agentsApi.list().then(r => r.data),
  })

  const disableMut = useMutation({
    mutationFn: (id: string) => agentsApi.disable(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] })
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    },
    onError: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  })

  const enableMut = useMutation({
    mutationFn: (id: string) => agentsApi.enable(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] })
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    },
    onError: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => agentsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] })
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    },
    onError: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  })

  const handleAction = useCallback((agent: Agent) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setDetailAgent(agent)
  }, [])

  const onRefresh = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    refetch()
  }, [refetch])

  const agents = data ?? []
  const filtered = useMemo(() => {
    const term = debouncedSearch.toLowerCase().trim()
    return agents.filter(a => {
      const matchesSearch = !term
        || a.hostname.toLowerCase().includes(term)
        || a.agent_id.toLowerCase().includes(term)
        || a.tags.some(t => t.toLowerCase().includes(term))

      const matchesStatus =
        statusFilter === 'all'
        || (statusFilter === 'active' && a.is_active && !a.is_stale)
        || (statusFilter === 'inactive' && !a.is_active)
        || (statusFilter === 'stale' && a.is_stale)

      return matchesSearch && matchesStatus
    })
  }, [agents, debouncedSearch, statusFilter])
  const total = filtered.length

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {/* Search bar */}
      <View style={{ padding: 16, paddingBottom: 8 }}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search agents…"
          placeholderTextColor={c.textMuted}
          style={{
            backgroundColor: c.inputBg, borderWidth: 1, borderColor: c.inputBorder,
            borderRadius: 8, padding: 10, color: c.text,
            fontSize: 13, fontFamily: 'SpaceMono-Regular',
          }}
        />
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {([
            ['all', 'All'],
            ['active', 'Active'],
            ['stale', 'Stale'],
            ['inactive', 'Disabled'],
          ] as const).map(([key, label]) => {
            const active = statusFilter === key
            return (
              <TouchableOpacity
                key={key}
                onPress={() => setStatusFilter(key)}
                activeOpacity={0.8}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: active ? c.primary : c.border,
                  backgroundColor: active ? c.primary + '22' : c.surface,
                }}
              >
                <MonoText size={11} color={active ? c.primary : c.textMuted}>{label}</MonoText>
              </TouchableOpacity>
            )
          })}
        </View>
      </View>

      {isLoading ? (
        <LoadingState label="Loading agents…" />
      ) : isError ? (
        <ErrorState message="Failed to load agents" onRetry={refetch} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={a => a.agent_id}
          contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 32 }}
          ListHeaderComponent={
            <SectionHeader title="Agents" count={total} />
          }
          ListEmptyComponent={<EmptyState label="No agents found" icon="◎" />}
          refreshControl={
            <RefreshControl refreshing={isFetching} onRefresh={onRefresh} tintColor="#3b82f6" />
          }
          renderItem={({ item }) => <AgentCard agent={item} onAction={handleAction} />}
        />
      )}
      {detailAgent && (
        <AgentDetailSheet
          agent={detailAgent}
          onClose={() => setDetailAgent(null)}
          onEnable={() => enableMut.mutate(detailAgent.agent_id)}
          onDisable={() => disableMut.mutate(detailAgent.agent_id)}
          onDelete={() => {
            Alert.alert('Delete Agent', `Delete ${detailAgent.hostname}?`, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => deleteMut.mutate(detailAgent.agent_id) },
            ])
          }}
        />
      )}
    </View>
  )
}

function AgentDetailSheet({
  agent,
  onClose,
  onEnable,
  onDisable,
  onDelete,
}: {
  agent: Agent
  onClose: () => void
  onEnable: () => void
  onDisable: () => void
  onDelete: () => void
}) {
  const { palette: c } = useTheme()
  const queryClient = useQueryClient()
  const isActive = agent.is_active
  const color = statusColor(agent.status)

  const metricsQ = useQuery({
    queryKey: ['agent-latest', agent.agent_id],
    queryFn: async () => {
      const response = await telemetryApi.latest(agent.agent_id)
      return response.data ?? {}
    },
    refetchInterval: 15_000,
  })

  const healthQ = useQuery({
    queryKey: ['agent-health', agent.agent_id],
    queryFn: async () => {
      const response = await healthApi.agent(agent.agent_id)
      return response.data
    },
    refetchInterval: 15_000,
  })

  const configQ = useQuery({
    queryKey: ['metrics-config', agent.agent_id],
    queryFn: async () => {
      const response = await metricsConfigApi.get(agent.agent_id)
      return response.data as MetricConfig
    },
  })

  const updateConfig = useMutation({
    mutationFn: (patch: Partial<MetricConfig>) => metricsConfigApi.update(agent.agent_id, patch).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['metrics-config', agent.agent_id] })
    },
  })

  const latestMetrics = metricsQ.data as Record<string, Metric> | undefined
  const gpuMetric = latestMetrics?.gpu as Metric | undefined
  const gpuData = gpuMetric?.data as GpuData | undefined
  const inventoryMetric = latestMetrics?.system_inventory as Metric | undefined
  const systemInventory = inventoryMetric?.data as SystemInventoryData | undefined
  const kernelMetric = latestMetrics?.kernel as Metric | undefined
  const kernel = kernelMetric?.data as KernelData | undefined

  const collectorEntries = useMemo(() => {
    const collectors = healthQ.data?.collectors ?? {}
    return Object.entries(collectors)
  }, [healthQ.data?.collectors])

  const collectorToggleFields: Array<{ key: keyof MetricConfig; label: string }> = [
    { key: 'cpu_enabled', label: 'CPU' },
    { key: 'ram_enabled', label: 'RAM' },
    { key: 'network_enabled', label: 'Network' },
    { key: 'storage_enabled', label: 'Storage' },
    { key: 'process_enabled', label: 'Processes' },
    { key: 'systemd_enabled', label: 'Systemd' },
    { key: 'docker_enabled', label: 'Docker' },
    { key: 'kubernetes_enabled', label: 'Kubernetes' },
    { key: 'temperature_enabled', label: 'Temperature' },
    { key: 'power_enabled', label: 'Power' },
    { key: 'gpu_enabled', label: 'GPU' },
  ]

  const handleToggleCollector = (field: keyof MetricConfig, value: boolean) => {
    updateConfig.mutate({ [field]: value })
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#00000099', justifyContent: 'flex-end' }}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={{ backgroundColor: c.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderColor: c.border, maxHeight: '80%' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 }}>
            <StatusDot color={color} size={10} />
            <MonoText size={15} style={{ fontWeight: '700', flex: 1 }}>{agent.hostname}</MonoText>
            <TouchableOpacity onPress={onClose} style={{ padding: 6 }}>
              <MonoText size={12} color={c.textMuted}>Close</MonoText>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 28, gap: 18 }}>
            <View>
              <MonoText size={11} color={c.textMuted}>{agent.agent_id}</MonoText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                {agent.tags.map((tag) => (
                  <Badge key={tag} label={tag} color={c.primary} bg={c.primary + '22'} />
                ))}
                {agent.is_stale && <Badge label="stale" color={c.warning} bg={c.warning + '22'} />}
              </View>
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
              <Info label="OS" value={agent.os || '—'} />
              <Info label="Arch" value={agent.architecture || '—'} />
              <Info label="Version" value={agent.version ? `v${agent.version}` : '—'} />
              <Info label="Last seen" value={timeAgo(agent.last_seen)} />
            </View>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                onPress={isActive ? onDisable : onEnable}
                style={{ flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: isActive ? c.warning + '15' : c.success + '15' }}
              >
                <MonoText size={13} color={isActive ? c.warning : c.success} style={{ textAlign: 'center', fontWeight: '600' }}>
                  {isActive ? 'Disable' : 'Enable'}
                </MonoText>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onDelete}
                style={{ paddingHorizontal: 18, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.danger + '15' }}
              >
                <MonoText size={13} color={c.danger} style={{ textAlign: 'center', fontWeight: '600' }}>Delete</MonoText>
              </TouchableOpacity>
            </View>

            <View>
              <SectionHeader title="Collectors" description="Toggle metric collectors" />
              {configQ.isLoading ? (
                <LoadingState label="Loading collectors…" />
              ) : configQ.isError ? (
                <ErrorState message="Failed to load collector config" onRetry={() => configQ.refetch()} />
              ) : (
                <View style={{ gap: 12 }}>
                  {collectorToggleFields.map(({ key, label }) => (
                    <View key={key as string} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12 }}>
                      <View>
                        <MonoText size={12} color={c.text}>{label}</MonoText>
                        <MonoText size={10} color={c.textMuted}>{key}</MonoText>
                      </View>
                      <Toggle
                        checked={Boolean(configQ.data?.[key])}
                        onChange={(next) => handleToggleCollector(key, next)}
                        disabled={updateConfig.isPending}
                      />
                    </View>
                  ))}
                </View>
              )}
            </View>

            <Divider />

            <View>
              <SectionHeader title="Collector health" />
              {healthQ.isLoading ? (
                <LoadingState label="Loading collector health…" />
              ) : healthQ.isError ? (
                <ErrorState message="Failed to load collector health" onRetry={() => healthQ.refetch()} />
              ) : collectorEntries.length === 0 ? (
                <EmptyState label="No collectors reported" />
              ) : (
                <View style={{ gap: 8 }}>
                  {collectorEntries.map(([name, info]) => {
                    const entry = info as { status: string; last_run: string | null; failure_count: number }
                    const badgeColor = entry.status?.toLowerCase?.() === 'healthy' || entry.status?.toLowerCase?.() === 'ok'
                      ? c.success
                      : entry.status?.toLowerCase?.() === 'running'
                        ? c.primary
                        : c.danger
                    return (
                      <View key={name} style={{ borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <MonoText size={12} color={c.text}>{name}</MonoText>
                          <Badge label={entry.status} color={badgeColor} bg={badgeColor + '22'} />
                        </View>
                        <MonoText size={10} color={c.textMuted} style={{ marginTop: 4 }}>
                          Last run {entry.last_run ? timeAgo(entry.last_run) : 'never'} · Failures {entry.failure_count}
                        </MonoText>
                      </View>
                    )
                  })}
                </View>
              )}
            </View>

            {gpuData && (
              <View>
                <SectionHeader title="GPU" />
                {gpuData.collector_disabled ? (
                  <MonoText size={11} color={c.textMuted}>Collector disabled</MonoText>
                ) : gpuData.gpus.length === 0 ? (
                  <MonoText size={11} color={c.textMuted}>No GPUs detected</MonoText>
                ) : (
                  <View style={{ gap: 10 }}>
                    {gpuData.gpus.map((gpu) => (
                      <View key={gpu.uuid} style={{ borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, gap: 6 }}>
                        <MonoText size={12} color={c.text}>{gpu.name || `GPU ${gpu.index}`}</MonoText>
                        <MonoText size={10} color={c.textMuted}>{gpu.uuid}</MonoText>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <MonoText size={10} color={c.textMuted}>Utilization</MonoText>
                          <MonoText size={11} color={c.text}>{formatPct(gpu.utilization_pct)}</MonoText>
                        </View>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <MonoText size={10} color={c.textMuted}>Memory</MonoText>
                          <MonoText size={11} color={c.text}>{formatBytes(gpu.memory_used_mb * 1024 * 1024)} / {formatBytes(gpu.memory_total_mb * 1024 * 1024)}</MonoText>
                        </View>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <MonoText size={10} color={c.textMuted}>Temp</MonoText>
                          <MonoText size={11} color={c.text}>{gpu.temperature_c.toFixed(1)}°C</MonoText>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}

            {systemInventory && (
              <View style={{ gap: 12 }}>
                <SectionHeader title="System inventory" />
                <View style={{ gap: 8 }}>
                  <Info label="CPU model" value={systemInventory.cpu_model ?? '—'} />
                  <Info label="Shell" value={systemInventory.shell ?? '—'} />
                  <Info label="Displays" value={systemInventory.displays?.monitors != null ? String(systemInventory.displays.monitors) : '—'} />
                  <Info label="Battery" value={systemInventory.battery?.present ? `${systemInventory.battery.capacity_pct ?? '—'}% ${systemInventory.battery.status ?? ''}` : 'No battery'} />
                  <Info label="Users" value={systemInventory.users?.join(', ') || '—'} />
                </View>
              </View>
            )}

            {kernel && (
              <View>
                <SectionHeader title="Kernel" />
                <View style={{ gap: 6 }}>
                  <Info label="Version" value={kernel.kernel_version} />
                  <Info label="Uptime" value={formatUptime(kernel.uptime_secs)} />
                </View>
              </View>
            )}

            {Object.keys(agent.metadata).length > 0 && (
              <View>
                <SectionHeader title="Metadata" />
                <View style={{ gap: 6 }}>
                  {Object.entries(agent.metadata).map(([key, value]) => (
                    <Info key={key} label={key} value={String(value)} />
                  ))}
                </View>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  const { palette: c } = useTheme()
  return (
    <View style={{ minWidth: '45%' }}>
      <MonoText size={10} color={c.textMuted} style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</MonoText>
      <MonoText size={12} color={c.text} numberOfLines={2}>{value}</MonoText>
    </View>
  )
}
