import React, { useState, useCallback, useMemo } from 'react'
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  RefreshControl, Alert, Modal,
} from 'react-native'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as Haptics from 'expo-haptics'
import { agentsApi } from '@/api/endpoints'
import { Agent } from '@/types'
import { Card, StatusDot, SectionHeader, LoadingState, ErrorState, EmptyState, MonoText, Badge } from '@/components/common'
import { statusColor, timeAgo } from '@/utils/format'
import { useAuthStore } from '@/store/authStore'
import { useTheme } from '@/theme'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'

function AgentCard({ agent, onAction }: { agent: Agent; onAction: (a: Agent) => void }) {
  const color = agent.is_active ? '#22c55e' : '#ef4444'
  const status = agent.is_active ? 'active' : 'inactive'

  return (
    <Card style={{ marginBottom: 10 }} onPress={() => onAction(agent)}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ marginTop: 3 }}>
          <StatusDot color={color} size={9} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <MonoText size={14} style={{ fontWeight: '700' }}>{agent.hostname}</MonoText>
          <MonoText size={10} color="#5a6878">{agent.agent_id.slice(0, 20)}…</MonoText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
            {agent.os && (
              <Badge label={agent.os} color="#5a6878" bg="#181c22" />
            )}
            {agent.version && (
              <Badge label={`v${agent.version}`} color="#5a6878" bg="#181c22" />
            )}
            {agent.tags.slice(0, 3).map(t => (
              <Badge key={t} label={t} color="#3b82f6" bg="#1e2e42" />
            ))}
          </View>
          <MonoText size={9} color="#3a4555" style={{ marginTop: 4 }}>
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
  const isActive = agent.is_active
  const stale = agent.is_stale
  const color = statusColor(agent.status)

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#00000099', justifyContent: 'flex-end' }}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={{ backgroundColor: c.surface, padding: 16, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderColor: c.border }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <StatusDot color={color} size={10} />
            <MonoText size={15} style={{ fontWeight: '700', flex: 1 }}>{agent.hostname}</MonoText>
            <TouchableOpacity onPress={onClose} style={{ padding: 6 }}>
              <MonoText size={12} color={c.textMuted}>Close</MonoText>
            </TouchableOpacity>
          </View>

          <MonoText size={11} color={c.textMuted} style={{ marginTop: 4 }}>{agent.agent_id}</MonoText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {agent.tags.slice(0, 4).map(t => <Badge key={t} label={t} color={c.primary} bg={c.primary + '22'} />)}
            {agent.is_stale && <Badge label="stale" color={c.warning} bg={c.warning + '22'} />}
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 12 }}>
            <Info label="OS" value={agent.os || '—'} />
            <Info label="Arch" value={agent.architecture || '—'} />
            <Info label="Version" value={agent.version ? 'v' + agent.version : '—'} />
            <Info label="Last seen" value={timeAgo(agent.last_seen)} />
          </View>

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
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
              style={{ padding: 12, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.danger + '15' }}
            >
              <MonoText size={13} color={c.danger} style={{ textAlign: 'center', fontWeight: '600' }}>Delete</MonoText>
            </TouchableOpacity>
          </View>
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
      <MonoText size={12} color={c.text}>{value}</MonoText>
    </View>
  )
}
