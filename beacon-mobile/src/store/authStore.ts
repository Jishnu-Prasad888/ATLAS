import { create } from 'zustand'
import * as SecureStore from 'expo-secure-store'
import {
  User,
  Role,
  JwtPayload,
  ApprovalStatus,
  AccessScope,
} from '@/types'

const ACCESS_KEY = 'beacon_access'
const REFRESH_KEY = 'beacon_refresh'

interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  user: User | null
  role: Role | null
  approvalStatus: ApprovalStatus | null
  isApproved: boolean
  accessScope: AccessScope | null
  isAuthenticated: boolean
  loaded: boolean
  refreshTimer: ReturnType<typeof setTimeout> | null
  setTokens: (access: string, refresh: string) => Promise<void>
  setUser: (u: User) => void
  logout: () => Promise<void>
  loadTokens: () => Promise<void>
  clearRefreshTimer: () => void
}

function parseJwt(token: string): JwtPayload | null {
  try {
    const base64 = token.split('.')[1]
    const decoded = atob(base64)
    return JSON.parse(decoded)
  } catch {
    return null
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: null,
  refreshToken: null,
  user: null,
  role: null,
  approvalStatus: null,
  isApproved: false,
  accessScope: null,
  isAuthenticated: false,
  loaded: false,
  refreshTimer: null,

  loadTokens: async () => {
    try {
      const [access, refresh] = await Promise.all([
        SecureStore.getItemAsync(ACCESS_KEY),
        SecureStore.getItemAsync(REFRESH_KEY),
      ])
      if (access && refresh) {
        const payload = parseJwt(access)
        const isExpired = payload ? payload.exp * 1000 < Date.now() : true
        if (!isExpired && payload) {
          const approvalStatus: ApprovalStatus | null = (payload.approval_status as ApprovalStatus | undefined) ?? null
          const approved = payload.approved ?? approvalStatus === 'approved'
          const scope: AccessScope | null = {
            access_all_agents: payload.access_all_agents ?? false,
            organization_ids: payload.organization_ids ?? [],
            agent_ids: payload.agent_ids ?? [],
          }
          set({
            accessToken: access,
            refreshToken: refresh,
            role: payload.role,
            approvalStatus,
            isApproved: approved,
            accessScope: scope,
            isAuthenticated: true,
            loaded: true,
          })
          return
        }
      }
      set({ loaded: true })
    } catch {
      set({ loaded: true })
    }
  },

  setTokens: async (access, refresh) => {
    const payload = parseJwt(access)
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_KEY, access),
      SecureStore.setItemAsync(REFRESH_KEY, refresh),
    ])
    const approvalStatus: ApprovalStatus | null = (payload?.approval_status as ApprovalStatus | undefined) ?? null
    const approved = payload?.approved ?? approvalStatus === 'approved'
    const scope: AccessScope | null = payload
      ? {
          access_all_agents: payload.access_all_agents ?? false,
          organization_ids: payload.organization_ids ?? [],
          agent_ids: payload.agent_ids ?? [],
        }
      : null
    set({
      accessToken: access,
      refreshToken: refresh,
      role: payload?.role ?? null,
      approvalStatus,
      isApproved: !!approved,
      accessScope: scope,
      isAuthenticated: true,
    })
  },

  setUser: (u) => set(() => ({
    user: u,
    role: u.role,
    approvalStatus: u.approval_status ?? null,
    isApproved: u.approval_status ? u.approval_status === 'approved' : true,
    accessScope: u.access_scope ?? null,
  })),

  logout: async () => {
    const { clearRefreshTimer } = get()
    clearRefreshTimer()
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_KEY),
      SecureStore.deleteItemAsync(REFRESH_KEY),
    ])
    set({
      accessToken: null,
      refreshToken: null,
      user: null,
      role: null,
      approvalStatus: null,
      isApproved: false,
      accessScope: null,
      isAuthenticated: false,
    })
  },

  clearRefreshTimer: () => {
    const timer = get().refreshTimer
    if (timer) {
      clearTimeout(timer)
      set({ refreshTimer: null })
    }
  },
}))
