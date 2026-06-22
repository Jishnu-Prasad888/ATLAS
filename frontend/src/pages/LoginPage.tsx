import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError, authApi } from '@/api'
import { useAuthStore } from '@/store/authStore'
import { wsClient } from '@/ws/client'
import { mapServerErrors } from '@/utils'

type FeedLevel = 'INFO' | 'WARN' | 'METR' | 'AUDT'

type FeedRow = {
  time: string
  level: FeedLevel
  agent: string
  msg: string
}

type FieldErrors = Record<string, string>

const FEED_ROWS: FeedRow[] = [
  { time: '23:32:55', level: 'INFO', agent: 'agent-prod-06', msg: 'Execution queued · sched:daily-0200' },
  { time: '23:32:57', level: 'METR', agent: 'agent-prod-03', msg: 'cpu=8.7% mem=39.1% net=↑0.4 MB/s' },
  { time: '23:32:59', level: 'INFO', agent: 'agent-eu-west-01', msg: 'Agent reconnected · session restored' },
  { time: '23:33:01', level: 'AUDT', agent: 'system', msg: 'New agent registered · fleet size 24' },
  { time: '23:33:02', level: 'METR', agent: 'agent-edge-12', msg: 'cpu=18.3% mem=55.7% disk=61.2%' },
  { time: '23:33:04', level: 'INFO', agent: 'agent-prod-01', msg: 'Heartbeat received · latency 12ms' },
  { time: '23:33:06', level: 'METR', agent: 'agent-edge-07', msg: 'cpu=34.2% mem=61.8% disk=48.1%' },
  { time: '23:33:08', level: 'INFO', agent: 'agent-prod-03', msg: 'Execution complete · exit 0 · 2.3s' },
  { time: '23:33:09', level: 'WARN', agent: 'agent-us-west-02', msg: 'Missed schedule window · retrying' },
]

const FEED_LOOP = [...FEED_ROWS, ...FEED_ROWS]

const LEVEL_COLOR: Record<FeedLevel, string> = {
  INFO: '#38bdf8',
  WARN: '#fbbf24',
  METR: '#5eead4',
  AUDT: '#a78bfa',
}

const CAPABILITIES = [
  { letter: 'A', word: 'Autonomous', desc: 'Self-registering agent fleet with lifecycle management' },
  { letter: 'T', word: 'Telemetry', desc: 'Real-time metrics aggregation with configurable retention' },
  { letter: 'L', word: 'Logging', desc: 'Structured log ingestion, search & tamper-evident storage' },
  { letter: 'A', word: 'Analysis', desc: 'Namespace-scoped execution coordination across the fleet' },
  { letter: 'S', word: 'Surveillance', desc: 'Immutable audit trail, RBAC enforcement & health monitoring' },
]

const INITIAL_UPTIME_SECONDS = 14 * 86400 + 2 * 3600 + 31 * 60 + 47
const SIGNAL_HEX = '#5eead4'

