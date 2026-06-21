import { create } from 'zustand'
import { setTokens as setApiTokens, clearTokens, parseJwt } from '@/api'
import type { AccessScope, ApprovalStatus, JwtPayload, Role } from '@/types'

interface AuthUser {
  id: number
  username: string
  role: Role
   approvalStatus: ApprovalStatus
   approved: boolean
   expiresAt?: string | null
   accessScope: AccessScope
  exp: number
}

interface AuthState {
  user: AuthUser | null
  isAuthenticated: boolean
  isHydrating: boolean
  isAdmin: boolean
  isModerator: boolean
  isViewer: boolean
  isGuest: boolean
  isApproved: boolean
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
  canAccessAgent: (agentId: string | null | undefined) => boolean
  canAccessOrganization: (orgId: number | string | null | undefined) => boolean
}

export type AuthStore = AuthState & AuthActions

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isHydrating: true,
  isAdmin: false,
  isModerator: false,
  isViewer: false,
  isGuest: false,
  isApproved: false,
  refreshToken: null,
  accessToken: null,
  refreshTimer: null,

  login(access, refresh) {
    const payload = parseJwt<JwtPayload>(access)
    setApiTokens(access, refresh)

    const role = payload.role
    const accessScope: AccessScope = {
      access_all_agents: payload.access_all_agents ?? role !== 'guest',
      organization_ids: payload.organization_ids ?? [],
      agent_ids: payload.agent_ids ?? [],
    }

    const approvalStatus: ApprovalStatus =
      payload.approval_status ?? (payload.approved === false ? 'pending' : 'approved')
    const approved = role === 'administrator' ? true : payload.approved ?? approvalStatus === 'approved'

    const user: AuthUser = {
      id: payload.user_id,
      username: payload.username,
      role,
      approvalStatus,
      approved,
      expiresAt: payload.expires_at ?? null,
      accessScope,
      exp: payload.exp,
    }

    set({
      user,
      isAuthenticated: true,
      isAdmin: role === 'administrator',
      isModerator: role === 'moderator',
      isViewer: role === 'viewer',
      isGuest: role === 'guest',
      isApproved: approved,
      accessToken: access,
      refreshToken: refresh,
      isHydrating: false,
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
      isModerator: false,
      isViewer: false,
      isGuest: false,
      isApproved: false,
      accessToken: null,
      refreshToken: null,
      isHydrating: false,
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

  canAccessAgent(agentId) {
    if (!agentId) return false
    const { user, isAdmin } = get()
    if (isAdmin) return true
    if (!user) return false
    const { accessScope } = user
    if (accessScope.access_all_agents) return true
    return accessScope.agent_ids.includes(agentId)
  },

  canAccessOrganization(orgId) {
    if (orgId === null || orgId === undefined) return false
    const numeric = typeof orgId === 'string' ? Number(orgId) : orgId
    const { user, isAdmin } = get()
    if (isAdmin) return true
    if (!user) return false
    const { accessScope } = user
    if (accessScope.access_all_agents) return true
    return accessScope.organization_ids.includes(numeric)
  },
}))
