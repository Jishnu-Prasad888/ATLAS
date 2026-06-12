import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import { useFleetHealth } from '@/hooks'
import { authApi } from '@/api'
import { wsClient } from '@/ws/client'

// ─── Types ────────────────────────────────────────────────────────────────────

interface NavItem {
  path: string
  label: string
  icon: React.ReactNode
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const Icon = {
  Dashboard: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.25"/>
      <rect x="9" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.25"/>
      <rect x="1" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.25"/>
      <rect x="9" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.25"/>
    </svg>
  ),
  Agents: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <circle cx="5" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.25"/>
      <circle cx="11" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.25"/>
      <path d="M1 13.5C1 11.567 2.791 10 5 10s4 1.567 4 3.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
      <path d="M8 13.5c0-1.933 1.791-3.5 4-3.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
    </svg>
  ),
  Metrics: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <polyline points="1,12 4,7 7,9.5 10,4 13,6 15,3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  Logs: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path d="M2 4h12M2 8h8M2 12h10" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
    </svg>
  ),
  Health: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path d="M8 14C4.134 14 1 10.866 1 7s3.134-7 7-7 7 3.134 7 7-3.134 7-7 7z" stroke="currentColor" strokeWidth="1.25"/>
      <path d="M1 8h2.5L5 5l2.5 6L9 7l1.5 2H15" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  Audit: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path d="M3 2h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.25"/>
      <path d="M5 6h6M5 9h4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
      <circle cx="11.5" cy="11.5" r="2" fill="currentColor" opacity="0"/>
      <path d="M7 12l1.5-1.5M8.5 10.5L10 9" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
    </svg>
  ),
  Users: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.25"/>
      <path d="M2 14c0-3.314 2.686-5 6-5s6 1.686 6 5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
    </svg>
  ),
  Config: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.25"/>
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M3.1 12.9l1.4-1.4M11.5 4.5l1.4-1.4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
    </svg>
  ),
  Settings: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.25"/>
      <path d="M13.3 6.3l-.9-.5a5.4 5.4 0 0 0 0-1.6l.9-.5a.5.5 0 0 0 .2-.7l-1-1.7a.5.5 0 0 0-.7-.2l-.9.5a5.4 5.4 0 0 0-1.4-.8V.5A.5.5 0 0 0 9 0H7a.5.5 0 0 0-.5.5v1.3a5.4 5.4 0 0 0-1.4.8l-.9-.5a.5.5 0 0 0-.7.2l-1 1.7a.5.5 0 0 0 .2.7l.9.5a5.4 5.4 0 0 0 0 1.6l-.9.5a.5.5 0 0 0-.2.7l1 1.7a.5.5 0 0 0 .7.2l.9-.5c.4.3.9.6 1.4.8v1.3c0 .3.2.5.5.5h2c.3 0 .5-.2.5-.5v-1.3a5.4 5.4 0 0 0 1.4-.8l.9.5a.5.5 0 0 0 .7-.2l1-1.7a.5.5 0 0 0-.2-.7z" stroke="currentColor" strokeWidth="1.25" fill="none"/>
    </svg>
  ),
  SignOut: () => (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M11 11l3-3-3-3M14 8H6"
        stroke="currentColor" strokeWidth="1.4"
        strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  ),
  ChevronLeft: ({ rotated }: { rotated?: boolean }) => (
    <svg
      width="14" height="14" viewBox="0 0 16 16" fill="none"
      className={clsx('transition-transform duration-200', rotated && 'rotate-180')}
    >
      <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.4"
        strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  ),
}

// ─── Nav structure ────────────────────────────────────────────────────────────

const CORE_NAV: NavItem[] = [
  { path: '/',        label: 'Dashboard', icon: <Icon.Dashboard /> },
  { path: '/agents',  label: 'Agents',    icon: <Icon.Agents />   },
  { path: '/metrics', label: 'Metrics',   icon: <Icon.Metrics />  },
  { path: '/logs',    label: 'Logs',      icon: <Icon.Logs />     },
  { path: '/health',  label: 'Health',    icon: <Icon.Health />   },
]

