import { NavLink, useNavigate } from 'react-router-dom'
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

type FleetStatus = 'ok' | 'warn' | 'down' | 'unknown'

const STATUS_STYLE: Record<FleetStatus, { text: string; bar: string; dot: string }> = {
  ok:      { text: 'text-emerald-400', bar: 'bg-emerald-400', dot: 'bg-emerald-400 atlas-pulse' },
  warn:    { text: 'text-amber-400',   bar: 'bg-amber-400',   dot: 'bg-amber-400' },
  down:    { text: 'text-red-400',     bar: 'bg-red-500',     dot: 'bg-red-400' },
  unknown: { text: 'text-slate-500',   bar: 'bg-slate-600',   dot: 'bg-slate-600' },
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
  Operations: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.25"/>
      <rect x="9.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.25"/>
      <rect x="1.5" y="9.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.25"/>
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.25"/>
      <path d="M12 7v2M11 8h2" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
    </svg>
  ),
  Organizations: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="5" width="4" height="9.5" rx="1" stroke="currentColor" strokeWidth="1.25" />
      <rect x="6.5" y="1.5" width="4" height="13" rx="1" stroke="currentColor" strokeWidth="1.25" />
      <rect x="11.5" y="7" width="3" height="7.5" rx="1" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  ),
  Reports: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path d="M2 2h9l3 3v9a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.25" />
      <path d="M11 2v3h3" stroke="currentColor" strokeWidth="1.25" />
      <path d="M4 8h6M4 10.5h4M4 13h6" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  ),
  Audit: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path d="M3 2h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.25"/>
      <path d="M5 6h6M5 9h4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
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
  Analyst: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="2" width="13" height="11.5" rx="2" stroke="currentColor" strokeWidth="1.25"/>
      <path d="M4 6.5h3L5.5 10h3L6.5 12.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="11.5" cy="6.5" r="1.3" stroke="currentColor" strokeWidth="1.1"/>
    </svg>
  ),
  SignOut: () => (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M11 11l3-3-3-3M14 8H6"
        stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  ),
  ChevronLeft: ({ rotated }: { rotated?: boolean }) => (
    <svg
      width="14" height="14" viewBox="0 0 16 16" fill="none"
      className={clsx('transition-transform duration-200', rotated && 'rotate-180')}
    >
      <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
}

// ─── Nav structure ────────────────────────────────────────────────────────────

const CORE_NAV_ADMIN: NavItem[] = [
  { path: '/',           label: 'Dashboard',  icon: <Icon.Dashboard /> },
  { path: '/agents',     label: 'Agents',     icon: <Icon.Agents />    },
  { path: '/organizations', label: 'Organizations', icon: <Icon.Organizations /> },
  { path: '/operations', label: 'Operations', icon: <Icon.Operations />},
  { path: '/metrics',    label: 'Metrics',    icon: <Icon.Metrics />   },
  { path: '/logs',       label: 'Logs',       icon: <Icon.Logs />      },
  { path: '/health',     label: 'Health',     icon: <Icon.Health />    },
  { path: '/reports',    label: 'Reports',    icon: <Icon.Reports />   },
  { path: '/ai-analyst', label: 'AI Analyst', icon: <Icon.Analyst />  },
]

const CORE_NAV_MODERATOR: NavItem[] = [
  { path: '/',           label: 'Dashboard',  icon: <Icon.Dashboard /> },
  { path: '/agents',     label: 'Agents',     icon: <Icon.Agents />    },
  { path: '/organizations', label: 'Organizations', icon: <Icon.Organizations /> },
  { path: '/operations', label: 'Operations', icon: <Icon.Operations />},
  { path: '/metrics',    label: 'Metrics',    icon: <Icon.Metrics />   },
  { path: '/logs',       label: 'Logs',       icon: <Icon.Logs />      },
  { path: '/health',     label: 'Health',     icon: <Icon.Health />    },
  { path: '/reports',    label: 'Reports',    icon: <Icon.Reports />   },
  { path: '/ai-analyst', label: 'AI Analyst', icon: <Icon.Analyst />  },
]

