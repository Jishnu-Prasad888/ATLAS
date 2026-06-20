import React, { useCallback } from 'react'
import {
  View, Text, ScrollView, RefreshControl, TouchableOpacity,
} from 'react-native'

import { useQuery } from '@tanstack/react-query'
import * as Haptics from 'expo-haptics'
import { dashboardApi, DashboardSummary } from '@/api/endpoints'
import { healthApi } from '@/api/endpoints'
import { FleetHealth } from '@/types'
import { Card, SectionHeader, LoadingState, ErrorState, StatusDot, MetricBar, MonoText } from '@/components/common'
import { statusColor, timeAgo } from '@/utils/format'
import { useAuthStore } from '@/store/authStore'

function StatTile({ label, value, sub, accent = '#3b82f6' }: {
  label: string; value: string | number; sub?: string; accent?: string
}) {
  return (
    <View style={{
      flex: 1, backgroundColor: '#111418', borderWidth: 1,
      borderColor: '#1e252e', borderRadius: 10, padding: 14, minWidth: 0,
    }}>
      <Text style={{ fontSize: 9, color: '#3a4555', fontFamily: 'SpaceMono-Regular', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
        {label}
      </Text>
      <Text style={{ fontSize: 20, color: accent, fontFamily: 'SpaceMono-Regular', fontWeight: '700' }}>
        {value}
      </Text>
      {sub ? (
        <Text style={{ fontSize: 9, color: '#5a6878', fontFamily: 'SpaceMono-Regular', marginTop: 2 }}>{sub}</Text>
      ) : null}
    </View>
  )
}

export function DashboardScreen() {
  const { user, role } = useAuthStore()

  const summaryQ = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => dashboardApi.summary(),
    refetchInterval: 15_000,
  })

  const fleetQ = useQuery({
    queryKey: ['fleet-health'],
    queryFn: () => healthApi.overview().then(r => r.data),
    refetchInterval: 15_000,
  })

  const refreshing = summaryQ.isFetching || fleetQ.isFetching

  const onRefresh = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    summaryQ.refetch()
    fleetQ.refetch()
  }, [summaryQ, fleetQ])

  const s: DashboardSummary | undefined = summaryQ.data
  const fleet: FleetHealth | undefined = fleetQ.data

  return (
    <View style={{ flex: 1, backgroundColor: '#0b0d0f' }}>
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 32 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor="#3b82f6"
          colors={['#3b82f6']}
        />
      }
    >
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
        <View style={{ flex: 1 }}>
          <MonoText size={18} style={{ fontWeight: '700' }}>dashboard</MonoText>
          <MonoText size={11} color="#5a6878">
            {user ? `${user.username} · ${role}` : 'monitoring'}
          </MonoText>
        </View>
        <View style={{
          width: 8, height: 8, borderRadius: 4,
          backgroundColor: summaryQ.isError ? '#ef4444' : '#22c55e',
        }} />
      </View>

      {/* Summary tiles */}
      {summaryQ.isLoading ? (
        <LoadingState label="Loading summary…" />
      ) : summaryQ.isError ? (
        <ErrorState message="Failed to load summary" onRetry={() => summaryQ.refetch()} />
      ) : s ? (
        <>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <StatTile label="Online" value={s.agents.online} sub={`${s.agents.total} total`} accent="#22c55e" />
            <StatTile label="Offline" value={s.agents.offline} sub={`${s.agents.stale} stale`} accent="#ef4444" />
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <StatTile label="Metrics/h" value={s.metrics_last_hour} accent="#3b82f6" />
            <StatTile label="Logs/h" value={s.logs_last_hour} accent="#a855f7" />
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <StatTile label="Degraded" value={s.agents.degraded} sub="Collectors or health issues" accent="#eab308" />
            <StatTile label="Stale" value={s.agents.stale} sub="Agents not reporting" accent="#f97316" />
          </View>
        </>
      ) : null}

      {/* Fleet health */}
      <Card style={{ marginTop: 4 }}>
        <SectionHeader
          title="Fleet"
          count={fleet?.agents.total}
          right={
            fleet ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <StatusDot color="#22c55e" size={6} />
                  <MonoText size={10} color="#5a6878">{fleet.agents.online}</MonoText>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <StatusDot color="#eab308" size={6} />
                  <MonoText size={10} color="#5a6878">{fleet.agents.degraded}</MonoText>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <StatusDot color="#ef4444" size={6} />
                  <MonoText size={10} color="#5a6878">{fleet.agents.offline}</MonoText>
                </View>
              </View>
            ) : null
          }
        />

        {fleetQ.isLoading ? (
          <LoadingState label="Loading fleet…" />
        ) : fleetQ.isError ? (
          <ErrorState message="Failed to load fleet" onRetry={() => fleetQ.refetch()} />
        ) : (
          <View style={{ paddingVertical: 8 }}>
            <MonoText size={10} color="#5a6878" style={{ textAlign: 'center' }}>
              server: {fleet?.server_status ?? '?'} · {fleet?.timestamp ? new Date(fleet.timestamp).toLocaleString() : ''}
            </MonoText>
          </View>
        )}
      </Card>
    </ScrollView>
    </View>
  )
}
