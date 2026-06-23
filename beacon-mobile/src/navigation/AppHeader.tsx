import React from 'react'
import { View, Text } from 'react-native'
import { useTheme } from '@/theme'

export type TabId =
  | 'dashboard'
  | 'agents'
  | 'metrics'
  | 'logs'
  | 'health'
  | 'operations'
  | 'audit'
  | 'users'
  | 'settings'
  | 'config'
  | 'organizations'
  | 'reports'
  | 'ai-analyst'
  | 'ai-workbench'

export interface TabDef {
  id: TabId
  label: string
  icon?: string
  renderIcon?: (color: string) => React.ReactNode
  allowedRoles?: string[]
  requiresApproval?: boolean
}

export function AppHeader({ tab }: { tab: TabDef }) {
  const { palette: c } = useTheme()
  const accentMap: Record<string, string> = {
    dashboard: '#8b5cf6',
    agents: '#22c55e',
    metrics: '#3b82f6',
    logs: '#f97316',
    health: '#10b981',
    operations: '#06b6d4',
    audit: '#eab308',
    users: '#ec4899',
    config: '#f59e0b',
    settings: '#64748b',
    organizations: '#34d399',
    reports: '#38bdf8',
    'ai-analyst': '#f472b6',
    'ai-workbench': '#a855f7',
  }

  const accent = accentMap[tab.id] ?? '#3b82f6'

  return (
    <View
      style={{
        height: 68,
        paddingHorizontal: 18,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: c.surface,
        borderBottomWidth: 1,
        borderBottomColor: c.border,
      }}
    >
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: 14,
          backgroundColor: c.surface2,
          borderWidth: 1,
          borderColor: c.border,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 14,
        }}
      >
        {tab.renderIcon ? (
          tab.renderIcon(accent)
        ) : (
          <Text
            style={{
              fontSize: 18,
              color: accent,
            }}
          >
            {tab.icon}
          </Text>
        )}
      </View>

      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: c.text,
            fontSize: 18,
            fontWeight: '700',
            letterSpacing: -0.4,
          }}
        >
          {tab.label}
        </Text>

        <Text
          style={{
            color: c.textMuted,
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
