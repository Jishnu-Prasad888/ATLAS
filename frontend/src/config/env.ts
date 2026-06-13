/**
 * All server-side connection parameters are read from environment variables.
 * Override via .env.local for development, or inject at build/runtime.
 *
 * VITE_API_BASE_URL  - Full base URL for the REST API (e.g. https://beacon.example.com)
 * VITE_WS_BASE_URL   - Full base URL for WebSocket connections (e.g. wss://beacon.example.com)
 * VITE_API_PREFIX    - API path prefix (default: /api/v1)
 * VITE_WS_PATH       - WebSocket subscribe path (default: /ws/subscribe/)
 */

function get(key: string, fallback: string): string {
  const value = (import.meta.env as Record<string, string>)[key]
  return value ?? fallback
}

export const env = {
  /** Base origin for all REST API calls, e.g. "https://beacon.example.com" */
  apiBaseUrl: get('VITE_API_BASE_URL', ''),

  /** Base origin for WebSocket connections */
  wsBaseUrl: get('VITE_WS_BASE_URL', ''),

  /** REST API path prefix */
  apiPrefix: get('VITE_API_PREFIX', '/api/v1'),

  /** WebSocket path */
  wsPath: get('VITE_WS_PATH', '/ws/subscribe/'),

  /** Derived: full REST base */
  get restBase(): string {
    return `${this.apiBaseUrl}${this.apiPrefix}`
  },

  /** Derived: full WebSocket URL */
  get wsUrl(): string {
    if (this.wsBaseUrl) {
      return `${this.wsBaseUrl}${this.wsPath}`
    }
    // Auto-derive ws/wss from current page protocol
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    return `${protocol}://${window.location.host}${this.wsPath}`
  },
} as const
