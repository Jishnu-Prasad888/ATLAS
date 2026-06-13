import { type ReactNode } from 'react'
import { clsx } from 'clsx'
import { Sidebar } from './Sidebar'
import { useUiStore } from '@/store/uiStore'
import type { Notification } from '@/store/uiStore'

export function AppLayout({ children }: { children: ReactNode }) {
  const { sidebarCollapsed } = useUiStore()

  return (
    <div className="min-h-screen bg-[--color-bg]">
      <Sidebar />
      <main
        className={clsx(
          'min-h-screen transition-[padding-left] duration-150',
          sidebarCollapsed ? 'pl-12' : 'pl-44',
        )}
      >
        <div className="p-4 md:p-6 max-w-screen-2xl mx-auto">{children}</div>
      </main>
      <NotificationStack />
    </div>
  )
}

function NotificationStack() {
  const { notifications, removeNotification } = useUiStore()

  if (notifications.length === 0) return null

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full"
      aria-live="polite"
      aria-atomic="false"
    >
      {notifications.map((n) => (
        <NotificationToast key={n.id} notification={n} onDismiss={() => removeNotification(n.id)} />
      ))}
    </div>
  )
}

function NotificationToast({
  notification,
  onDismiss,
}: {
  notification: Notification
  onDismiss: () => void
}) {
  const typeStyles = {
    success: 'border-green-900 bg-green-950/60',
    error: 'border-red-900 bg-red-950/60',
    warning: 'border-yellow-900 bg-yellow-950/60',
    info: 'border-[--color-border] bg-[--color-surface]',
  }

  const labelStyles = {
    success: 'text-green-400',
    error: 'text-red-400',
    warning: 'text-yellow-400',
    info: 'text-blue-400',
  }

  const prefix = {
    success: 'OK',
    error: 'ERR',
    warning: 'WARN',
    info: 'INFO',
  }

  return (
    <div
      className={clsx(
        'flex items-start gap-3 rounded border backdrop-blur-sm px-3 py-2.5 shadow-lg',
        typeStyles[notification.type],
      )}
    >
      <span className={clsx('text-xs font-mono font-bold shrink-0 mt-0.5', labelStyles[notification.type])}>
        {prefix[notification.type]}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-mono text-[--color-text]">{notification.title}</p>
        {notification.message && (
          <p className="text-xs font-mono text-[--color-text-muted] mt-0.5 break-words">{notification.message}</p>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="shrink-0 text-[--color-text-dim] hover:text-[--color-text-muted] transition-colors text-xs"
        aria-label="Dismiss"
      >
        x
      </button>
    </div>
  )
}

// ─── Page wrapper ─────────────────────────────────────────────────────────────

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-base font-mono font-semibold text-[--color-text] uppercase tracking-wider">{title}</h1>
        {subtitle && <p className="text-xs text-[--color-text-muted] mt-0.5 font-mono">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}
