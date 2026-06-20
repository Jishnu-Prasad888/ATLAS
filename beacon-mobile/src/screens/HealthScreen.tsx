import React, { useCallback } from 'react'
import { View, FlatList, RefreshControl } from 'react-native'

import { useQuery } from '@tanstack/react-query'
import * as Haptics from 'expo-haptics'
import { healthApi, agentsApi } from '@/api/endpoints'
import { Agent } from '@/types'
import { Card, SectionHeader, LoadingState, ErrorState, EmptyState, MonoText, StatusDot } from '@/components/common'
import { statusColor, timeAgo } from '@/utils/format'

function AgentCard({ agent }: { agent: Agent }) {
  const color = statusColor(agent.status)
  const failedCols = agent.collector_health.filter(c => c.status !== 'ok' && c.status !== 'healthy').length

  return (
    <Card style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <StatusDot color={color} size={9} />
        <MonoText size={14} style={{ flex: 1, fontWeight: '700' }}>{agent.hostname}</MonoText>
        <View style={{ backgroundColor: color + '20', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 }}>
          <MonoText size={10} color={color}>{agent.status}</MonoText>
        </View>
      </View>

      <MonoText size={9} color="#5a6878">last seen {timeAgo(agent.last_seen)}</MonoText>

      {agent.is_stale && (
        <View style={{
          marginTop: 8, backgroundColor: '#2a2200', borderRadius: 6,
          borderWidth: 1, borderColor: '#eab30830', padding: 8,
        }}>
          <MonoText size={10} color="#eab308">⚠ Agent is stale — not recently reporting</MonoText>
        </View>
      )}

      {agent.collector_health.length > 0 && (
        <View style={{ marginTop: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
            <MonoText size={9} color="#3a4555" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>Collectors</MonoText>
            {failedCols > 0 && (
              <MonoText size={9} color="#ef4444">{failedCols} issue{failedCols > 1 ? 's' : ''}</MonoText>
            )}
          </View>
          <View style={{ borderTopWidth: 1, borderTopColor: '#1e252e' }}>
            {agent.collector_health.map((col, i) => {
              const ok = col.status === 'ok' || col.status === 'healthy'
              const c = ok ? '#22c55e' : col.status === 'running' ? '#3b82f6' : '#ef4444'
              return (
                <View key={col.collector + i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4, gap: 8 }}>
                  <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: c }} />
                  <MonoText size={11} style={{ flex: 1 }}>{col.collector}</MonoText>
                  <MonoText size={10} color={c}>{col.status}</MonoText>
                  {col.failure_count > 0 && (
                    <View style={{ backgroundColor: '#2a0f0f', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 }}>
                      <MonoText size={9} color="#ef4444">{col.failure_count} fail</MonoText>
                    </View>
                  )}
                </View>
              )
            })}
          </View>
        </View>
      )}
    </Card>
  )
}

export function HealthScreen() {
  const overviewQ = useQuery({
    queryKey: ['fleet-health'],
    queryFn: () => healthApi.overview().then(r => r.data),
    refetchInterval: 15_000,
  })

  const agentsQ = useQuery({
    queryKey: ['agents'],
    queryFn: () => agentsApi.list().then(r => r.data),
    refetchInterval: 15_000,
  })

  const refreshing = overviewQ.isFetching || agentsQ.isFetching

  const onRefresh = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    overviewQ.refetch()
    agentsQ.refetch()
  }, [overviewQ, agentsQ])

  const data = overviewQ.data
  const agents = agentsQ.data ?? []

  return (
    <View style={{ flex: 1, backgroundColor: '#0b0d0f' }}>
      {/* Fleet summary bar */}
      {data && (
        <View style={{
          backgroundColor: '#111418', borderBottomWidth: 1, borderBottomColor: '#1e252e',
          padding: 14, flexDirection: 'row', gap: 20,
        }}>
          {[
            { label: 'Total', value: data.agents.total, color: '#d4dae3' },
            { label: 'Online', value: data.agents.online, color: '#22c55e' },
            { label: 'Degraded', value: data.agents.degraded, color: '#eab308' },
            { label: 'Offline', value: data.agents.offline, color: '#ef4444' },
          ].map(({ label, value, color }) => (
            <View key={label} style={{ alignItems: 'center' }}>
              <MonoText size={18} color={color} style={{ fontWeight: '700' }}>{value}</MonoText>
              <MonoText size={9} color="#3a4555">{label}</MonoText>
            </View>
          ))}
        </View>
      )}

      {agentsQ.isLoading ? (
        <LoadingState label="Loading health data…" />
      ) : agentsQ.isError ? (
        <ErrorState message="Failed to load fleet health" onRetry={onRefresh} />
      ) : (
        <FlatList
          data={agents}
          keyExtractor={a => a.agent_id}
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          ListHeaderComponent={<SectionHeader title="Agents" count={agents.length} />}
          ListEmptyComponent={<EmptyState label="No agents registered" icon="◎" />}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />
          }
          renderItem={({ item }) => <AgentCard agent={item} />}
        />
      )}
    </View>
  )
}