const CORE_NAV_VIEWER: NavItem[] = [
  { path: '/',           label: 'Dashboard',  icon: <Icon.Dashboard /> },
  { path: '/agents',     label: 'Agents',     icon: <Icon.Agents />    },
  { path: '/metrics',    label: 'Metrics',    icon: <Icon.Metrics />   },
  { path: '/logs',       label: 'Logs',       icon: <Icon.Logs />      },
  { path: '/health',     label: 'Health',     icon: <Icon.Health />    },
  { path: '/organizations', label: 'Organizations', icon: <Icon.Organizations /> },
  { path: '/reports',    label: 'Reports',    icon: <Icon.Reports />   },
  { path: '/ai-analyst', label: 'AI Analyst', icon: <Icon.Analyst />  },
]

const CORE_NAV_GUEST: NavItem[] = [
  { path: '/',           label: 'Dashboard',  icon: <Icon.Dashboard /> },
  { path: '/agents',     label: 'Agents',     icon: <Icon.Agents />    },
  { path: '/organizations', label: 'Organizations', icon: <Icon.Organizations /> },
]

const ADMIN_NAV: NavItem[] = [
  { path: '/audit',  label: 'Audit',  icon: <Icon.Audit />  },
  { path: '/users',  label: 'Users',  icon: <Icon.Users />  },
  { path: '/config', label: 'Config', icon: <Icon.Config /> },
]

const AUDIT_NAV: NavItem[] = [
  { path: '/audit', label: 'Audit', icon: <Icon.Audit /> },
]

