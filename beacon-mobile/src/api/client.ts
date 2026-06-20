import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import { useSettingsStore } from '@/store/settingsStore'
import { useAuthStore } from '@/store/authStore'

let _client: AxiosInstance | null = null

export function getApiClient(): AxiosInstance {
  if (_client) return _client

  const { settings } = useSettingsStore.getState()
  const base = (settings.apiBaseUrl || '') + (settings.apiPrefix || '/api/v1')

  _client = axios.create({
    baseURL: base,
    timeout: 15_000,
    headers: { 'Content-Type': 'application/json' },
  })

  // Request interceptor: attach access token
  _client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const { accessToken } = useAuthStore.getState()
    if (accessToken && config.headers) {
      config.headers.Authorization = `Bearer ${accessToken}`
    }
    return config
  })

  // Response interceptor: refresh on 401
  _client.interceptors.response.use(
    (r) => r,
    async (err) => {
      const original = err.config
      if (err.response?.status === 401 && !original._retry) {
        original._retry = true
        try {
          const { refreshToken, setTokens, logout } = useAuthStore.getState()
          if (!refreshToken) {
            await logout()
            return Promise.reject(err)
          }
          const { settings: s } = useSettingsStore.getState()
          const refreshBase = (s.apiBaseUrl || '') + (s.apiPrefix || '/api/v1')
          const res = await axios.post(`${refreshBase}/auth/refresh/`, {
            refresh: refreshToken,
          })
          await setTokens(res.data.access, res.data.refresh ?? refreshToken)
          original.headers.Authorization = `Bearer ${res.data.access}`
          return _client!(original)
        } catch {
          const { logout } = useAuthStore.getState()
          await logout()
          return Promise.reject(err)
        }
      }
      return Promise.reject(err)
    }
  )

  return _client
}

// Reset the singleton (needed when settings change)
export function resetApiClient() {
  _client = null
}
