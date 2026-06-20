import React, { useState, useCallback, useEffect } from 'react'
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native'

import { useQuery } from '@tanstack/react-query'
import * as Haptics from 'expo-haptics'
import { telemetryApi } from '@/api/endpoints'
import { agentsApi } from '@/api/endpoints'
import { Metric, CpuData, RamData, StorageData, NetworkData } from '@/types'
import {
  Card, SectionHeader, LoadingState, ErrorState, MonoText,
  MetricBar, StatusDot,
} from '@/components/common'
import { ArrowDown, ArrowUp } from 'lucide-react-native'
import { formatBytes, formatPct, formatTs, clamp } from '@/utils/format'

const safeNumber = (v: unknown, fallback = 0) => (typeof v === 'number' && !Number.isNaN(v) ? v : fallback)

function CpuCard({ metric }: { metric: Metric }) {
  const d = metric.data as CpuData
  const pct = safeNumber(d.usage_pct)
  const color = pct > 80 ? '#ef4444' : pct > 50 ? '#f97316' : '#22c55e'
  const pctTextColor = pct > 80 ? '#fca5a5' : pct > 50 ? '#fdba74' : '#86efac'
  return (
    <Card style={{ flex: 1, padding: 12 }}>
      <MonoText size={9} color="#ffffff" style={{ textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>CPU</MonoText>
      <Text style={{ fontSize: 26, color: pctTextColor, fontFamily: 'SpaceMono-Regular', fontWeight: '700', lineHeight: 30 }}>
        {pct.toFixed(1)}%
      </Text>
      <MetricBar value={pct} color={color} height={3} style={{ marginVertical: 8 }} />
      {typeof d.load_1 === 'number' && (
        <MonoText size={9} color="#ffffff">load {safeNumber(d.load_1).toFixed(2)} / {safeNumber(d.load_5).toFixed(2)} / {safeNumber(d.load_15).toFixed(2)}</MonoText>
      )}
      {typeof d.freq_mhz === 'number' && (
        <MonoText size={9} color="#ffffff">{(d.freq_mhz / 1000).toFixed(2)} GHz</MonoText>
      )}
      {typeof d.temp_c === 'number' && (
        <MonoText size={9} color="#ffffff">{safeNumber(d.temp_c).toFixed(0)}°C</MonoText>
      )}
      {Array.isArray(d.per_core) && d.per_core.some(c => typeof c === 'number') && (
        <View style={{ marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 3 }}>
          {d.per_core
            .map((c, i) => ({ value: safeNumber(c, NaN), i }))
            .filter(({ value }) => !Number.isNaN(value))
            .map(({ value, i }) => {
              const cc = value > 80 ? '#ef4444' : value > 50 ? '#f97316' : '#22c55e'
              const pc = value > 80 ? '#fca5a5' : value > 50 ? '#fdba74' : '#86efac'
              return (
                <View key={i} style={{ alignItems: 'center', gap: 2, minWidth: 28 }}>
                  <MonoText size={8} color={pc}>{value.toFixed(0)}%</MonoText>
                  <View style={{ width: 24, height: 2, backgroundColor: '#1e252e', borderRadius: 2, overflow: 'hidden' }}>
                    <View style={{ width: `${clamp(value, 0, 100)}%`, height: '100%', backgroundColor: cc, borderRadius: 2 }} />
                  </View>
                  <MonoText size={7} color="#ffffff">{i}</MonoText>
                </View>
              )
            })}
        </View>
      )}
      <MonoText size={8} color="#ffffff" style={{ marginTop: 8 }}>{formatTs(metric.timestamp)}</MonoText>
    </Card>
  )
}

function RamCard({ metric }: { metric: Metric }) {
  const d = metric.data as RamData
  const pct = safeNumber(d.usage_pct)
  const color = pct > 85 ? '#ef4444' : pct > 65 ? '#eab308' : '#22c55e'
  const pctTextColor = pct > 85 ? '#fca5a5' : pct > 65 ? '#fdba74' : '#86efac'
  return (
    <Card style={{ flex: 1, padding: 12 }}>
      <MonoText size={9} color="#ffffff" style={{ textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Memory</MonoText>
      <Text style={{ fontSize: 26, color: pctTextColor, fontFamily: 'SpaceMono-Regular', fontWeight: '700', lineHeight: 30 }}>
        {pct.toFixed(1)}%
      </Text>
      <MetricBar value={pct} color={color} height={3} style={{ marginVertical: 8 }} />
      <MonoText size={9} color="#ffffff">{formatBytes(d.used_bytes)}</MonoText>
      <MonoText size={9} color="#ffffff">of {formatBytes(d.total_bytes)}</MonoText>
      {d.swap_total ? (
        <View style={{ marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#1e252e' }}>
          <MonoText size={8} color="#ffffff" style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>Swap</MonoText>
          <MonoText size={9} color="#ffffff">{formatBytes(d.swap_used ?? 0)} / {formatBytes(d.swap_total)}</MonoText>
        </View>
      ) : null}
      <MonoText size={8} color="#ffffff" style={{ marginTop: 8 }}>{formatTs(metric.timestamp)}</MonoText>
    </Card>
  )
}

function NetworkCard({ metric }: { metric: Metric }) {
  const d = metric.data as NetworkData
  const offWhite = '#d4dae3'
  return (
    <Card style={{ marginBottom: 10 }}>
      <SectionHeader title="Network" count={d.interfaces?.length} color={offWhite} />
      {d.interfaces?.map((iface, idx) => (
        <View
          key={iface.name}
          style={{
            borderTopWidth: idx === 0 ? 0 : 1,
            borderTopColor: '#1e252e',
            paddingTop: idx === 0 ? 4 : 14,
            paddingBottom: 14,
            alignItems: 'center',
          }}
        >
          {/* Interface name */}
          <MonoText size={13} style={{ fontWeight: '700', marginBottom: 10 }}>{iface.name}</MonoText>

          {/* RX / TX row */}
          <View style={{ flexDirection: 'row', width: '100%', justifyContent: 'center', gap: 0 }}>
            {/* RX */}
            <View style={{ flex: 1, alignItems: 'center', paddingVertical: 8, backgroundColor: '#0d1117', borderRadius: 8, marginHorizontal: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                <ArrowDown size={12} color={offWhite} />
                <MonoText size={9} color={offWhite} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>Download</MonoText>
              </View>
              <MonoText size={16} color="#22c55e" style={{ fontWeight: '700' }}>{formatBytes(iface.rx_bytes_rate)}/s</MonoText>
              <View style={{ height: 1, width: '60%', backgroundColor: '#1e252e', marginVertical: 5 }} />
              <MonoText size={9} color={offWhite}>Total received</MonoText>
              <MonoText size={10} color={offWhite}>{formatBytes(iface.rx_bytes)}</MonoText>
            </View>

            {/* TX */}
            <View style={{ flex: 1, alignItems: 'center', paddingVertical: 8, backgroundColor: '#0d1117', borderRadius: 8, marginHorizontal: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                <ArrowUp size={12} color={offWhite} />
                <MonoText size={9} color={offWhite} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>Upload</MonoText>
              </View>
              <MonoText size={16} color="#3b82f6" style={{ fontWeight: '700' }}>{formatBytes(iface.tx_bytes_rate)}/s</MonoText>
              <View style={{ height: 1, width: '60%', backgroundColor: '#1e252e', marginVertical: 5 }} />
              <MonoText size={9} color={offWhite}>Total sent</MonoText>
              <MonoText size={10} color={offWhite}>{formatBytes(iface.tx_bytes)}</MonoText>
            </View>
          </View>

          {/* Errors row */}
          {iface.rx_errors != null && (
            <View style={{ marginTop: 8, alignItems: 'center' }}>
              <MonoText size={9} color={offWhite} style={{ textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>Errors</MonoText>
              <MonoText
                size={12}
                color={offWhite}
                style={{ fontWeight: '700' }}
              >
                {iface.rx_errors + (iface.tx_errors ?? 0) > 0
                  ? `${iface.rx_errors + (iface.tx_errors ?? 0)} detected`
                  : 'None'}
              </MonoText>
            </View>
          )}
        </View>
      ))}
      <MonoText size={9} color={offWhite} style={{ marginTop: 4, textAlign: 'center' }}>{formatTs(metric.timestamp)}</MonoText>
    </Card>
  )
}

function StorageCard({ metric }: { metric: Metric }) {
  const d = metric.data as StorageData
  return (
    <Card style={{ marginBottom: 10 }}>
      <SectionHeader title="Storage" count={d.disks?.length} />
      {d.disks?.map((disk, idx) => {
        const color = disk.usage_pct > 90 ? '#ef4444' : disk.usage_pct > 70 ? '#eab308' : '#22c55e'
        return (
          <View
            key={disk.device}
            style={{
              borderTopWidth: idx === 0 ? 0 : 1,
              borderTopColor: '#1e252e',
              paddingTop: idx === 0 ? 4 : 14,
              paddingBottom: 14,
              alignItems: 'center',
            }}
          >
            <MonoText size={13} style={{ fontWeight: '700', marginBottom: 2 }}>{disk.device}</MonoText>
            <MonoText size={9} color="#3a4555" style={{ marginBottom: 10 }}>{disk.mountpoint} · {disk.fstype}</MonoText>

            <Text style={{ fontSize: 28, color, fontFamily: 'SpaceMono-Regular', fontWeight: '700', marginBottom: 8 }}>
              {disk.usage_pct.toFixed(1)}%
            </Text>

            <View style={{ width: '80%', marginBottom: 8 }}>
              <MetricBar value={disk.usage_pct} color={color} height={4} />
            </View>

            <View style={{ flexDirection: 'row', gap: 20, alignItems: 'center' }}>
              <View style={{ alignItems: 'center' }}>
                <MonoText size={9} color="#3a4555" style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>Used</MonoText>
                <MonoText size={11} color="#5a6878">{formatBytes(disk.used_bytes)}</MonoText>
              </View>
              <View style={{ width: 1, height: 24, backgroundColor: '#1e252e' }} />
              <View style={{ alignItems: 'center' }}>
                <MonoText size={9} color="#3a4555" style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>Total</MonoText>
                <MonoText size={11} color="#5a6878">{formatBytes(disk.total_bytes)}</MonoText>
              </View>
            </View>
          </View>
        )
      })}
      <MonoText size={9} color="#2a3240" style={{ marginTop: 4, textAlign: 'center' }}>{formatTs(metric.timestamp)}</MonoText>
    </Card>
  )
}

export function MetricsScreen() {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [activePanel, setActivePanel] = useState<'network' | 'storage'>('network')

  const agentsQ = useQuery({
    queryKey: ['agents-brief'],
    queryFn: () => agentsApi.list().then(r => r.data),
  })

  const latestQ = useQuery({
    queryKey: ['metrics-latest', selectedAgent],
    queryFn: () =>
      telemetryApi.latest(selectedAgent!).then(r => r.data),
    enabled: !!selectedAgent,
    refetchInterval: 10_000,
  })

  const onRefresh = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    latestQ.refetch()
  }, [latestQ])

  const agents = agentsQ.data ?? []

  useEffect(() => {
    if (agents.length > 0 && !selectedAgent) {
      setSelectedAgent(agents[0].agent_id)
    }
  }, [agents, selectedAgent])

  const byType = (type: string) => latestQ.data?.[type]

  return (
    <View style={{ flex: 1, backgroundColor: '#0b0d0f' }}>
      {/* Agent picker */}
      <View style={{ backgroundColor: '#111418', borderBottomWidth: 1, borderBottomColor: '#1e252e' }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 12, gap: 8, flexDirection: 'row' }}>
          {agents.map((a) => {
            const active = selectedAgent === a.agent_id
            return (
              <TouchableOpacity
                key={a.agent_id}
                onPress={() => {
                  setSelectedAgent(a.agent_id)
                  Haptics.selectionAsync()
                }}
                style={{
                  paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
                  borderWidth: 1,
                  borderColor: active ? '#3b82f6' : '#1e252e',
                  backgroundColor: active ? '#1e3a5f' : 'transparent',
                }}
              >
                <MonoText size={12} color={active ? '#3b82f6' : '#5a6878'}>{a.hostname}</MonoText>
              </TouchableOpacity>
            )
          })}
          {agents.length === 0 && (
            <MonoText size={11} color="#3a4555" style={{ paddingVertical: 6 }}>No agents</MonoText>
          )}
        </ScrollView>
      </View>

      {!selectedAgent ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <MonoText size={13} color="#3a4555">Select an agent to view metrics</MonoText>
        </View>
      ) : latestQ.isLoading ? (
        <LoadingState label="Loading metrics…" />
      ) : latestQ.isError ? (
        <ErrorState message="Failed to load metrics" onRetry={() => latestQ.refetch()} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          refreshControl={
            <RefreshControl refreshing={latestQ.isFetching} onRefresh={onRefresh} tintColor="#3b82f6" />
          }
        >
          {/* Bento grid: CPU + RAM side by side */}
          {(byType('cpu') || byType('ram')) && (
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
              {byType('cpu') && <CpuCard metric={byType('cpu')!} />}
              {byType('ram') && <RamCard metric={byType('ram')!} />}
            </View>
          )}

          {/* Modern segmented control */}
          {(byType('network') || byType('storage')) && (
            <View
              style={{
                flexDirection: 'row',
                backgroundColor: '#111418',
                borderRadius: 16,
                padding: 4,
                marginBottom: 14,
                borderWidth: 1,
                borderColor: '#1e252e',
                overflow: 'hidden',
              }}
            >
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => {
                  setActivePanel('network')
                  Haptics.selectionAsync()
                }}
                style={{
                  flex: 1,
                  height: 44,
                  borderRadius: 12,
                  justifyContent: 'center',
                  alignItems: 'center',
                  backgroundColor:
                    activePanel === 'network'
                      ? '#3b82f6'
                      : 'transparent',
                }}
              >
                <MonoText
                  size={12}
                  color={
                    activePanel === 'network'
                      ? '#ffffff'
                      : '#6b7280'
                  }
                  style={{
                    fontWeight: '700',
                    letterSpacing: 0.5,
                  }}
                >
                  Network
                </MonoText>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => {
                  setActivePanel('storage')
                  Haptics.selectionAsync()
                }}
                style={{
                  flex: 1,
                  height: 44,
                  borderRadius: 12,
                  justifyContent: 'center',
                  alignItems: 'center',
                  backgroundColor:
                    activePanel === 'storage'
                      ? '#22c55e'
                      : 'transparent',
                }}
              >
                <MonoText
                  size={12}
                  color={
                    activePanel === 'storage'
                      ? '#ffffff'
                      : '#6b7280'
                  }
                  style={{
                    fontWeight: '700',
                    letterSpacing: 0.5,
                  }}
                >
                  Storage
                </MonoText>
              </TouchableOpacity>
            </View>
          )}

          {activePanel === 'network' &&
            byType('network') && (
              <NetworkCard metric={byType('network')!} />
          )}

          {activePanel === 'storage' &&
            byType('storage') && (
              <StorageCard metric={byType('storage')!} />
          )}

          {(!latestQ.data || Object.keys(latestQ.data).length === 0) && (
            <View style={{ alignItems: 'center', paddingVertical: 32 }}>
              <MonoText size={13} color="#3a4555">No metrics available for this agent</MonoText>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  )
}