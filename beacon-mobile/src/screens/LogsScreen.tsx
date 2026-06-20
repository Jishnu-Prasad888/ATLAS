import React, { useState, useCallback, useRef } from 'react'
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  RefreshControl, ScrollView,
} from 'react-native'

import { useQuery } from '@tanstack/react-query'
import * as Haptics from 'expo-haptics'
import { logsApi } from '@/api/endpoints'
import { LogEntry, LogSeverity } from '@/types'
import { LoadingState, ErrorState, EmptyState, MonoText, Divider } from '@/components/common'
import { severityColor, formatTs } from '@/utils/format'
import { useBeaconWs } from '@/ws/useBeaconWs'

const SEVERITIES: LogSeverity[] = ['Critical', 'Error', 'Warning', 'Info', 'Debug', 'Trace']

function SevChip({ sev, active, onPress }: { sev: string; active: boolean; onPress: () => void }) {
  const color = severityColor(sev)
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
        borderWidth: 1,
        borderColor: active ? color : '#1e252e',
        backgroundColor: active ? color + '22' : 'transparent',
      }}
    >
      <MonoText size={10} color={active ? color : '#5a6878'}>{sev}</MonoText>
    </TouchableOpacity>
  )
}

function LogRow({ entry }: { entry: LogEntry }) {
  const color = severityColor(entry.severity)
  return (
    <View style={{ paddingVertical: 8, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#1e252e' }}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 3 }}>
        <View style={{ width: 3, height: 12, backgroundColor: color, borderRadius: 2 }} />
        <MonoText size={9} color={color} style={{ textTransform: 'uppercase' }}>{entry.severity}</MonoText>
        <MonoText size={9} color="#3a4555">{formatTs(entry.timestamp)}</MonoText>
        <MonoText size={9} color="#3a4555">·</MonoText>
        <MonoText size={9} color="#5a6878">{entry.source}</MonoText>
      </View>
      <Text style={{ fontSize: 12, color: '#d4dae3', fontFamily: 'SpaceMono-Regular', lineHeight: 18, paddingLeft: 11 }}>
        {entry.message}
      </Text>
    </View>
  )
}

export function LogsScreen() {
  const [search, setSearch] = useState('')
  const [severity, setSeverity] = useState<LogSeverity | undefined>()
  const [liveLogs, setLiveLogs] = useState<LogEntry[]>([])
  const [liveMode, setLiveMode] = useState(false)
  const listRef = useRef<FlatList>(null)

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['logs', search, severity],
    queryFn: () =>
      logsApi.list({ search: search || undefined, severity, limit: 1000 }).then(r => r.data),
    enabled: !liveMode,
  })

  const handleWsMessage = useCallback((msg: unknown) => {
    const entry = msg as LogEntry
    if (!entry?.id) return
    setLiveLogs(prev => [entry, ...prev].slice(0, 200))
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  }, [])

  const { status: wsStatus } = useBeaconWs({
    channel: 'logs',
    onMessage: handleWsMessage,
    enabled: liveMode,
  })

  const toggleLive = useCallback(() => {
    setLiveMode(v => !v)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setLiveLogs([])
  }, [])

  const onRefresh = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    refetch()
  }, [refetch])

  const displayLogs = liveMode ? liveLogs : (data ?? [])

  return (
    <View style={{ flex: 1, backgroundColor: '#0b0d0f' }}>
      {/* Toolbar */}
      <View style={{ backgroundColor: '#111418', borderBottomWidth: 1, borderBottomColor: '#1e252e', padding: 12, gap: 10 }}>
        {/* Search + live toggle */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search logs…"
            placeholderTextColor="#3a4555"
            editable={!liveMode}
            style={{
              flex: 1, backgroundColor: '#0b0d0f', borderWidth: 1, borderColor: '#1e252e',
              borderRadius: 8, padding: 8, color: '#d4dae3',
              fontSize: 12, fontFamily: 'SpaceMono-Regular',
            }}
          />
          <TouchableOpacity
            onPress={toggleLive}
            style={{
              paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
              borderWidth: 1,
              borderColor: liveMode ? '#22c55e' : '#1e252e',
              backgroundColor: liveMode ? '#0f2e1a' : 'transparent',
              flexDirection: 'row', alignItems: 'center', gap: 6,
            }}
          >
            <View style={{
              width: 6, height: 6, borderRadius: 3,
              backgroundColor: liveMode ? '#22c55e' : '#3a4555',
            }} />
            <MonoText size={11} color={liveMode ? '#22c55e' : '#5a6878'}>
              {liveMode ? (wsStatus === 'connected' ? 'live' : wsStatus) : 'live'}
            </MonoText>
          </TouchableOpacity>
        </View>

        {/* Severity filters */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, flexDirection: 'row' }}>
          <SevChip
            sev="all"
            active={!severity}
            onPress={() => { setSeverity(undefined); Haptics.selectionAsync() }}
          />
          {SEVERITIES.map(s => (
            <SevChip
              key={s}
              sev={s}
              active={severity === s}
              onPress={() => { setSeverity(s); Haptics.selectionAsync() }}
            />
          ))}
        </ScrollView>
      </View>

      {/* Count row */}
      {!liveMode && data && (
        <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
          <MonoText size={10} color="#3a4555">{data.length} entries</MonoText>
        </View>
      )}

      {isLoading && !liveMode ? (
        <LoadingState label="Loading logs…" />
      ) : isError && !liveMode ? (
        <ErrorState message="Failed to load logs" onRetry={refetch} />
      ) : (
        <FlatList
          ref={listRef}
          data={displayLogs}
          keyExtractor={(item, i) => item.id?.toString() ?? i.toString()}
          renderItem={({ item }) => <LogRow entry={item} />}
          ListEmptyComponent={
            <EmptyState
              label={liveMode ? 'Waiting for log events…' : 'No logs found'}
              icon="○"
            />
          }
          refreshControl={
            !liveMode ? (
              <RefreshControl refreshing={isFetching} onRefresh={onRefresh} tintColor="#3b82f6" />
            ) : undefined
          }
        />
      )}
    </View>
  )
}