function formatUptimeLabel(totalSeconds: number) {
  const days = Math.floor(totalSeconds / 86400)
  const hours = String(Math.floor((totalSeconds % 86400) / 3600)).padStart(2, '0')
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0')
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${days}d ${hours}:${minutes}:${seconds}`
}

function highlightNumbers(msg: string) {
  return msg
    .split(/(\d[\d.]*)/g)
    .filter(Boolean)
    .map((part, idx) =>
      /^\d/.test(part) ? (
        <span key={idx} className="font-semibold text-[#e7eaef]">
          {part}
        </span>
      ) : (
        <span key={idx}>{part}</span>
      ),
    )
}

export function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [loading, setLoading] = useState(false)
  const [uptimeSeconds, setUptimeSeconds] = useState(INITIAL_UPTIME_SECONDS)

  const login = useAuthStore((s) => s.login)
  const navigate = useNavigate()

  useEffect(() => {
    const timer = setInterval(() => setUptimeSeconds((s) => s + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  const uptimeLabel = useMemo(() => formatUptimeLabel(uptimeSeconds), [uptimeSeconds])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setErrors({})

    const fieldErrors: FieldErrors = {}
    if (!username.trim()) fieldErrors.username = 'Username is required.'
    if (!password) fieldErrors.password = 'Password is required.'
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors)
      return
    }

    setLoading(true)
    try {
      const tokens = await authApi.login(username.trim(), password)
      login(tokens.access, tokens.refresh)
      wsClient.connect(tokens.access)
      navigate('/', { replace: true })
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 400) {
          setErrors(mapServerErrors(err.body ?? {}))
        } else if (err.status === 429) {
          setErrors({ _global: 'Too many login attempts. Try again in a moment.' })
        } else {
          setErrors({ _global: err.message })
        }
      } else {
        setErrors({ _global: 'An unexpected error occurred.' })
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="relative min-h-screen overflow-hidden bg-[#06070a] text-[#e7eaef]"
      style={{ fontFamily: '"IBM Plex Mono", monospace' }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

        @keyframes atlas-row-in { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes atlas-travel { 0% { top: 0%; opacity: 0; } 6% { opacity: 1; } 94% { opacity: 1; } 100% { top: 100%; opacity: 0; } }
        @keyframes atlas-scan { 0% { left: -5%; } 50% { left: 105%; } 100% { left: 105%; } }
        @keyframes atlas-sweep { 0% { left: -60%; } 55% { left: 130%; } 100% { left: 130%; } }
        @keyframes atlas-feed-scroll-down { 0% { transform: translateY(-50%); } 100% { transform: translateY(0); } }
      `}</style>

      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.035) 1px, transparent 1px)',
          backgroundSize: '34px 34px',
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(94,234,212,0.05), transparent 60%), radial-gradient(ellipse 60% 50% at 100% 100%, rgba(94,234,212,0.04), transparent 60%)',
        }}
        aria-hidden
      />

      <div className="relative z-10">
        <div className="flex items-center justify-between border-b border-[#1b212b] px-5 py-[14px] text-[10.5px] uppercase tracking-[0.12em] text-[#454c58] lg:px-7">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex h-[5px] w-[5px] rounded-full shadow-[0_0_6px_rgba(94,234,212,0.35)] animate-pulse"
              style={{ background: SIGNAL_HEX }}
            />
            <span>Central Server · Build 1.0.4</span>
          </div>
          <div className="flex items-center gap-5 text-[#8a9099]">
            <span>
              Fleet <b className="font-semibold text-[#e7eaef]">24</b>
            </span>
            <span className="tabular-nums">Uptime {uptimeLabel}</span>
          </div>
        </div>

        <div
          className="flex w-full flex-col gap-10 px-5 py-8 lg:grid lg:grid-cols-[minmax(0,1.05fr)_1px_640px] lg:gap-10 lg:px-10 lg:py-12"
          style={{ minHeight: 'calc(100vh - 47px)' }}
        >
          {/* Left panel */}
          <div className="order-2 flex min-w-0 flex-col gap-9 lg:order-1">
            <div className="flex flex-col gap-2">
              <p className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-[#454c58]">Central Server</p>
              <div className="flex items-center gap-3">
                <svg className="h-[34px] w-[34px] flex-none" viewBox="0 0 34 34" fill="none" aria-hidden>
                  <path
                    d="M17 2 L30 28 L17 22 L4 28 Z"
                    stroke={SIGNAL_HEX}
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                  />
                  <circle cx="17" cy="16" r="1.6" fill={SIGNAL_HEX} />
                </svg>
                <div className="relative inline-block">
                  <span
                    className="text-[40px] font-extrabold tracking-[0.04em] text-transparent"
                    style={{
                      fontFamily: '"JetBrains Mono", monospace',
                      background: 'linear-gradient(180deg, #fff 0%, #c7cdd6 100%)',
                      WebkitBackgroundClip: 'text',
                      backgroundClip: 'text',
                    }}
                  >
                    ATLAS
                  </span>
                  <span
                    className="pointer-events-none absolute inset-y-0 left-0 w-[6px] mix-blend-overlay"
                    style={{
                      background: 'linear-gradient(180deg, transparent, rgba(255,255,255,0.9), transparent)',
                      filter: 'blur(1px)',
                      animation: 'atlas-scan 4.5s ease-in-out infinite',
                    }}
                    aria-hidden
                  />
                </div>
              </div>
              <p className="text-[12px] text-[#8a9099] tracking-[0.01em]">
                <span className="font-semibold text-[#e7eaef]">A</span>utonomous{' '}
                <span className="font-semibold text-[#e7eaef]">T</span>elemetry,{' '}
                <span className="font-semibold text-[#e7eaef]">L</span>ogging,{` `}
                <span className="font-semibold text-[#e7eaef]">A</span>nalysis &amp;{' '}
                <span className="font-semibold text-[#e7eaef]">S</span>urveillance
              </p>
            </div>

            <div className="h-px bg-gradient-to-r from-[#1b212b] to-transparent" />

            <div className="min-w-0">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8a9099]">
                  <span
                    className="h-[6px] w-[6px] rounded-full shadow-[0_0_7px_rgba(94,234,212,0.35)] animate-pulse"
                    style={{ background: SIGNAL_HEX }}
                  />
                  Live Fleet Feed
                </div>
                <span className="text-[10.5px] text-[#454c58]">12 events / 5s</span>
              </div>
              <div className="relative overflow-hidden rounded-[6px] border border-[#1b212b] bg-gradient-to-b from-[#0b0e13] to-[#10141b] text-[12px]">
                <div className="flex flex-col opacity-0 pointer-events-none select-none">
                  {FEED_ROWS.map((row, idx) => (
                    <div
                      key={`ghost-${row.time}-${row.agent}-${idx}`}
                      className="grid grid-cols-[64px_46px_122px_1fr] items-baseline gap-[14px] px-[14px] py-[6px]"
                      style={{
                        borderBottom: idx === FEED_ROWS.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.03)',
                      }}
                    >
                      <span className="text-[#454c58]">{row.time}</span>
                      <span
                        className="font-semibold tracking-[0.04em]"
                        style={{ color: LEVEL_COLOR[row.level] }}
                      >
                        {row.level}
                      </span>
                      <span className="truncate text-[#8a9099]">{row.agent}</span>
                      <span className="min-w-0 truncate whitespace-nowrap text-[#c4c9d2]">
                        {highlightNumbers(row.msg)}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="absolute inset-0">
                  <div
                    className="flex flex-col"
                    style={{ animation: 'atlas-feed-scroll-down 18s linear infinite' }}
                  >
                    {FEED_LOOP.map((row, idx) => (
                      <div
                        key={`${row.time}-${row.agent}-${idx}`}
                        className="grid grid-cols-[64px_46px_122px_1fr] items-baseline gap-[14px] px-[14px] py-[6px] opacity-0"
                        style={{
                          animation: 'atlas-row-in 0.5s ease forwards',
                          animationDelay: `${0.05 + (idx % FEED_ROWS.length) * 0.07}s`,
                          borderBottom: idx === FEED_LOOP.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.03)',
                        }}
                      >
                        <span className="text-[#454c58]">{row.time}</span>
                        <span
                          className="font-semibold tracking-[0.04em]"
                          style={{ color: LEVEL_COLOR[row.level] }}
                        >
                          {row.level}
                        </span>
                        <span className="truncate text-[#8a9099]">{row.agent}</span>
                        <span className="min-w-0 truncate whitespace-nowrap text-[#c4c9d2]">
                          {highlightNumbers(row.msg)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex gap-4 text-[10px] uppercase tracking-[0.08em] text-[#454c58]">
                {(
                  [
                    ['INFO', LEVEL_COLOR.INFO],
                    ['WARN', LEVEL_COLOR.WARN],
                    ['METR', LEVEL_COLOR.METR],
                    ['AUDT', LEVEL_COLOR.AUDT],
                  ] as const
                ).map(([label, color]) => (
                  <span key={label} className="inline-flex items-center gap-1.5">
                    <i className="h-[6px] w-[6px] rounded-full" style={{ background: color }} />
                    {label}
                  </span>
                ))}
              </div>
            </div>

            <div className="min-w-0">
              <div className="mb-1 flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8a9099]">Platform Capabilities</div>
              </div>
              <div className="mt-1 divide-y divide-white/5">
                {CAPABILITIES.map((row) => (
                  <div key={row.word} className="grid grid-cols-[26px_1fr] gap-[14px] py-[11px]">
                    <div
                      className="flex h-[26px] w-[26px] items-center justify-center rounded-[5px] border border-[#2a323f] bg-[rgba(94,234,212,0.12)] text-[14px] font-bold"
                      style={{ color: SIGNAL_HEX, fontFamily: '"JetBrains Mono", monospace' }}
                    >
                      {row.letter}
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-[13px] font-semibold tracking-[0.01em] text-[#e7eaef]">{row.word}</h4>
                      <p className="mt-[2px] text-[11.5px] leading-[1.4] text-[#8a9099]">{row.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Spine */}
          <div className="relative hidden lg:order-2 lg:block" aria-hidden>
            <div className="absolute inset-0 left-1/2 w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-[#2a323f] to-transparent" />
            <div
              className="absolute left-1/2 top-0 h-[5px] w-[5px] -translate-x-1/2 rounded-full"
              style={{
                background: SIGNAL_HEX,
                boxShadow: '0 0 10px 2px rgba(94,234,212,0.35)',
                animation: 'atlas-travel 5s linear infinite',
              }}
            />
          </div>

          {/* Right panel */}
          <div className="order-1 flex items-center justify-center bg-[radial-gradient(ellipse_100%_60%_at_50%_30%,rgba(94,234,212,0.05),transparent_70%)] px-4 py-8 lg:order-3 lg:px-6 lg:py-12">
            <div className="relative w-full max-w-[640px] min-h-[720px] rounded-[10px] border border-[#2a323f] bg-gradient-to-bl from-[#10141b] to-[#0b0e13] px-[32px] pb-16 pt-[80px] shadow-[0_0_0_1px_rgba(255,255,255,0.02)_inset,0_30px_60px_-20px_rgba(0,0,0,0.6)] lg:min-h-[820px] lg:px-[40px]">
              <div className="pointer-events-none absolute -left-[1px] -top-[1px] h-[14px] w-[14px] rounded-tl-[6px] border-l-[1.5px] border-t-[1.5px] border-[#5eead4] opacity-55" />
              <div className="pointer-events-none absolute -right-[1px] -top-[1px] h-[14px] w-[14px] rounded-tr-[6px] border-r-[1.5px] border-t-[1.5px] border-[#5eead4] opacity-55" />
              <div className="pointer-events-none absolute -left-[1px] -bottom-[1px] h-[14px] w-[14px] rounded-bl-[6px] border-b-[1.5px] border-l-[1.5px] border-[#5eead4] opacity-55" />
              <div className="pointer-events-none absolute -right-[1px] -bottom-[1px] h-[14px] w-[14px] rounded-br-[6px] border-b-[1.5px] border-r-[1.5px] border-[#5eead4] opacity-55" />

              <div className="mb-7 flex items-center gap-3">
                <svg className="h-[22px] w-[22px] flex-none" viewBox="0 0 34 34" fill="none" aria-hidden>
                  <path d="M17 2 L30 28 L17 22 L4 28 Z" stroke={SIGNAL_HEX} strokeWidth="1.6" strokeLinejoin="round" />
                  <circle cx="17" cy="16" r="1.6" fill={SIGNAL_HEX} />
                </svg>
                <div
                  className="text-[15px] font-bold tracking-[0.05em] text-[#e7eaef]"
                  style={{ fontFamily: '"JetBrains Mono", monospace' }}
                >
                  ATLAS
                </div>
              </div>

              <p className="mb-4 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-[#8a9099]">
                Central Server · Operator Access
              </p>

              <h1 className="mb-6 text-[21px] font-semibold text-[#e7eaef]">Sign in</h1>

              <form className="space-y-4" onSubmit={handleSubmit} noValidate>
                {errors._global && (
                  <p className="rounded border border-red-900 bg-red-950/40 p-2 text-xs text-red-300">
                    {errors._global}
                  </p>
                )}

                <div className="space-y-2">
                  <label htmlFor="login-username" className="block text-[10px] font-semibold uppercase tracking-[0.13em] text-[#8a9099]">
                    Username
                  </label>
                  <input
                    id="login-username"
                    className={`w-full rounded-[5px] border bg-[#080a0d] px-3 py-2.5 text-[13px] text-[#e7eaef] outline-none transition focus:border-[#5eead4] focus:ring-2 focus:ring-[#5eead4]/30 ${
                      errors.username ? 'border-red-700 focus:border-red-600 focus:ring-red-800/60' : 'border-[#2a323f]'
                    }`}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    autoFocus
                    disabled={loading}
                  />
                  {errors.username && <p className="text-[11px] text-red-300">{errors.username}</p>}
                </div>

                <div className="space-y-2">
                  <label htmlFor="login-password" className="block text-[10px] font-semibold uppercase tracking-[0.13em] text-[#8a9099]">
                    Password
                  </label>
                  <input
                    id="login-password"
                    className={`w-full rounded-[5px] border bg-[#080a0d] px-3 py-2.5 text-[13px] text-[#e7eaef] outline-none transition focus:border-[#5eead4] focus:ring-2 focus:ring-[#5eead4]/30 ${
                      errors.password ? 'border-red-700 focus:border-red-600 focus:ring-red-800/60' : 'border-[#2a323f]'
                    }`}
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    disabled={loading}
                  />
                  {errors.password && <p className="text-[11px] text-red-300">{errors.password}</p>}
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="relative mt-2 w-full overflow-hidden rounded-[6px] border bg-gradient-to-b from-[#14403a] to-[#0c2622] px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.1em] text-[#5eead4] transition hover:brightness-125 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
                  style={{ borderColor: SIGNAL_HEX }}
                >
                  <span
                    className="pointer-events-none absolute inset-y-0 left-[-60%] h-full w-[40%]"
                    style={{
                      background: 'linear-gradient(120deg, transparent, rgba(255,255,255,0.18), transparent)',
                      animation: 'atlas-sweep 3.2s ease-in-out infinite',
                    }}
                    aria-hidden
                  />
                  <span className="relative">{loading ? 'Sign in…' : 'Sign in →'}</span>
                </button>
              </form>

              <div className="mt-5 flex justify-center">
                <Link
                  to="/recover"
                  className="border-b border-dotted border-[#2a323f] text-[11px] text-[#8a9099] transition hover:text-[#e7eaef]"
                >
                  Forgot password? Use recovery key
                </Link>
              </div>

              <div className="mt-7 flex items-center justify-center gap-2 border-t border-[#1b212b] pt-4 text-[9.5px] uppercase tracking-[0.07em] text-[#8a9099]">
                <i className="h-[5px] w-[5px] rounded-full" style={{ background: SIGNAL_HEX }} />
                Session encrypted · TLS 1.3
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