const ADMIN_NAV: NavItem[] = [
  { path: '/audit',  label: 'Audit',  icon: <Icon.Audit />  },
  { path: '/users',  label: 'Users',  icon: <Icon.Users />  },
  { path: '/config', label: 'Config', icon: <Icon.Config /> },
]

const UTIL_NAV: NavItem[] = [
  { path: '/settings', label: 'Settings', icon: <Icon.Settings /> },
]

function pathIsActive(itemPath: string, currentPath: string) {
  return itemPath === '/' ? currentPath === '/' : currentPath.startsWith(itemPath)
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export function Sidebar() {
  const { isAdmin, user, refreshToken, logout } = useAuthStore()
  const { sidebarCollapsed, toggleSidebar, wsConnected } = useUiStore()
  const { data: health } = useFleetHealth()
  const location = useLocation()
  const navigate = useNavigate()

  const handleLogout = async () => {
    try {
      if (refreshToken) await authApi.logout(refreshToken)
    } catch { /* best-effort */ }
    wsClient.destroy()
    logout()
    navigate('/login', { replace: true })
  }

  const totalAgents  = health?.agents.total   ?? 0
  const onlineAgents = health?.agents.online  ?? 0
  const degraded     = health?.agents.degraded ?? 0
  const onlinePct    = totalAgents > 0 ? Math.round((onlineAgents / totalAgents) * 100) : 0
  const fleetOk      = health && onlineAgents === totalAgents && degraded === 0
  const fleetWarn    = health && degraded > 0
  const fleetDead    = health && onlineAgents === 0

  const statusColor = fleetDead
    ? 'text-red-400'
    : fleetWarn
    ? 'text-amber-400'
    : fleetOk
    ? 'text-emerald-400'
    : 'text-slate-500'

  const barColor = fleetDead
    ? 'bg-red-500'
    : fleetWarn
    ? 'bg-amber-400'
    : 'bg-emerald-400'

  return (
    <>
      {/* Inject JetBrains Mono */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600&display=swap');

        .atlas-sidebar * { font-family: 'JetBrains Mono', monospace; }

        .atlas-sidebar .nav-item-active::before {
          content: '';
          position: absolute;
          left: 0; top: 50%;
          transform: translateY(-50%);
          width: 2px; height: 60%;
          border-radius: 0 2px 2px 0;
          background: #F0A500;
        }

        @keyframes atlas-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .atlas-pulse { animation: atlas-pulse 2s ease-in-out infinite; }

        @keyframes atlas-scan {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
        .atlas-scan::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, transparent 0%, color-mix(in srgb, #F0A500 50%, transparent) 50%, transparent 100%);
          animation: atlas-scan 3s ease-in-out infinite;
        }

        .atlas-sidebar .group:hover .group-hover-show { opacity: 1; }
        .atlas-sidebar .group-hover-show { opacity: 0; transition: opacity 0.15s; }
      `}</style>

      <aside
        className={clsx(
          'atlas-sidebar fixed left-0 top-0 z-40 flex h-screen flex-col overflow-hidden',
          'transition-[width] duration-200 ease-in-out',
          sidebarCollapsed ? 'w-[52px]' : 'w-[192px]',
        )}
        style={{
          background: 'var(--color-surface)',
          borderRight: '1px solid var(--color-border)',
        }}
      >

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div
          className="flex h-12 shrink-0 items-center justify-between overflow-hidden"
          style={{ borderBottom: '1px solid var(--color-border)', padding: '0 14px' }}
        >
          {!sidebarCollapsed && (
            <div className="flex flex-col gap-px overflow-hidden">
              <span
                className="text-[13px] font-semibold tracking-[0.12em] uppercase select-none"
                style={{ color: '#F0A500', letterSpacing: '0.14em' }}
              >
                ATLAS
              </span>
              <span
                className="text-[9px] font-light tracking-[0.3em] uppercase select-none truncate"
                style={{ color: 'var(--color-text-dim)' }}
              >
                central server
              </span>
            </div>
          )}

          {sidebarCollapsed && (
            <span
              className="mx-auto text-[11px] font-semibold tracking-[0.15em] select-none"
              style={{ color: '#F0A500' }}
            >
              A
            </span>
          )}

          {!sidebarCollapsed && (
            <button
              onClick={toggleSidebar}
              className="shrink-0 rounded transition-colors p-1"
              style={{ color: 'var(--color-text-dim)' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-dim)')}
              aria-label="Collapse sidebar"
            >
              <Icon.ChevronLeft />
            </button>
          )}
          {sidebarCollapsed && (
            <button
              onClick={toggleSidebar}
              className="absolute bottom-0 left-0 right-0 flex justify-center py-1 opacity-0 hover:opacity-100 transition-opacity"
              style={{ color: 'var(--color-text-dim)' }}
              aria-label="Expand sidebar"
            >
              <Icon.ChevronLeft rotated />
            </button>
          )}
        </div>

        {/* ── Fleet health ─────────────────────────────────────────────── */}
        {health && (
          <div
            className="shrink-0 overflow-hidden"
            style={{
              borderBottom: '1px solid var(--color-border)',
              padding: sidebarCollapsed ? '10px 14px' : '10px 14px 12px',
            }}
          >
            {sidebarCollapsed ? (
              /* Collapsed: just a colored dot */
              <div className="flex justify-center">
                <span
                  className={clsx(
                    'w-2 h-2 rounded-full',
                    fleetOk ? 'bg-emerald-400 atlas-pulse' : fleetWarn ? 'bg-amber-400' : 'bg-red-400',
                  )}
                />
              </div>
            ) : (
              <>
                <div className="flex items-baseline justify-between mb-[7px]">
                  <span
                    className="text-[9px] font-medium tracking-[0.25em] uppercase"
                    style={{ color: 'var(--color-text-dim)' }}
                  >
                    Fleet
                  </span>
                  <span className={clsx('text-[11px] font-medium tabular-nums', statusColor)}>
                    {onlineAgents}
                    <span style={{ color: 'var(--color-text-dim)' }}>/</span>
                    {totalAgents}
                  </span>
                </div>

                {/* Bar */}
                <div
                  className="relative h-[3px] rounded-full overflow-hidden atlas-scan"
                  style={{ background: 'var(--color-border)' }}
                >
                  <div
                    className={clsx('absolute left-0 top-0 h-full rounded-full transition-[width] duration-700', barColor)}
                    style={{ width: `${onlinePct}%` }}
                  />
                </div>

                {degraded > 0 && (
                  <div className="flex items-center justify-between mt-[6px]">
                    <span className="text-[9px]" style={{ color: 'var(--color-text-dim)' }}>
                      degraded
                    </span>
                    <span className="text-[10px] font-medium text-amber-400 tabular-nums">
                      {degraded}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Navigation ───────────────────────────────────────────────── */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden" style={{ padding: '6px 0' }}>

          {/* Core */}
          <NavSection>
            {CORE_NAV.map(item => (
              <NavRow
                key={item.path}
                item={item}
                collapsed={sidebarCollapsed}
                currentPath={location.pathname}
              />
            ))}
          </NavSection>

          {/* Admin */}
          {isAdmin && (
            <>
              <SectionDivider label="Admin" collapsed={sidebarCollapsed} />
              <NavSection>
                {ADMIN_NAV.map(item => (
                  <NavRow
                    key={item.path}
                    item={item}
                    collapsed={sidebarCollapsed}
                    currentPath={location.pathname}
                  />
                ))}
              </NavSection>
            </>
          )}

          {/* Utility */}
          <SectionDivider collapsed={sidebarCollapsed} />
          <NavSection>
            {UTIL_NAV.map(item => (
              <NavRow
                key={item.path}
                item={item}
                collapsed={sidebarCollapsed}
                currentPath={location.pathname}
              />
            ))}
          </NavSection>

        </nav>

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <div
          className="shrink-0"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          {sidebarCollapsed ? (
            <div className="flex flex-col items-center gap-3 py-3">
              {/* WS dot */}
              <span
                className={clsx(
                  'w-1.5 h-1.5 rounded-full',
                  wsConnected ? 'bg-emerald-500 atlas-pulse' : 'bg-slate-600',
                )}
              />
              {/* Sign out */}
              <button
                onClick={handleLogout}
                className="transition-colors"
                style={{ color: 'var(--color-text-dim)' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-dim)')}
                aria-label="Sign out"
              >
                <Icon.SignOut />
              </button>
            </div>
          ) : (
            <div className="px-3.5 py-3 space-y-2">
              {/* Connection row */}
              <div className="flex items-center gap-2">
                <span
                  className={clsx(
                    'w-1.5 h-1.5 rounded-full shrink-0',
                    wsConnected ? 'bg-emerald-500 atlas-pulse' : 'bg-slate-600',
                  )}
                />
                <span
                  className="text-[10px] font-light"
                  style={{ color: 'var(--color-text-dim)' }}
                >
                  {wsConnected ? 'connected' : 'disconnected'}
                </span>
              </div>

              {/* User + sign out */}
              <div className="flex items-center justify-between">
                {user && (
                  <span
                    className="text-[11px] font-light truncate max-w-[100px]"
                    style={{ color: 'var(--color-text-muted)' }}
                    title={user.username}
                  >
                    {user.username}
                  </span>
                )}
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-1.5 text-[10px] font-light transition-colors"
                  style={{ color: 'var(--color-text-dim)' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-dim)')}
                >
                  <Icon.SignOut />
                  sign out
                </button>
              </div>
            </div>
          )}
        </div>

      </aside>
    </>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function NavSection({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>
}

function SectionDivider({ label, collapsed }: { label?: string; collapsed: boolean }) {
  if (collapsed) {
    return (
      <div className="flex justify-center my-2">
        <div className="w-4 h-px" style={{ background: 'var(--color-border)' }} />
      </div>
    )
  }
  if (!label) {
    return <div className="mx-3.5 my-2 h-px" style={{ background: 'var(--color-border)' }} />
  }
  return (
    <div className="flex items-center gap-2.5 px-3.5 my-2">
      <span
        className="text-[8px] font-medium tracking-[0.3em] uppercase shrink-0"
        style={{ color: 'var(--color-text-dim)' }}
      >
        {label}
      </span>
      <div className="flex-1 h-px" style={{ background: 'var(--color-border)' }} />
    </div>
  )
}

function NavRow({
  item,
  collapsed,
  currentPath,
}: {
  item: NavItem
  collapsed: boolean
  currentPath: string
}) {
  const active = pathIsActive(item.path, currentPath)

  return (
    <NavLink
      to={item.path}
      end={item.path === '/'}
      title={collapsed ? item.label : undefined}
      className={clsx(
        'relative flex h-8 items-center transition-colors select-none outline-none',
        collapsed ? 'justify-center' : 'gap-2.5 px-3.5',
        active ? 'nav-item-active' : '',
      )}
      style={({ isActive: _ }) => ({
        color: active
          ? 'var(--color-text)'
          : 'var(--color-text-dim)',
        background: active ? 'color-mix(in srgb, #F0A500 7%, transparent)' : 'transparent',
      })}
      onMouseEnter={e => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)'
          ;(e.currentTarget as HTMLElement).style.background = 'color-mix(in srgb, var(--color-text) 4%, transparent)'
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.color = 'var(--color-text-dim)'
          ;(e.currentTarget as HTMLElement).style.background = 'transparent'
        }
      }}
    >
      {/* Amber left bar for active */}
      {active && (
        <span
          className="absolute left-0 top-1/2 -translate-y-1/2 rounded-r-full"
          style={{ width: 2, height: '55%', background: '#F0A500' }}
        />
      )}

      {/* Icon */}
      <span
        className="shrink-0 transition-colors"
        style={{ color: active ? '#F0A500' : 'currentColor' }}
      >
        {item.icon}
      </span>

      {/* Label */}
      {!collapsed && (
        <span className="text-[11.5px] font-light tracking-wide leading-none">
          {item.label}
        </span>
      )}
    </NavLink>
  )
}