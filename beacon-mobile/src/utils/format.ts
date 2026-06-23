import { formatDistanceToNow, format, parseISO } from 'date-fns'

export function formatBytes(b: number | null | undefined): string {
  if (b == null || isNaN(b)) return '–'
  if (b === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(Math.abs(b)) / Math.log(1024))
  return (b / Math.pow(1024, i)).toFixed(1) + ' ' + units[Math.min(i, units.length - 1)]
}

export function formatPct(v: number | null | undefined, decimals = 1): string {
  if (v == null || isNaN(v)) return '–'
  return v.toFixed(decimals) + '%'
}

export function formatBandwidth(bytesPerSec: number | null | undefined): string {
  if (bytesPerSec == null || Number.isNaN(bytesPerSec)) return '–'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s']
  let value = Math.max(bytesPerSec, 0)
  let idx = 0
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024
    idx += 1
  }
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`
}

export function timeAgo(ts: string | null | undefined): string {
  if (!ts) return '–'
  try {
    return formatDistanceToNow(parseISO(ts), { addSuffix: true })
  } catch {
    return '–'
  }
}

export function formatTs(ts: string | null | undefined, fmt = 'MMM d, HH:mm:ss'): string {
  if (!ts) return '–'
  try {
    return format(parseISO(ts), fmt)
  } catch {
    return '–'
  }
}

export function formatUptime(secs: number): string {
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function severityColor(sev: string): string {
  const s = sev?.toLowerCase?.() ?? ''
  switch (s) {
    case 'critical':
    case 'error': return '#ef4444'
    case 'warning':
    case 'warn': return '#eab308'
    case 'info': return '#3b82f6'
    case 'debug': return '#6b7280'
    case 'trace':
    case 'verbose': return '#a855f7'
    default: return '#6b7280'
  }
}

export function statusColor(status: string): string {
  switch (status) {
    case 'ONLINE': return '#22c55e'
    case 'DEGRADED': return '#eab308'
    case 'BOOTING':
    case 'INITIALIZING':
    case 'RECOVERING': return '#3b82f6'
    case 'OFFLINE_BUFFERING': return '#f97316'
    case 'FAILED':
    case 'SHUTTING_DOWN':
    case 'OFFLINE': return '#ef4444'
    case 'running': return '#22c55e'
    case 'success': return '#22c55e'
    case 'failed': return '#ef4444'
    case 'pending': return '#eab308'
    case 'cancelled': return '#6b7280'
    default: return '#6b7280'
  }
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}
