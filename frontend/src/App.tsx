import { Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppLayout } from '@/components/layout/AppLayout'
import { RequireAuth, RequireAdmin, RedirectIfAuthenticated, AuthEventHandler } from '@/components/auth/RouteGuards'
import { LoadingState } from '@/components/common'
import { LoginPage } from '@/pages/LoginPage'
import { RecoverPage } from '@/pages/RecoverPage'

const DashboardPage = lazy(() => import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })))
const AgentsPage = lazy(() => import('@/pages/AgentsPage').then((m) => ({ default: m.AgentsPage })))
const MetricsPage = lazy(() => import('@/pages/MetricsPage').then((m) => ({ default: m.MetricsPage })))
const LogsPage = lazy(() => import('@/pages/LogsPage').then((m) => ({ default: m.LogsPage })))
const HealthPage = lazy(() => import('@/pages/HealthPage').then((m) => ({ default: m.HealthPage })))
const AuditPage = lazy(() => import('@/pages/AuditPage').then((m) => ({ default: m.AuditPage })))
const UsersPage = lazy(() => import('@/pages/UsersPage').then((m) => ({ default: m.UsersPage })))
const ConfigPage = lazy(() => import('@/pages/ConfigPage').then((m) => ({ default: m.ConfigPage })))
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, retryDelay: 1000, staleTime: 5_000, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
})

function PageSuspense({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<LoadingState label="Loading..." />}>{children}</Suspense>
}

function AuthedPage({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <AppLayout>
        <PageSuspense>{children}</PageSuspense>
      </AppLayout>
    </RequireAuth>
  )
}

function AdminPage({ children }: { children: React.ReactNode }) {
  return (
    <RequireAdmin>
      <AppLayout>
        <PageSuspense>{children}</PageSuspense>
      </AppLayout>
    </RequireAdmin>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthEventHandler />
        <Routes>
          <Route path="/login" element={<RedirectIfAuthenticated><LoginPage /></RedirectIfAuthenticated>} />
          <Route path="/recover" element={<RedirectIfAuthenticated><RecoverPage /></RedirectIfAuthenticated>} />
          <Route path="/" element={<AuthedPage><DashboardPage /></AuthedPage>} />
          <Route path="/agents" element={<AuthedPage><AgentsPage /></AuthedPage>} />
          <Route path="/metrics" element={<AuthedPage><MetricsPage /></AuthedPage>} />
          <Route path="/logs" element={<AuthedPage><LogsPage /></AuthedPage>} />
          <Route path="/health" element={<AuthedPage><HealthPage /></AuthedPage>} />
          <Route path="/settings" element={<AuthedPage><SettingsPage /></AuthedPage>} />
          <Route path="/audit" element={<AdminPage><AuditPage /></AdminPage>} />
          <Route path="/users" element={<AdminPage><UsersPage /></AdminPage>} />
          <Route path="/config" element={<AdminPage><ConfigPage /></AdminPage>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
