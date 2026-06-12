import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosError,
  type InternalAxiosRequestConfig,
} from 'axios'
import { env } from '@/config/env'
import type { ApiErrorBody } from '@/types'

// ─── Custom error class ───────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: ApiErrorBody | null = null,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// ─── Token store (in-memory only — never localStorage) ───────────────────────

let _accessToken: string | null = null
let _refreshToken: string | null = null
let _refreshPromise: Promise<boolean> | null = null

export function setTokens(access: string, refresh: string): void {
  _accessToken = access
  _refreshToken = refresh
}

export function clearTokens(): void {
  _accessToken = null
  _refreshToken = null
}

export function getAccessToken(): string | null {
  return _accessToken
}

export function getRefreshToken(): string | null {
  return _refreshToken
}

export function parseJwt<T = unknown>(token: string): T {
  const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
  const json = decodeURIComponent(
    atob(base64)
      .split('')
      .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
      .join(''),
  )
  return JSON.parse(json) as T
}

// ─── Axios instance ────────────────────────────────────────────────────────────

export const apiClient: AxiosInstance = axios.create({
  baseURL: env.restBase,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  timeout: 30_000,
})

// Attach access token to every request
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (_accessToken) {
    config.headers.Authorization = `Bearer ${_accessToken}`
  }
  return config
})

// Handle 401 with silent refresh
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorBody>) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean }

    if (error.response?.status === 401 && !original._retry && _refreshToken) {
      original._retry = true

      // Deduplicate concurrent refresh calls
      if (!_refreshPromise) {
        _refreshPromise = (async () => {
          try {
            const res = await axios.post<{ access: string; refresh: string }>(
              `${env.restBase}/auth/refresh/`,
              { refresh: _refreshToken },
              { headers: { 'Content-Type': 'application/json' } },
            )
            setTokens(res.data.access, res.data.refresh)
            return true
          } catch {
            clearTokens()
            return false
          } finally {
            _refreshPromise = null
          }
        })()
      }

      const refreshed = await _refreshPromise

      if (refreshed) {
        original.headers.Authorization = `Bearer ${_accessToken}`
        return apiClient(original)
      }

      // Refresh failed — dispatch a global event so the app can redirect
      window.dispatchEvent(new CustomEvent('beacon:session-expired'))
      return Promise.reject(new ApiError(401, 'Session expired'))
    }

    // Normalise error shape
    const status = error.response?.status ?? 0
    const body = error.response?.data ?? null
    const message =
      (body as ApiErrorBody)?.detail ??
      error.message ??
      `HTTP ${status}`

    return Promise.reject(new ApiError(status, message, body as ApiErrorBody | null))
  },
)

// ─── Generic request helper ───────────────────────────────────────────────────

export async function request<T>(config: AxiosRequestConfig): Promise<T> {
  const response = await apiClient.request<T>(config)
  return response.data
}
