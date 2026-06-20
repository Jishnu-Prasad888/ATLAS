import React, { useState, useCallback, useMemo } from 'react'
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  RefreshControl, Alert,
} from 'react-native'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as Haptics from 'expo-haptics'
import { agentsApi } from '@/api/endpoints'
import { Agent } from '@/types'
import { Card, StatusDot, SectionHeader, LoadingState, ErrorState, EmptyState, MonoText, Badge } from '@/components/common'
import { statusColor, timeAgo } from '@/utils/format'
import { useAuthStore } from '@/store/authStore'

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
  const { role } = useAuthStore()
  const qc = useQueryClient()
  const canManage = role === 'administrator'

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
    if (!canManage) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

    const options: any[] = agent.is_active
      ? [{ text: 'Disable', style: 'destructive', onPress: () => disableMut.mutate(agent.agent_id) }]
      : [{ text: 'Enable', onPress: () => enableMut.mutate(agent.agent_id) }]

    if (role === 'administrator') {
      options.push({
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
       Alert.alert('Delete Agent', `Delete ${agent.hostname}?`, [
         { text: 'Cancel', style: 'cancel' },
         { text: 'Delete', style: 'destructive', onPress: () => deleteMut.mutate(agent.agent_id) },
       ])
        },
      })
    }

    Alert.alert(agent.hostname, `Agent ID: ${agent.agent_id.slice(0, 8)}…`, [
      ...options,
      { text: 'Cancel', style: 'cancel' },
    ])
  }, [canManage, role, disableMut, enableMut, deleteMut])

  const onRefresh = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    refetch()
  }, [refetch])

  const agents = data ?? []
  const filtered = useMemo(() => {
    if (!search.trim()) return agents
    const term = search.toLowerCase()
    return agents.filter(a =>
      a.hostname.toLowerCase().includes(term)
      || a.agent_id.toLowerCase().includes(term)
      || a.tags.some(t => t.toLowerCase().includes(term))
    )
  }, [agents, search])
  const total = filtered.length

  return (
    <View style={{ flex: 1, backgroundColor: '#0b0d0f' }}>
      {/* Search bar */}
      <View style={{ padding: 16, paddingBottom: 8 }}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search agents…"
          placeholderTextColor="#3a4555"
          style={{
            backgroundColor: '#111418', borderWidth: 1, borderColor: '#1e252e',
            borderRadius: 8, padding: 10, color: '#d4dae3',
            fontSize: 13, fontFamily: 'SpaceMono-Regular',
          }}
        />
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
    </View>
  )
}
