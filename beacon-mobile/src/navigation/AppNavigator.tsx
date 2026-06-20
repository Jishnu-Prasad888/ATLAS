import React, { useEffect, useState } from 'react'
import {
  View, Text,
  StatusBar,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuthStore } from '@/store/authStore'
import { useSettingsStore } from '@/store/settingsStore'
import { LoginScreen } from '@/screens/LoginScreen'
import { DashboardScreen } from '@/screens/DashboardScreen'
import { AgentsScreen } from '@/screens/AgentsScreen'
import { MetricsScreen } from '@/screens/MetricsScreen'
import { LogsScreen } from '@/screens/LogsScreen'
import { HealthScreen } from '@/screens/HealthScreen'
import { OperationsScreen } from '@/screens/OperationsScreen'
import { AuditScreen } from '@/screens/AuditScreen'
import { UsersScreen } from '@/screens/UsersScreen'
import { SettingsScreen } from '@/screens/SettingsScreen'
import { ConfigScreen } from '@/screens/ConfigScreen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BottomTabBar } from '@/components/navigation/BottomTabBar'
import { AppHeader, TabDef, TabId } from './AppHeader'
import { useTheme } from '@/theme'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: 1,
      retryDelay: 1_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
})

// ─── Tab definition ───────────────────────────────────────────────────────────

const TABS: TabDef[] = [
  { id: 'dashboard',   label: 'Home',    icon: '⬡' },
  { id: 'health',      label: 'Health',  icon: '◈' },
  { id: 'agents',      label: 'Agents',  icon: '◎' },
  { id: 'metrics',     label: 'Metrics', icon: '▦' },
  { id: 'logs',        label: 'Logs',    icon: '≡' },
  { id: 'operations',  label: 'Ops',     icon: '⊙', operatorPlus: true },
  { id: 'users',       label: 'Users',   icon: '◈', adminOnly: true },
  { id: 'audit',       label: 'Audit',   icon: '◇', adminOnly: true },
  { id: 'config',      label: 'Config',  icon: '◧', adminOnly: true },
  { id: 'settings',    label: 'Settings',icon: '⚙' },
]

function ScreenFor({ tab }: { tab: TabId }) {
  switch (tab) {
    case 'dashboard':   return <DashboardScreen />
    case 'agents':      return <AgentsScreen />
    case 'metrics':     return <MetricsScreen />
    case 'logs':        return <LogsScreen />
    case 'health':      return <HealthScreen />
    case 'operations':  return <OperationsScreen />
    case 'audit':       return <AuditScreen />
    case 'users':       return <UsersScreen />
    case 'config':      return <ConfigScreen />
    case 'settings':    return <SettingsScreen />
    default:            return <DashboardScreen />
  }
}

// ─── Main App ─────────────────────────────────────────────────────────────────

function AppShell() {
  const insets = useSafeAreaInsets()
  const { isAuthenticated, loaded, loadTokens, role } = useAuthStore()
  const { load: loadSettings } = useSettingsStore()
  const [activeTab, setActiveTab] = useState<TabId>('dashboard')
  const { palette: c } = useTheme()

  useEffect(() => {
    loadSettings()
    loadTokens()
  }, [])

  if (!loaded) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 28, color: c.textMuted }}>◈</Text>
        <Text style={{ color: c.textMuted, fontFamily: 'SpaceMono-Regular', fontSize: 11, marginTop: 10 }}>
          beacon
        </Text>
      </View>
    )
  }

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
        <StatusBar barStyle={c.mode === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={c.bg} />
        <LoginScreen />
      </SafeAreaView>
    )
  }

  // Filter tabs by role
  const visibleTabs = TABS.filter(t => {
    if (t.adminOnly) return role === 'administrator'
    if (t.operatorPlus) return role === 'administrator'
    return true
  })

  // Clamp active tab if role changed
  const validTab = visibleTabs.find(t => t.id === activeTab) ? activeTab : visibleTabs[0].id
  const activeTabDef = visibleTabs.find(t => t.id === validTab) ?? visibleTabs[0]

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <StatusBar barStyle={c.mode === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={c.surface} />
      <View style={{ paddingTop: insets.top }}>
        <AppHeader tab={activeTabDef} />
      </View>
      <View style={{ flex: 1, paddingTop: 4, paddingBottom: 4 }}>
        <ScreenFor tab={validTab} />
      </View>
      <BottomTabBar tabs={visibleTabs} active={validTab} onSelect={setActiveTab} />
    </View>
  )
}

export default function RootApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell />
    </QueryClientProvider>
  )
}
