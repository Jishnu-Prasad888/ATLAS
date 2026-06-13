import { request } from './client'
import type { TokenPair, User } from '@/types'

export const authApi = {
  login: (username: string, password: string) =>
    request<TokenPair>({
      method: 'POST',
      url: '/auth/login/',
      data: { username, password },
    }),

  logout: (refresh: string) =>
    request<{ detail: string }>({
      method: 'POST',
      url: '/auth/logout/',
      data: { refresh },
    }),

  refresh: (refresh: string) =>
    request<TokenPair>({
      method: 'POST',
      url: '/auth/refresh/',
      data: { refresh },
    }),

  whoami: () =>
    request<User>({ method: 'GET', url: '/auth/whoami/' }),

  changePassword: (old_password: string, new_password: string) =>
    request<{ detail: string }>({
      method: 'POST',
      url: '/auth/password/change/',
      data: { old_password, new_password },
    }),

  recoverPassword: (username: string, recovery_key: string, new_password: string) =>
    request<{ detail: string; new_recovery_key: string }>({
      method: 'POST',
      url: '/auth/password/recover/',
      data: { username, recovery_key, new_password },
    }),

  generateRecoveryKey: () =>
    request<{ recovery_key: string; warning: string }>({
      method: 'POST',
      url: '/auth/recovery-key/generate/',
      data: {},
    }),
}
