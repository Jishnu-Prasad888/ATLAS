/**
 * All server-side connection parameters are read from environment variables.
 * Override via .env.local for development, or inject at build/runtime.
 *
 * VITE_API_BASE_URL  - Full base URL for the REST API (e.g. https://beacon.example.com)
 * VITE_WS_BASE_URL   - Full base URL for WebSocket connections (e.g. wss://beacon.example.com)
 * VITE_API_PREFIX    - API path prefix (default: /api/v1)
 * VITE_WS_PATH       - WebSocket subscribe path (default: /ws/subscribe/)
 */

import { runtimeValue } from './runtime'

function preferSecureProtocol(value: string, insecurePrefix: string, securePrefix: string): string {
  if (typeof window === 'undefined') return value
  if (window.location.protocol !== 'https:') return value
  return value.startsWith(insecurePrefix)
    ? `${securePrefix}${value.slice(insecurePrefix.length)}`
    : value
}

type EnvKey = string

export function readEnv(key: EnvKey, fallback: string): string {
  const runtime = runtimeValue(key)
  if (runtime !== undefined && runtime !== '') return runtime
  const value = (import.meta.env as Record<string, string | undefined>)[key]
  return value ?? fallback
}

export const env = {
  /** Base origin for all REST API calls, e.g. "https://beacon.example.com" */
  get apiBaseUrl(): string {
    const value = readEnv('VITE_API_BASE_URL', 'http://atlas-beacon-server.xyz')
    return preferSecureProtocol(value, 'http://', 'https://')
  },

  /** Base origin for WebSocket connections */
  get wsBaseUrl(): string {
    const value = readEnv('VITE_WS_BASE_URL', 'ws://atlas-beacon-server.xyz')
    return preferSecureProtocol(value, 'ws://', 'wss://')
  },

  /** REST API path prefix */
  get apiPrefix(): string {
    return readEnv('VITE_API_PREFIX', '/api/v1')
  },

  /** WebSocket path */
  get wsPath(): string {
    return readEnv('VITE_WS_PATH', '/ws/subscribe/')
  },

  /** Feature flag for ATLAS-AI UI */
  get atlasAiEnabled(): boolean {
    return readEnv('VITE_ATLAS_AI_ENABLED', 'false') === 'true'
  },

  /** Optional custom base URL for the ATLAS-AI gateway */
  get atlasAiBaseUrl(): string {
    return readEnv('VITE_ATLAS_AI_BASE_URL', '')
  },

  /** Google OAuth configuration */
  get googleClientId(): string {
    return readEnv('VITE_GOOGLE_CLIENT_ID', '')
  },

  /** Derived: full REST base */
  get restBase(): string {
    return `${this.apiBaseUrl}${this.apiPrefix}`
  },

  /** Derived: full WebSocket URL */
  get wsUrl(): string {
    const base = this.wsBaseUrl
    const path = this.wsPath

    if (base) {
      return `${base}${path}`
    }

    const apiBase = this.apiBaseUrl
    if (apiBase) {
      try {
        const api = new URL(apiBase)
        const protocol = api.protocol === 'https:' ? 'wss:' : 'ws:'
        return `${protocol}//${api.host}${path}`
      } catch {
        // fall through to window location
      }
    }

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    return `${protocol}://${window.location.host}${path}`
  },
} as const
