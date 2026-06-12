import { type ReactNode, useEffect } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { authApi } from '@/api'
import { getRefreshToken } from '@/api'
import { wsClient } from '@/ws/client'
import { useUiStore } from '@/store/uiStore'
import { LoadingState } from '@/components/common'

/**
 * Requires authentication. Redirects to /login if not authenticated.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isHydrating } = useAuthStore()
  const location = useLocation()

  if (isHydrating) {
    return <LoadingState label="Restoring session..." />
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}

/**
 * Requires administrator role. Redirects to / if authenticated but not admin.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAuthenticated, isAdmin, isHydrating } = useAuthStore()
  const location = useLocation()

  if (isHydrating) {
    return <LoadingState label="Restoring session..." />
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

/**
 * Redirects authenticated users away from login/recover pages.
 */
export function RedirectIfAuthenticated({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuthStore()

  if (isAuthenticated) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

/**
 * Listens for silent refresh events, token expiry, and session expiry.
 * Also manages WebSocket connection state.
 * Mount once at app root.
 */
export function AuthEventHandler() {
  const { login, logout, setHydrated } = useAuthStore()
  const { setWsConnected } = useUiStore()

  // Restore session from persisted refresh token on mount
  useEffect(() => {
    const rt = getRefreshToken()
    if (!rt) {
      setHydrated()
      return
    }

    authApi.refresh(rt)
      .then((tokens) => {
        login(tokens.access, tokens.refresh)
        wsClient.connect(tokens.access)
      })
      .catch(() => {
        logout()
      })
      .finally(() => {
        setHydrated()
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // Silent refresh triggered by the scheduled timer in authStore
    const handleSilentRefresh = async () => {
      const rt = getRefreshToken()
      if (!rt) return

      try {
        const tokens = await authApi.refresh(rt)
        login(tokens.access, tokens.refresh)
        wsClient.updateToken(tokens.access)
      } catch {
        logout()
        wsClient.destroy()
      }
    }

    // Session fully expired (refresh token dead)
    const handleSessionExpired = () => {
      logout()
    }

    window.addEventListener('beacon:silent-refresh', handleSilentRefresh)
    window.addEventListener('beacon:session-expired', handleSessionExpired)

    return () => {
      window.removeEventListener('beacon:silent-refresh', handleSilentRefresh)
      window.removeEventListener('beacon:session-expired', handleSessionExpired)
    }
  }, [login, logout])

  // Track WebSocket connection state
  useEffect(() => {
    const offConnected = wsClient.on('connected', () => setWsConnected(true))
    const offDisconnected = wsClient.on('disconnected', () => setWsConnected(false))
    const offExpired = wsClient.on('session-expired', () => {
      logout()
    })

    return () => {
      offConnected()
      offDisconnected()
      offExpired()
    }
  }, [logout, setWsConnected])

  return null
}
