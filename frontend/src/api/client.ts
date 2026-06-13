import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosError,
  type InternalAxiosRequestConfig,
} from 'axios'
import { env } from '@/config/env'
import type { ApiErrorBody } from '@/types'

const log = console.log
const LOG_PREFIX = '[API]'

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

// ─── Token store (in-memory + localStorage for persistence) ─────────────────

const STORAGE_KEY = 'beacon_auth'

let _accessToken: string | null = null
let _refreshToken: string | null = null
let _refreshPromise: Promise<boolean> | null = null

export function setTokens(access: string, refresh: string): void {
  _accessToken = access
  _refreshToken = refresh
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ access, refresh }))
  } catch { /* quota */ }
}

export function clearTokens(): void {
  _accessToken = null
  _refreshToken = null
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch { /* quota */ }
}

export function getAccessToken(): string | null {
  if (_accessToken) return _accessToken
  const stored = loadStoredTokens()
  return stored?.access ?? null
}

export function getRefreshToken(): string | null {
  if (_refreshToken) return _refreshToken
  const stored = loadStoredTokens()
  return stored?.refresh ?? null
}

function loadStoredTokens(): { access: string; refresh: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as { access: string; refresh: string }) : null
  } catch {
    return null
  }
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
  const { method, url, params, data } = config
  log(`${LOG_PREFIX} REQUEST  ${method?.toUpperCase()} ${url}`, params ? { params } : '', data ? { body: data } : '')
  if (_accessToken) {
    config.headers.Authorization = `Bearer ${_accessToken}`
  }
  return config
})

// Handle 401 with silent refresh
apiClient.interceptors.response.use(
  (response) => {
    const { method, url } = response.config
    log(`${LOG_PREFIX} RESPONSE ${method?.toUpperCase()} ${url} → ${response.status}`, response.data)
    return response
  },
  async (error: AxiosError<ApiErrorBody>) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean }

    if (error.response?.status === 401 && !original._retry && _refreshToken) {
      original._retry = true

      // Deduplicate concurrent refresh calls
      if (!_refreshPromise) {
        _refreshPromise = (async () => {
          try {
            log(`${LOG_PREFIX} REFRESH  Attempting silent token refresh...`)
            const res = await axios.post<{ access: string; refresh: string }>(
              `${env.restBase}/auth/refresh/`,
              { refresh: _refreshToken },
              { headers: { 'Content-Type': 'application/json' } },
            )
            setTokens(res.data.access, res.data.refresh)
            log(`${LOG_PREFIX} REFRESH  Token refreshed successfully`)
            return true
          } catch {
            log(`${LOG_PREFIX} REFRESH  Token refresh failed`)
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

    const reqUrl = error.config?.url ?? '?'
    const reqMethod = error.config?.method?.toUpperCase() ?? '?'
    log(`${LOG_PREFIX} ERROR    ${reqMethod} ${reqUrl} → ${status}`, { message, body })

    return Promise.reject(new ApiError(status, message, body as ApiErrorBody | null))
  },
)

// ─── Generic request helper ───────────────────────────────────────────────────

export async function request<T>(config: AxiosRequestConfig): Promise<T> {
  log(`${LOG_PREFIX} CALL     ${config.method?.toUpperCase()} ${config.url}`, config.params ? { params: config.params } : '', config.data ? { data: config.data } : '')
  const response = await apiClient.request<T>(config)
  return response.data
}
