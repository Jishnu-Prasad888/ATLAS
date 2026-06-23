import React, { useEffect, useState } from 'react'
import {
  View, Text,
  StatusBar,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Brain } from 'lucide-react-native'
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
import { AiAnalystScreen } from '@/screens/AiAnalystScreen'
import { AiWorkbenchScreen } from '@/screens/AiWorkbenchScreen'
import { OrganizationsScreen } from '@/screens/OrganizationsScreen'
import { ReportsScreen } from '@/screens/ReportsScreen'
import { AwaitingApprovalScreen } from '@/screens/AwaitingApprovalScreen'
import { ForbiddenScreen } from '@/screens/ForbiddenScreen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BottomTabBar } from '@/components/navigation/BottomTabBar'
import { AppHeader, TabDef, TabId } from './AppHeader'
import { useTheme } from '@/theme'
import { authApi } from '@/api/endpoints'

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
  { id: 'dashboard', label: 'Home', icon: '⬡' },
  { id: 'health', label: 'Health', icon: '◈' },
  { id: 'agents', label: 'Agents', icon: '◎', allowedRoles: ['administrator', 'moderator', 'viewer'] },
  { id: 'metrics', label: 'Metrics', icon: '▦', allowedRoles: ['administrator', 'moderator', 'viewer'] },
  { id: 'logs', label: 'Logs', icon: '≡', allowedRoles: ['administrator', 'moderator', 'viewer'] },
  { id: 'operations', label: 'Ops', icon: '⊙', allowedRoles: ['administrator', 'moderator'] },
  { id: 'organizations', label: 'Orgs', icon: '▣', allowedRoles: ['administrator', 'moderator'] },
  { id: 'reports', label: 'Reports', icon: '✶', allowedRoles: ['administrator', 'moderator', 'viewer'] },
  {
    id: 'ai-analyst',
    label: 'AI',
    renderIcon: (color: string) => <Brain size={18} color={color} />,
    allowedRoles: ['administrator', 'moderator', 'viewer'],
  },
  { id: 'ai-workbench', label: 'Lab', icon: '☍', allowedRoles: ['administrator', 'moderator'] },
  { id: 'users', label: 'Users', icon: '◈', allowedRoles: ['administrator'] },
  { id: 'audit', label: 'Audit', icon: '◇', allowedRoles: ['administrator', 'moderator'] },
  { id: 'config', label: 'Config', icon: '◧', allowedRoles: ['administrator'] },
  { id: 'settings', label: 'Settings', icon: '⚙' },
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
    case 'organizations': return <OrganizationsScreen />
    case 'reports':     return <ReportsScreen />
    case 'ai-analyst':  return <AiAnalystScreen />
    case 'ai-workbench':return <AiWorkbenchScreen />
    default:            return <DashboardScreen />
  }
}

// ─── Main App ─────────────────────────────────────────────────────────────────

function AppShell() {
  const insets = useSafeAreaInsets()
  const {
    isAuthenticated,
    loaded,
    loadTokens,
    role,
    approvalStatus,
    isApproved,
    user,
    setUser,
  } = useAuthStore()
  const { load: loadSettings } = useSettingsStore()
  const [activeTab, setActiveTab] = useState<TabId>('dashboard')
  const { palette: c } = useTheme()

  useEffect(() => {
    loadSettings()
    loadTokens()
  }, [])

  useEffect(() => {
    if (!isAuthenticated || user) return
    let cancelled = false
    authApi.whoami()
      .then((res) => {
        if (!cancelled) setUser(res.data)
      })
      .catch(() => {
        // ignore — handled elsewhere
      })
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, setUser, user])

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

  if (!isApproved) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
        <StatusBar barStyle={c.mode === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={c.bg} />
        {approvalStatus === 'rejected' ? <ForbiddenScreen /> : <AwaitingApprovalScreen />}
      </SafeAreaView>
    )
  }

  // Filter tabs by role
  const currentRole = role ?? 'viewer'
  const visibleTabs = TABS.filter((tab) => {
    if (tab.requiresApproval && !isApproved) return false
    if (tab.allowedRoles && !tab.allowedRoles.includes(currentRole)) return false
    return true
  })

  const tabsToRender = visibleTabs.length > 0
    ? visibleTabs
    : [TABS.find((tab) => tab.id === 'settings') ?? TABS[0]]

  // Clamp active tab if role changed
  const validTab = tabsToRender.find(t => t.id === activeTab) ? activeTab : tabsToRender[0].id
  const activeTabDef = tabsToRender.find(t => t.id === validTab) ?? tabsToRender[0]

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <StatusBar barStyle={c.mode === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={c.surface} />
      <View style={{ paddingTop: insets.top }}>
        <AppHeader tab={activeTabDef} />
      </View>
      <View style={{ flex: 1, paddingTop: 4, paddingBottom: 4 }}>
        <ScreenFor tab={validTab} />
      </View>
      <BottomTabBar tabs={tabsToRender} active={validTab} onSelect={setActiveTab} />
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
