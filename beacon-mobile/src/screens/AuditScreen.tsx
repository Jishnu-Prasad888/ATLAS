import React, { useState, useCallback } from 'react'
import { View, FlatList, TextInput, RefreshControl, TouchableOpacity } from 'react-native'

import { useQuery } from '@tanstack/react-query'
import * as Haptics from 'expo-haptics'
import { auditApi } from '@/api/endpoints'
import { AuditLog } from '@/types'
import { Card, LoadingState, ErrorState, EmptyState, MonoText, SectionHeader } from '@/components/common'
import { formatTs, timeAgo } from '@/utils/format'
import { useTheme } from '@/theme'

function AuditRow({ log }: { log: AuditLog }) {
  const [expanded, setExpanded] = useState(false)
  const color = log.success ? '#22c55e' : '#ef4444'

  return (
    <TouchableOpacity
      onPress={() => { setExpanded(v => !v); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light) }}
      activeOpacity={0.8}
    >
      <Card style={{ marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          <View style={{ width: 3, borderRadius: 2, backgroundColor: color, alignSelf: 'stretch' }} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <MonoText size={13} style={{ fontWeight: '700' }}>{log.action}</MonoText>
              <MonoText size={9} color="#3a4555">{timeAgo(log.timestamp)}</MonoText>
            </View>
            <MonoText size={11} color="#5a6878">{log.resource} · {log.resource_id}</MonoText>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 5 }}>
              <MonoText size={10} color="#3b82f6">{log.user}</MonoText>
              {log.ip_address && <MonoText size={10} color="#3a4555">{log.ip_address}</MonoText>}
              <View style={{ backgroundColor: color + '20', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 }}>
                <MonoText size={9} color={color}>{log.success ? 'success' : 'failed'}</MonoText>
              </View>
            </View>
            {expanded && Object.keys(log.details).length > 0 && (
              <View style={{ marginTop: 10, backgroundColor: '#181c22', borderRadius: 6, padding: 10 }}>
                <MonoText size={9} color="#3a4555" style={{ marginBottom: 4 }}>DETAILS</MonoText>
                <MonoText size={10} color="#5a6878">{JSON.stringify(log.details, null, 2)}</MonoText>
              </View>
            )}
          </View>
        </View>
      </Card>
    </TouchableOpacity>
  )
}

export function AuditScreen() {
  const [search, setSearch] = useState('')
  const { palette: c } = useTheme()
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['audit', search],
    queryFn: () =>
      auditApi.list({
        user: search || undefined,
        limit: 500,
      }).then(r => r.data),
    placeholderData: (prev) => prev,
  })

  const onRefresh = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    refetch()
  }, [refetch])

  const logs = data ?? []

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ padding: 16, paddingBottom: 8 }}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Filter by user…"
          placeholderTextColor="#3a4555"
          style={{
            backgroundColor: c.inputBg, borderWidth: 1, borderColor: c.inputBorder,
            borderRadius: 8, padding: 10, color: c.text,
            fontSize: 12, fontFamily: 'SpaceMono-Regular',
          }}
        />
      </View>

      {isLoading ? (
        <LoadingState label="Loading audit logs…" />
      ) : isError ? (
        <ErrorState message="Failed to load audit log" onRetry={refetch} />
      ) : (
        <FlatList
          data={logs}
          keyExtractor={l => l.id.toString()}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
          ListHeaderComponent={<SectionHeader title="Audit Log" count={logs.length} />}
          ListEmptyComponent={<EmptyState label="No audit events found" icon="◇" />}
          refreshControl={
            <RefreshControl refreshing={isFetching} onRefresh={onRefresh} tintColor="#3b82f6" />
          }
          renderItem={({ item }) => <AuditRow log={item} />}
        />
      )}
    </View>
  )
}
