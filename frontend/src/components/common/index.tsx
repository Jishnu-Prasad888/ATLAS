import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { clsx } from 'clsx'
import type { AgentStatus, CollectorStatus, LogSeverity } from '@/types'
import { useUiStore } from '@/store/uiStore'
import logoDark from '@/assets/logo-dark-theme.png'
import logoLight from '@/assets/logo-light-theme.png'
import {
  agentStatusVariant,
  collectorStatusVariant,
} from '@/utils'

// ─── Logo ──────────────────────────────────────────────────────────────────────

type BrandLogoProps = {
  className?: string
  height?: number
  alt?: string
}

export function BrandLogo({ className, height = 32, alt = 'ATLAS logo' }: BrandLogoProps) {
  const theme = useUiStore((s) => s.theme)
  const src = theme === 'light' ? logoLight : logoDark

  return (
    <img
      src={src}
      alt={alt}
      className={clsx('block select-none', className)}
      style={{ height, width: 'auto' }}
      loading="lazy"
    />
  )
}

// ─── Button ───────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  children: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', loading, children, className, disabled, ...props }, ref) => {
    const base = 'inline-flex items-center justify-center gap-2 font-mono font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 disabled:opacity-40 disabled:cursor-not-allowed'

    const variants: Record<ButtonVariant, string> = {
      primary: 'bg-blue-600 text-white hover:bg-blue-700 border border-blue-600',
      secondary: 'bg-transparent text-[--color-text] border border-[--color-border] hover:border-[--color-border-strong] hover:bg-[--color-surface-2]',
      danger: 'bg-transparent text-red-400 border border-red-900 hover:bg-red-950 hover:border-red-700',
      ghost: 'bg-transparent text-[--color-text-muted] hover:text-[--color-text] hover:bg-[--color-surface-2] border border-transparent',
    }

    const sizes: Record<ButtonSize, string> = {
      sm: 'h-7 px-3 text-xs rounded',
      md: 'h-8 px-4 text-xs rounded',
      lg: 'h-10 px-5 text-sm rounded',
    }

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={clsx(base, variants[variant], sizes[size], className)}
        {...props}
      >
        {loading && <Spinner size="sm" />}
        {children}
      </button>
    )
  },
)
Button.displayName = 'Button'

// ─── Input ────────────────────────────────────────────────────────────────────

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, className, id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={inputId} className="text-xs text-[--color-text-muted] font-mono uppercase tracking-wide">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={clsx(
            'h-8 w-full rounded border bg-[--color-surface-2] px-3 text-xs font-mono text-[--color-text] placeholder:text-[--color-text-dim]',
            'focus:outline-none focus:ring-1 focus:ring-blue-500',
            'transition-colors',
            error ? 'border-red-700' : 'border-[--color-border] hover:border-[--color-border-strong]',
            className,
          )}
          {...props}
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        {hint && !error && <p className="text-xs text-[--color-text-muted]">{hint}</p>}
      </div>
    )
  },
)
Input.displayName = 'Input'

// ─── Select ───────────────────────────────────────────────────────────────────

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, children, className, id, ...props }, ref) => {
    const selectId = id ?? label?.toLowerCase().replace(/\s+/g, '-')

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={selectId} className="text-xs text-[--color-text-muted] font-mono uppercase tracking-wide">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={clsx(
            'h-8 w-full rounded border bg-[--color-surface-2] px-2 text-xs font-mono text-[--color-text]',
            'focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors',
            error ? 'border-red-700' : 'border-[--color-border] hover:border-[--color-border-strong]',
            className,
          )}
          {...props}
        >
          {children}
        </select>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    )
  },
)
Select.displayName = 'Select'

// ─── Spinner ──────────────────────────────────────────────────────────────────

