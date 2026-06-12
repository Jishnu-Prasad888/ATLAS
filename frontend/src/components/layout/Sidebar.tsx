import { NavLink, useLocation } from 'react-router-dom'
import { clsx } from 'clsx'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import { useFleetHealth } from '@/hooks'

interface NavItem {
  path: string
  label: string
  adminOnly?: boolean
  shortLabel: string
}

const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Dashboard', shortLabel: 'Dash' },
  { path: '/agents', label: 'Agents', shortLabel: 'Agents' },
  { path: '/metrics', label: 'Metrics', shortLabel: 'Metrics' },
  { path: '/logs', label: 'Logs', shortLabel: 'Logs' },
  { path: '/health', label: 'Health', shortLabel: 'Health' },
  { path: '/audit', label: 'Audit', shortLabel: 'Audit', adminOnly: true },
  { path: '/users', label: 'Users', shortLabel: 'Users', adminOnly: true },
  { path: '/config', label: 'Config', shortLabel: 'Conf', adminOnly: true },
  { path: '/settings', label: 'Settings', shortLabel: 'Setup' },
]

export function Sidebar() {
  const { isAdmin, user } = useAuthStore()
  const { sidebarCollapsed, toggleSidebar, wsConnected } = useUiStore()
  const { data: health } = useFleetHealth()
  const location = useLocation()

  const visibleItems = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin)

  return (
    <aside
      className={clsx(
        'fixed left-0 top-0 z-40 flex h-screen flex-col bg-[--color-surface] border-r border-[--color-border] transition-[width] duration-150',
        sidebarCollapsed ? 'w-12' : 'w-44',
      )}
    >
      {/* Logo / Header */}
      <div className="flex h-12 items-center justify-between border-b border-[--color-border] px-3">
        {!sidebarCollapsed && (
          <span className="text-xs font-mono font-semibold text-[--color-text] uppercase tracking-widest select-none">
            Beacon
          </span>
        )}
        <button
          onClick={toggleSidebar}
          className="ml-auto text-[--color-text-muted] hover:text-[--color-text] transition-colors p-0.5"
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={clsx('transition-transform', sidebarCollapsed && 'rotate-180')}>
            <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Fleet summary */}
      {!sidebarCollapsed && health && (
        <div className="px-3 py-2 border-b border-[--color-border]">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[--color-text-dim] font-mono">online</span>
            <span className="text-xs font-mono text-green-400 tabular-nums">
              {health.agents.online}/{health.agents.total}
            </span>
          </div>
          {health.agents.degraded > 0 && (
            <div className="flex items-center justify-between mt-0.5">
              <span className="text-xs text-[--color-text-dim] font-mono">degraded</span>
              <span className="text-xs font-mono text-yellow-400 tabular-nums">{health.agents.degraded}</span>
            </div>
          )}
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2">
        {visibleItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 h-8 text-xs font-mono transition-colors',
                'hover:bg-[--color-surface-2] hover:text-[--color-text]',
                isActive
                  ? 'text-[--color-text] bg-[--color-surface-2] border-r border-blue-500'
                  : 'text-[--color-text-muted]',
                sidebarCollapsed && 'justify-center',
              )
            }
          >
            <NavDot path={item.path} currentPath={location.pathname} />
            {!sidebarCollapsed && item.label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-[--color-border] px-3 py-2 space-y-1">
        {!sidebarCollapsed && (
          <>
            <div className="flex items-center gap-2">
              <span className={clsx('h-1.5 w-1.5 rounded-full', wsConnected ? 'bg-green-500 animate-pulse' : 'bg-[--color-text-dim]')} />
              <span className="text-xs text-[--color-text-dim] font-mono">{wsConnected ? 'live' : 'offline'}</span>
            </div>
            {user && (
              <p className="text-xs text-[--color-text-dim] font-mono truncate" title={user.username}>
                {user.username}
              </p>
            )}
          </>
        )}
        {sidebarCollapsed && (
          <span className={clsx('block h-1.5 w-1.5 rounded-full mx-auto', wsConnected ? 'bg-green-500' : 'bg-[--color-text-dim]')} />
        )}
      </div>
    </aside>
  )
}

function NavDot({ path, currentPath }: { path: string; currentPath: string }) {
  const active = path === '/' ? currentPath === '/' : currentPath.startsWith(path)
  return (
    <span
      className={clsx(
        'h-1 w-1 rounded-full shrink-0',
        active ? 'bg-blue-400' : 'bg-[--color-text-dim]',
      )}
    />
  )
}
