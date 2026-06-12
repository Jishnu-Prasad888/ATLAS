import type { AgentStatus, CollectorStatus, LogSeverity } from '@/types'

// ─── Bytes formatting ─────────────────────────────────────────────────────────

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`
}

export function formatBandwidth(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`
}

// ─── Time formatting ──────────────────────────────────────────────────────────

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function timeAgo(isoString: string | null): string {
  if (!isoString) return 'Never'
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000)
  if (diff < 0) return 'just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export function formatTimestamp(isoString: string): string {
  return new Date(isoString).toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  })
}

export function formatPct(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`
}

// ─── Agent ID formatting ──────────────────────────────────────────────────────

export function shortAgentId(agentId: string): string {
  const hex = agentId.replace('sha256:', '')
  return `${hex.slice(0, 12)}...`
}

// ─── Status colors ────────────────────────────────────────────────────────────

export const AGENT_STATUS_COLOR: Record<AgentStatus, string> = {
  BOOTING: '#3b82f6',
  INITIALIZING: '#3b82f6',
  ONLINE: '#22c55e',
  DEGRADED: '#eab308',
  OFFLINE_BUFFERING: '#f97316',
  RECOVERING: '#eab308',
  FAILED: '#ef4444',
  SHUTTING_DOWN: '#6b7280',
  OFFLINE: '#6b7280',
}

export const COLLECTOR_STATUS_COLOR: Record<CollectorStatus, string> = {
  Healthy: '#22c55e',
  Degraded: '#eab308',
  Failed: '#ef4444',
  Disabled: '#6b7280',
}

export const LOG_SEVERITY_COLOR: Record<LogSeverity, string> = {
  Trace: '#6b7280',
  Debug: '#3b82f6',
  Info: '#22c55e',
  Warning: '#eab308',
  Error: '#ef4444',
  Critical: '#a855f7',
}

export type StatusVariant = 'online' | 'warning' | 'error' | 'muted' | 'blue'

export function agentStatusVariant(status: AgentStatus): StatusVariant {
  switch (status) {
    case 'ONLINE':
      return 'online'
    case 'DEGRADED':
    case 'RECOVERING':
    case 'OFFLINE_BUFFERING':
      return 'warning'
    case 'FAILED':
      return 'error'
    case 'BOOTING':
    case 'INITIALIZING':
      return 'blue'
    default:
      return 'muted'
  }
}

export function collectorStatusVariant(status: CollectorStatus): StatusVariant {
  switch (status) {
    case 'Healthy':
      return 'online'
    case 'Degraded':
      return 'warning'
    case 'Failed':
      return 'error'
    default:
      return 'muted'
  }
}

// ─── Gauge colors ─────────────────────────────────────────────────────────────

export function gaugeColor(pct: number, warn = 70, danger = 90): string {
  if (pct >= danger) return '#ef4444'
  if (pct >= warn) return '#eab308'
  return '#22c55e'
}

export function tempColor(celsius: number): string {
  if (celsius >= 80) return '#ef4444'
  if (celsius >= 60) return '#eab308'
  return '#22c55e'
}

// ─── Log source labels ────────────────────────────────────────────────────────

export const LOG_SOURCE_LABEL: Record<string, string> = {
  'systemd-journald': 'Systemd',
  syslog: 'Syslog',
  kernel: 'Kernel',
  docker: 'Docker',
  kubernetes: 'Kubernetes',
  internal: 'Beacon',
}

// ─── Form validation ──────────────────────────────────────────────────────────

export function validatePassword(value: string): string | null {
  if (value.length < 12) return 'Password must be at least 12 characters.'
  return null
}

export function validateUsername(value: string): string | null {
  if (!value.trim()) return 'Username is required.'
  if (value.length > 150) return 'Username must be 150 characters or fewer.'
  return null
}

export function validateEmail(value: string): string | null {
  if (!value) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Enter a valid email address.'
  return null
}

export function validateRecoveryKey(value: string): string | null {
  const clean = value.replace(/-/g, '').toUpperCase()
  if (!/^[0-9A-F]{16}$/.test(clean)) {
    return 'Format must be XXXX-XXXX-XXXX-XXXX (hex characters).'
  }
  return null
}

export function validateHostname(value: string): string | null {
  if (!value.trim()) return 'Hostname is required.'
  if (value.length > 253) return 'Hostname must be 253 characters or fewer.'
  return null
}

export function validateIntervalSeconds(value: number): string | null {
  if (!Number.isInteger(value) || value < 1) return 'Interval must be a positive integer.'
  return null
}

export function validateRetentionDays(value: number): string | null {
  if (!Number.isInteger(value) || value < 1) return 'Retention must be a positive integer.'
  return null
}

// ─── Server error mapping ─────────────────────────────────────────────────────

export function mapServerErrors(
  body: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [field, messages] of Object.entries(body)) {
    if (field === 'detail' || field === 'non_field_errors') {
      out._global = Array.isArray(messages) ? messages[0] ?? '' : (messages ?? '')
    } else {
      out[field] = Array.isArray(messages) ? messages[0] ?? '' : (messages ?? '')
    }
  }
  return out
}

// ─── Download helper ──────────────────────────────────────────────────────────

export async function downloadFile(url: string, filename: string, token: string): Promise<void> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Export failed: HTTP ${res.status}`)
  const blob = await res.blob()
  const href = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href, download: filename })
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(href)
}

// ─── Chart helpers ────────────────────────────────────────────────────────────

export function sparklinePath(values: number[], width = 120, height = 32): string {
  if (values.length < 2) return ''
  const max = Math.max(...values, 1)
  const step = width / (values.length - 1)
  return values
    .map((v, i) => {
      const x = (i * step).toFixed(1)
      const y = (height - (v / max) * height).toFixed(1)
      return `${i === 0 ? 'M' : 'L'}${x},${y}`
    })
    .join(' ')
}

// ─── Clamp ────────────────────────────────────────────────────────────────────

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