export function Spinner({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const sizes = { sm: 'h-3 w-3', md: 'h-4 w-4', lg: 'h-6 w-6' }
  return (
    <span
      className={clsx(
        'inline-block rounded-full border-2 border-[--color-border] border-t-blue-500 animate-spin',
        sizes[size],
        className,
      )}
    />
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export function Card({
  children,
  className,
  padding = true,
  style,
}: {
  children: ReactNode
  className?: string
  padding?: boolean
  style?: React.CSSProperties
}) {
  return (
    <div
      className={clsx(
        'rounded-lg border border-[--color-border] bg-[--color-surface]',
        padding && 'p-4',
        className,
      )}
      style={style}
    >
      {children}
    </div>
  )
}

// ─── Section header ───────────────────────────────────────────────────────────

export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-4">
      <div>
        <h2 className="text-sm font-mono font-medium text-[--color-text] uppercase tracking-wider">{title}</h2>
        {description && <p className="text-xs text-[--color-text-muted] mt-0.5">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

// ─── Status badge ─────────────────────────────────────────────────────────────

type StatusVariant = 'online' | 'warning' | 'error' | 'muted' | 'blue'

const variantStyles: Record<StatusVariant, { text: string; dot: string; bg: string }> = {
  online: { dot: 'bg-green-500', text: 'text-green-400', bg: 'bg-green-950/40 border-green-900' },
  warning: { dot: 'bg-yellow-500', text: 'text-yellow-400', bg: 'bg-yellow-950/40 border-yellow-900' },
  error: { dot: 'bg-red-500', text: 'text-red-400', bg: 'bg-red-950/40 border-red-900' },
  blue: { dot: 'bg-blue-500', text: 'text-blue-400', bg: 'bg-blue-950/40 border-blue-900' },
  muted: { dot: 'bg-[--color-gray]', text: 'text-[--color-text-muted]', bg: 'bg-[--color-surface-2] border-[--color-border]' },
}

export function StatusBadge({
  status,
  variant,
  pulse,
}: {
  status: string
  variant?: StatusVariant
  pulse?: boolean
}) {
  const v = variant ?? 'muted'
  const s = variantStyles[v]

  return (
    <span className={clsx('inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono border', s.bg, s.text)}>
      <span className={clsx('h-1.5 w-1.5 rounded-full shrink-0', s.dot, pulse && v === 'online' && 'animate-pulse')} />
      {status}
    </span>
  )
}

export function AgentStatusBadge({ status }: { status: AgentStatus }) {
  return <StatusBadge status={status} variant={agentStatusVariant(status)} pulse={status === 'ONLINE'} />
}

export function CollectorStatusBadge({ status }: { status: CollectorStatus }) {
  return <StatusBadge status={status} variant={collectorStatusVariant(status)} />
}

export function SeverityBadge({ severity }: { severity: LogSeverity }) {
  const colorMap: Record<LogSeverity, string> = {
    Trace: 'text-[--color-text-dim]',
    Debug: 'text-blue-500',
    Info: 'text-green-500',
    Warning: 'text-yellow-400',
    Error: 'text-red-400',
    Critical: 'text-purple-400 font-bold',
  }
  return (
    <span className={clsx('text-xs font-mono tabular-nums', colorMap[severity])}>
      {severity.toUpperCase().padEnd(8)}
    </span>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

export function EmptyState({ message, detail }: { message: string; detail?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <p className="text-sm text-[--color-text-muted] font-mono">{message}</p>
      {detail && <p className="text-xs text-[--color-text-dim] mt-1">{detail}</p>}
    </div>
  )
}

// ─── Error state ──────────────────────────────────────────────────────────────

export function ErrorState({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded border border-red-900 bg-red-950/30 text-sm">
      <span className="text-red-500 text-xs font-mono shrink-0">ERR</span>
      <span className="text-red-300 flex-1 text-xs font-mono">{error}</span>
      {onRetry && (
        <button onClick={onRetry} className="text-xs text-red-400 underline hover:no-underline">
          Retry
        </button>
      )}
    </div>
  )
}

// ─── Loading state ────────────────────────────────────────────────────────────

export function LoadingState({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-[--color-text-muted]">
      <Spinner />
      <span className="text-xs font-mono">{label}</span>
    </div>
  )
}

// ─── Tag ──────────────────────────────────────────────────────────────────────

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-mono bg-[--color-surface-2] border border-[--color-border] text-[--color-text-muted]">
      {children}
    </span>
  )
}

// ─── Divider ─────────────────────────────────────────────────────────────────

export function Divider({ className }: { className?: string }) {
  return <hr className={clsx('border-[--color-border]', className)} />
}

// ─── KV Row ───────────────────────────────────────────────────────────────────

export function KvRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 border-b border-[--color-border] last:border-0">
      <span className="text-xs text-[--color-text-muted] font-mono">{label}</span>
      <span className="text-xs text-[--color-text] font-mono text-right">{value}</span>
    </div>
  )
}

// ─── Toggle ───────────────────────────────────────────────────────────────────

export function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative inline-flex h-5 w-9 shrink-0 rounded-full border transition-colors duration-150',
        'focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        checked ? 'bg-blue-600 border-blue-600' : 'bg-[--color-surface-2] border-[--color-border]',
      )}
    >
      <span
        className={clsx(
          'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-150 mt-[2px]',
          checked ? 'translate-x-[18px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  )
}

// ─── Confirm dialog ───────────────────────────────────────────────────────────

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
  danger = false,
}: {
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
  danger?: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[--color-surface] border border-[--color-border] rounded-lg shadow-2xl p-6 max-w-sm w-full">
        <h3 className="text-sm font-mono font-medium text-[--color-text] mb-2">{title}</h3>
        <p className="text-xs text-[--color-text-muted] mb-6 leading-relaxed">{message}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            size="sm"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Metric gauge bar ─────────────────────────────────────────────────────────

export function GaugeBar({
  label,
  value,
  unit = '%',
  warn = 70,
  danger = 90,
  detail,
}: {
  label: string
  value: number
  unit?: string
  warn?: number
  danger?: number
  detail?: string
}) {
  const pct = Math.min(100, Math.max(0, value))
  const color = pct >= danger ? 'bg-red-500' : pct >= warn ? 'bg-yellow-400' : 'bg-green-500'

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[--color-text-muted] font-mono">{label}</span>
        <span className="text-xs font-mono text-[--color-text] tabular-nums">
          {pct.toFixed(1)}{unit}
        </span>
      </div>
      <div className="h-1 w-full rounded-full bg-[--color-surface-2] overflow-hidden">
        <div
          className={clsx('h-full rounded-full transition-all duration-500', color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      {detail && <p className="text-xs text-[--color-text-dim]">{detail}</p>}
    </div>
  )
}

// ─── Sparkline SVG ────────────────────────────────────────────────────────────

export function Sparkline({
  values,
  color = '#22c55e',
  width = 120,
  height = 32,
}: {
  values: number[]
  color?: string
  width?: number
  height?: number
}) {
  if (values.length < 2) return <span className="text-xs text-[--color-text-dim]">--</span>

  const max = Math.max(...values, 1)
  const step = width / (values.length - 1)

  const path = values
    .map((v, i) => {
      const x = (i * step).toFixed(1)
      const y = (height - (v / max) * (height - 4) - 2).toFixed(1)
      return `${i === 0 ? 'M' : 'L'}${x},${y}`
    })
    .join(' ')

  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ─── Copy button ─────────────────────────────────────────────────────────────

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = React.useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className={clsx('text-xs font-mono text-[--color-text-muted] hover:text-[--color-text] transition-colors', className)}
    >
      {copied ? 'copied' : 'copy'}
    </button>
  )
}

import React from 'react'
