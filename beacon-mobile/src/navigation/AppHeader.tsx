import React from 'react'
import { View, Text } from 'react-native'

export type TabId =
  | 'dashboard' | 'agents' | 'metrics' | 'logs'
  | 'health' | 'operations' | 'audit' | 'users' | 'settings'

export interface TabDef {
  id: TabId
  label: string
  icon: string
  adminOnly?: boolean
  operatorPlus?: boolean
}

export function AppHeader({ tab }: { tab: TabDef }) {
  const accentMap: Record<string, string> = {
    dashboard: '#8b5cf6',
    agents: '#22c55e',
    metrics: '#3b82f6',
    logs: '#f97316',
    health: '#10b981',
    operations: '#06b6d4',
    audit: '#eab308',
    users: '#ec4899',
    settings: '#64748b',
  }

  const accent = accentMap[tab.id] ?? '#3b82f6'

  return (
    <View
      style={{
        height: 68,
        paddingHorizontal: 18,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#111418',
        borderBottomWidth: 1,
        borderBottomColor: '#1f2937',
      }}
    >
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: 14,
          backgroundColor: '#1a2028',
          borderWidth: 1,
          borderColor: '#2b3441',
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 14,
        }}
      >
        <Text
          style={{
            fontSize: 18,
            color: accent,
          }}
        >
          {tab.icon}
        </Text>
      </View>

      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: '#f8fafc',
            fontSize: 18,
            fontWeight: '700',
            letterSpacing: -0.4,
          }}
        >
          {tab.label}
        </Text>

        <Text
          style={{
            color: '#64748b',
            fontSize: 12,
            marginTop: 1,
          }}
        >
          Control Center
        </Text>
      </View>

      <View
        style={{
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 999,
          backgroundColor: `${accent}15`,
          borderWidth: 1,
          borderColor: `${accent}35`,
        }}
      >
        <View
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            backgroundColor: accent,
          }}
        />
      </View>
    </View>
  )
}