const UTIL_NAV: NavItem[] = [
  { path: '/settings', label: 'Settings', icon: <Icon.Settings /> },
]

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export function Sidebar() {
  const { isAdmin, isModerator, isGuest, user, refreshToken, logout } = useAuthStore()
  const { sidebarCollapsed, toggleSidebar, wsConnected } = useUiStore()
  const { data: health } = useFleetHealth()
  const navigate = useNavigate()

  const handleLogout = async () => {
    try {
      if (refreshToken) await authApi.logout(refreshToken)
    } catch { /* best-effort */ }
    wsClient.destroy()
    logout()
    navigate('/login', { replace: true })
  }

  const totalAgents  = health?.agents.total    ?? 0
  const onlineAgents = health?.agents.online   ?? 0
  const degraded     = health?.agents.degraded ?? 0
  const onlinePct    = totalAgents > 0 ? Math.round((onlineAgents / totalAgents) * 100) : 0

  const fleetStatus: FleetStatus = !health
    ? 'unknown'
    : onlineAgents === 0
    ? 'down'
    : degraded > 0
    ? 'warn'
    : 'ok'

  const { text: statusColor, bar: barColor, dot: dotColor } = STATUS_STYLE[fleetStatus]

  const primaryNav = isAdmin
    ? CORE_NAV_ADMIN
    : isModerator
    ? CORE_NAV_MODERATOR
    : isGuest
    ? CORE_NAV_GUEST
    : CORE_NAV_VIEWER

  const adminNavItems = isAdmin ? ADMIN_NAV : isModerator ? AUDIT_NAV : []
  const utilityNav = isGuest ? [] : UTIL_NAV

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600&display=swap');

        .atlas-sidebar * { font-family: 'JetBrains Mono', monospace; }

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
          background: linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--color-text-dim) 35%, transparent) 50%, transparent 100%);
          animation: atlas-scan 3s ease-in-out infinite;
        }

        /* Icon buttons (header toggle, sign out) */
        .atlas-sidebar .icon-btn {
          color: var(--color-text-dim);
          transition: color 0.15s, background-color 0.15s;
        }
        .atlas-sidebar .icon-btn:hover { color: var(--color-text); background: var(--color-surface-2); }
        .atlas-sidebar .icon-btn:focus-visible {
          outline: none;
          box-shadow: inset 0 0 0 1px var(--color-border);
        }
        .atlas-sidebar .icon-btn-danger:hover { color: #f87171; }

        /* Nav links */
        .atlas-sidebar .nav-link {
          position: relative;
          color: var(--color-text-dim);
          background: transparent;
          transition: color 0.15s, background-color 0.15s, box-shadow 0.15s;
        }
        .atlas-sidebar .nav-link:hover:not(.nav-link-active) {
          color: var(--color-text);
          background: var(--color-surface-2);
        }
        .atlas-sidebar .nav-link-active {
          color: var(--color-text);
          background: var(--color-surface-2);
          box-shadow: inset 0 0 0 1px var(--color-border);
        }
        .atlas-sidebar .nav-link:focus-visible {
          outline: none;
          box-shadow: inset 0 0 0 1px var(--color-border);
        }

        /* Collapsed-state label tooltip */
        .atlas-sidebar .nav-tooltip {
          position: absolute;
          left: calc(100% + 8px);
          top: 50%;
          transform: translate(-4px, -50%);
          padding: 4px 8px;
          font-size: 10.5px;
          font-weight: 300;
          letter-spacing: 0.03em;
          white-space: nowrap;
          border-radius: 4px;
          background: var(--color-surface-2);
          border: 1px solid var(--color-border);
          color: var(--color-text);
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.12s ease, transform 0.12s ease;
          z-index: 50;
        }
        .atlas-sidebar .nav-link:hover .nav-tooltip,
        .atlas-sidebar .nav-link:focus-visible .nav-tooltip {
          opacity: 1;
          transform: translate(0, -50%);
        }
      `}</style>

      <aside
        className={clsx(
          'atlas-sidebar fixed left-0 top-0 z-40 flex h-screen flex-col overflow-hidden',
          'transition-[width] duration-200 ease-in-out',
          sidebarCollapsed ? 'w-[52px]' : 'w-[192px]',
        )}
        style={{
          backgroundColor: 'var(--color-surface)',
          borderRight: '1px solid var(--color-border)',
        }}
      >

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div
          className={clsx(
            'flex shrink-0 items-center overflow-hidden',
            sidebarCollapsed ? 'flex-col gap-2 py-3' : 'h-12 justify-between px-3.5',
          )}
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          {sidebarCollapsed ? (
            <span className="text-[11px] font-semibold select-none" style={{ color: 'var(--color-text)', letterSpacing: '0.15em' }}>
              A
            </span>
          ) : (
            <div className="flex flex-col gap-px overflow-hidden">
              <span className="text-[13px] font-semibold uppercase select-none" style={{ color: 'var(--color-text)', letterSpacing: '0.14em' }}>
                ATLAS
              </span>
              <span className="text-[9px] font-light uppercase select-none truncate" style={{ color: 'var(--color-text-dim)', letterSpacing: '0.3em' }}>
                central server
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={toggleSidebar}
            className="icon-btn shrink-0 rounded p-1"
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!sidebarCollapsed}
          >
            <Icon.ChevronLeft rotated={sidebarCollapsed} />
          </button>
        </div>

        {/* ── Fleet health ─────────────────────────────────────────────── */}
        {health && (
          <div
            className="shrink-0 overflow-hidden"
            style={{ borderBottom: '1px solid var(--color-border)', padding: sidebarCollapsed ? '10px 14px' : '12px 14px' }}
            role="status"
            aria-label={`Fleet: ${onlineAgents} of ${totalAgents} agents online${degraded ? `, ${degraded} degraded` : ''}`}
          >
            {sidebarCollapsed ? (
              <div className="flex justify-center">
                <span className={clsx('w-2 h-2 rounded-full', dotColor)} />
              </div>
            ) : (
              <div className="rounded-md border border-[--color-border] bg-[--color-surface-2] px-2.5 py-2">
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-[9px] font-medium uppercase" style={{ color: 'var(--color-text-dim)', letterSpacing: '0.2em' }}>
                    Fleet
                  </span>
                  <span className={clsx('text-[11px] font-medium tabular-nums', statusColor)}>
                    {onlineAgents}
                    <span style={{ color: 'var(--color-text-dim)' }}>/</span>
                    {totalAgents}
                  </span>
                </div>

                <div className="relative h-[4px] rounded-full overflow-hidden atlas-scan" style={{ background: 'var(--color-border)' }}>
                  <div
                    className={clsx('absolute left-0 top-0 h-full rounded-full transition-[width] duration-700', barColor)}
                    style={{ width: `${onlinePct}%` }}
                  />
                </div>

                <div className="flex items-center justify-between mt-2 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                  <span>{fleetStatus === 'ok' ? 'stable' : fleetStatus === 'warn' ? 'attention' : fleetStatus === 'down' ? 'offline' : 'checking'}</span>
                  {degraded > 0 && <span className="tabular-nums" style={{ color: 'var(--color-text)' }}>{degraded}</span>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Navigation ───────────────────────────────────────────────── */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden" style={{ padding: '6px 0' }} aria-label="Primary">
          <NavSection>
            {primaryNav.map(item => (
              <NavRow key={item.path} item={item} collapsed={sidebarCollapsed} />
            ))}
          </NavSection>

          {adminNavItems.length > 0 && (
            <>
              <SectionDivider label={isAdmin ? 'Admin' : 'Audit'} collapsed={sidebarCollapsed} />
              <NavSection>
                {adminNavItems.map(item => (
                  <NavRow key={item.path} item={item} collapsed={sidebarCollapsed} />
                ))}
              </NavSection>
            </>
          )}

          {utilityNav.length > 0 && (
            <>
              <SectionDivider collapsed={sidebarCollapsed} />
              <NavSection>
                {utilityNav.map(item => (
                  <NavRow key={item.path} item={item} collapsed={sidebarCollapsed} />
                ))}
              </NavSection>
            </>
          )}
        </nav>

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <div className="shrink-0" style={{ borderTop: '1px solid var(--color-border)' }}>
          {sidebarCollapsed ? (
            <div className="flex flex-col items-center gap-3 py-3">
              <span
                className={clsx('w-1.5 h-1.5 rounded-full', wsConnected ? 'bg-emerald-500 atlas-pulse' : 'bg-slate-600')}
                role="status"
                aria-label={wsConnected ? 'Connected' : 'Disconnected'}
              />
              <button type="button" onClick={handleLogout} className="icon-btn icon-btn-danger" aria-label="Sign out">
                <Icon.SignOut />
              </button>
            </div>
          ) : (
            <div className="px-3.5 py-3 space-y-2">
              <div className="flex items-center gap-2">
                <span
                  className={clsx('w-1.5 h-1.5 rounded-full shrink-0', wsConnected ? 'bg-emerald-500 atlas-pulse' : 'bg-slate-600')}
                  role="status"
                />
                <span className="text-[10px] font-light" style={{ color: 'var(--color-text-dim)' }}>
                  {wsConnected ? 'connected' : 'disconnected'}
                </span>
              </div>

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
                  type="button"
                  onClick={handleLogout}
                  className="icon-btn icon-btn-danger flex items-center gap-1.5 text-[10px] font-light"
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
  return <ul className="space-y-px">{children}</ul>
}

function SectionDivider({ label, collapsed }: { label?: string; collapsed: boolean }) {
  if (collapsed) {
    return (
      <div className="flex justify-center my-2" aria-hidden="true">
        <div className="w-4 h-px" style={{ background: 'var(--color-border)' }} />
      </div>
    )
  }
  if (!label) {
    return <div className="mx-3.5 my-2 h-px" style={{ background: 'var(--color-border)' }} aria-hidden="true" />
  }
  return (
    <div className="flex items-center gap-2.5 px-3.5 my-2">
      <span className="text-[8px] font-medium uppercase shrink-0" style={{ color: 'var(--color-text-dim)', letterSpacing: '0.3em' }}>
        {label}
      </span>
      <div className="flex-1 h-px" style={{ background: 'var(--color-border)' }} aria-hidden="true" />
    </div>
  )
}

function NavRow({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  return (
    <li>
      <NavLink
        to={item.path}
        end={item.path === '/'}
        aria-label={collapsed ? item.label : undefined}
        className={({ isActive }) =>
          clsx(
            'nav-link flex h-8 items-center rounded-sm outline-none mx-2',
            collapsed ? 'justify-center' : 'gap-2.5 px-2.5',
            isActive && 'nav-link-active',
          )
        }
      >
        {({ isActive }) => (
          <>
            {isActive && (
              <span
                aria-hidden="true"
                className="absolute left-0 top-1/2 -translate-y-1/2 rounded-r-full"
                style={{ width: 2, height: '55%', background: 'var(--color-border)' }}
              />
            )}
            <span aria-hidden="true" className="shrink-0" style={{ color: isActive ? 'var(--color-text)' : 'currentColor' }}>
              {item.icon}
            </span>
            {collapsed ? (
              <span className="nav-tooltip" role="tooltip">{item.label}</span>
            ) : (
              <span className="text-[11.5px] font-light tracking-wide leading-none truncate">
                {item.label}
              </span>
            )}
          </>
        )}
      </NavLink>
    </li>
  )
}
