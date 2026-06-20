import { create } from 'zustand'
import * as SecureStore from 'expo-secure-store'
import { User, Role, JwtPayload } from '@/types'

const ACCESS_KEY = 'beacon_access'
const REFRESH_KEY = 'beacon_refresh'

interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  user: User | null
  role: Role | null
  isAuthenticated: boolean
  loaded: boolean
  setTokens: (access: string, refresh: string) => Promise<void>
  setUser: (u: User) => void
  logout: () => Promise<void>
  loadTokens: () => Promise<void>
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
  isAuthenticated: false,
  loaded: false,

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
          set({
            accessToken: access,
            refreshToken: refresh,
            role: payload.role,
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
    set({
      accessToken: access,
      refreshToken: refresh,
      role: payload?.role ?? null,
      isAuthenticated: true,
    })
  },

  setUser: (u) => set({ user: u }),

  logout: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_KEY),
      SecureStore.deleteItemAsync(REFRESH_KEY),
    ])
    set({
      accessToken: null,
      refreshToken: null,
      user: null,
      role: null,
      isAuthenticated: false,
    })
  },
}))
