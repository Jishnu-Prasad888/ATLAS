import { create } from 'zustand'
import { setTokens as setApiTokens, clearTokens, parseJwt } from '@/api'
import type { JwtPayload, Role } from '@/types'

interface AuthUser {
  id: number
  username: string
  role: Role
  exp: number
}

interface AuthState {
  user: AuthUser | null
  isAuthenticated: boolean
  isHydrating: boolean
  isAdmin: boolean
  refreshToken: string | null
  accessToken: string | null
  refreshTimer: ReturnType<typeof setTimeout> | null
}

interface AuthActions {
  login: (access: string, refresh: string) => void
  logout: () => void
  setHydrated: () => void
  scheduleRefresh: (exp: number) => void
  clearRefreshTimer: () => void
}

export type AuthStore = AuthState & AuthActions

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isHydrating: true,
  isAdmin: false,
  refreshToken: null,
  accessToken: null,
  refreshTimer: null,

  login(access, refresh) {
    const payload = parseJwt<JwtPayload>(access)
    setApiTokens(access, refresh)

    const user: AuthUser = {
      id: payload.user_id,
      username: payload.username,
      role: payload.role,
      exp: payload.exp,
    }

    set({
      user,
      isAuthenticated: true,
      isAdmin: payload.role === 'administrator',
      accessToken: access,
      refreshToken: refresh,
    })

    get().scheduleRefresh(payload.exp)
  },

  logout() {
    get().clearRefreshTimer()
    clearTokens()
    set({
      user: null,
      isAuthenticated: false,
      isAdmin: false,
      accessToken: null,
      refreshToken: null,
    })
  },

  scheduleRefresh(exp) {
    get().clearRefreshTimer()

    const msUntilRefresh = exp * 1000 - Date.now() - 5 * 60 * 1000

    if (msUntilRefresh <= 0) {
      // Already near expiry — trigger immediately via custom event
      window.dispatchEvent(new CustomEvent('beacon:silent-refresh'))
      return
    }

    const timer = setTimeout(() => {
      window.dispatchEvent(new CustomEvent('beacon:silent-refresh'))
    }, msUntilRefresh)

    set({ refreshTimer: timer })
  },

  setHydrated() {
    set({ isHydrating: false })
  },

  clearRefreshTimer() {
    const { refreshTimer } = get()
    if (refreshTimer) {
      clearTimeout(refreshTimer)
      set({ refreshTimer: null })
    }
  },
}))
