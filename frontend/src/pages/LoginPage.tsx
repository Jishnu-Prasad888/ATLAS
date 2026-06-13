import { useState, type FormEvent, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { authApi } from '@/api'
import { useAuthStore } from '@/store/authStore'
import { wsClient } from '@/ws/client'
import { Button, Input } from '@/components/common'
import { ApiError } from '@/api'
import { mapServerErrors } from '@/utils'

// ─── Demo data ────────────────────────────────────────────────────────────────

type LogLevel = 'INFO' | 'WARN' | 'METR' | 'AUDT'

type LogEntry = {
  id: number
  time: string
  level: LogLevel
  agent: string
  msg: string
}

const DEMO_LOGS: Omit<LogEntry, 'id' | 'time'>[] = [
  { level: 'INFO', agent: 'agent-prod-01',    msg: 'Heartbeat received · latency 12ms'         },
  { level: 'METR', agent: 'agent-edge-07',    msg: 'cpu=34.2% mem=61.8% disk=48.1%'            },
  { level: 'INFO', agent: 'agent-prod-03',    msg: 'Execution complete · exit 0 · 2.3s'        },
  { level: 'WARN', agent: 'agent-us-west-02', msg: 'Missed schedule window · retrying'         },
  { level: 'INFO', agent: 'agent-prod-05',    msg: 'Namespace v3 synced · 14 keys'             },
  { level: 'METR', agent: 'agent-prod-01',    msg: 'cpu=12.4% mem=44.2% net=↑2.1 MB/s'        },
  { level: 'AUDT', agent: 'system',           msg: 'User admin rotated encryption key'         },
  { level: 'INFO', agent: 'agent-edge-12',    msg: 'Registered · tags: [prod, eu-west]'        },
  { level: 'METR', agent: 'agent-edge-07',    msg: 'cpu=52.1% mem=70.0% disk=48.3%'            },
  { level: 'INFO', agent: 'agent-prod-02',    msg: 'Command dispatched · queue depth 3'        },
  { level: 'WARN', agent: 'agent-us-east-09', msg: 'Stale heartbeat · 45s elapsed'             },
  { level: 'INFO', agent: 'agent-prod-04',    msg: 'Log batch flushed · 1,240 entries'         },
  { level: 'AUDT', agent: 'system',           msg: 'RBAC policy updated by operator'           },
  { level: 'INFO', agent: 'agent-prod-06',    msg: 'Execution queued · sched:daily-0200'       },
  { level: 'METR', agent: 'agent-prod-03',    msg: 'cpu=8.7% mem=39.1% net=↑0.4 MB/s'         },
  { level: 'INFO', agent: 'agent-eu-west-01', msg: 'Agent reconnected · session restored'      },
  { level: 'AUDT', agent: 'system',           msg: 'New agent registered · fleet size 24'      },
  { level: 'METR', agent: 'agent-edge-12',    msg: 'cpu=18.3% mem=55.7% disk=61.2%'            },
]

const LEVEL_COLOR: Record<LogLevel, string> = {
  INFO: '#34d399',  // emerald-400
  WARN: '#fbbf24',  // amber-400
  METR: '#38bdf8',  // sky-400
  AUDT: '#a78bfa',  // violet-400
}

const ACRONYM_ROWS = [
  { letter: 'A', word: 'Autonomous',   desc: 'Self-registering agent fleet with lifecycle management' },
  { letter: 'T', word: 'Telemetry',    desc: 'Real-time metrics aggregation with configurable retention' },
  { letter: 'L', word: 'Logging',      desc: 'Structured log ingestion, search & tamper-evident storage' },
  { letter: 'A', word: 'Analysis',     desc: 'Namespace-scoped execution coordination across the fleet' },
  { letter: 'S', word: 'Surveillance', desc: 'Immutable audit trail, RBAC enforcement & health monitoring' },
]

function nowHHMMSS() {
  return new Date().toTimeString().slice(0, 8)
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors]     = useState<Record<string, string>>({})
  const [loading, setLoading]   = useState(false)
  const [logs, setLogs]         = useState<LogEntry[]>([])

  const counterRef = useRef(0)
  const login      = useAuthStore((s) => s.login)
  const navigate   = useNavigate()

  // Animate the live feed
  useEffect(() => {
    const initial: LogEntry[] = DEMO_LOGS.slice(0, 9).map((l, i) => ({
      id: i,
      time: nowHHMMSS(),
      ...l,
    }))
    setLogs(initial)
    counterRef.current = initial.length

    const timer = setInterval(() => {
      const entry: LogEntry = {
        id: counterRef.current,
        time: nowHHMMSS(),
        ...DEMO_LOGS[counterRef.current % DEMO_LOGS.length],
      }
      counterRef.current += 1
      setLogs(prev => [...prev.slice(-11), entry])
    }, 1750)

    return () => clearInterval(timer)
  }, [])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setErrors({})

    const fieldErrors: Record<string, string> = {}
    if (!username.trim()) fieldErrors.username = 'Username is required.'
    if (!password)        fieldErrors.password = 'Password is required.'
    if (Object.keys(fieldErrors).length > 0) { setErrors(fieldErrors); return }

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

  const newestId = logs[logs.length - 1]?.id

  return (
    <div className="min-h-screen bg-[--color-bg] flex">

      {/* ── Keyframes ──────────────────────────────────────────────────────── */}
      <style>{`
        @keyframes atlas-log-in {
          from { opacity: 0; transform: translateY(5px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
        .atlas-log-new {
          animation: atlas-log-in 0.32s ease forwards;
        }
        @keyframes atlas-blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
        .atlas-cursor {
          animation: atlas-blink 1.1s step-end infinite;
        }
        @keyframes atlas-pulse-dot {
          0%, 100% { opacity: 1;   transform: scale(1);    }
          50%       { opacity: 0.4; transform: scale(0.75); }
        }
        .atlas-pulse-dot {
          animation: atlas-pulse-dot 2s ease-in-out infinite;
        }
      `}</style>

      {/* ════════════════════════════════════════════════════════════════════
          LEFT PANEL — branding + live demo  (desktop only)
      ════════════════════════════════════════════════════════════════════ */}
      <div className="hidden lg:flex flex-col w-[60%] min-h-screen p-10 border-r border-white/[0.07] overflow-hidden">

        {/* Wordmark */}
        <div className="shrink-0">
          <p className="text-[10px] font-mono text-[--color-text-dim] uppercase tracking-[0.25em] mb-1">
            Central Server · v1.0
          </p>
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-[2rem] font-mono font-bold text-[--color-text] tracking-tight leading-none">
              ATLAS
            </h1>
            <span className="atlas-cursor font-mono text-2xl text-[--color-text-dim] leading-none">_</span>
          </div>
          <p className="text-xs font-mono text-[--color-text-muted] mt-1.5 leading-relaxed">
            Autonomous Telemetry, Logging, Analysis &amp; Surveillance
          </p>
        </div>

        {/* Live feed terminal */}
        <div className="mt-8 flex flex-col" style={{ height: '240px' }}>
          <div className="flex items-center gap-2 mb-2 shrink-0">
            <span className="atlas-pulse-dot w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
            <p className="text-[10px] font-mono text-[--color-text-dim] uppercase tracking-[0.22em]">
              Live Fleet Feed
            </p>
            <span className="ml-auto text-[10px] font-mono text-[--color-text-dim] tabular-nums">
              {logs.length} events
            </span>
          </div>

          <div className="flex-1 relative bg-black/30 border border-white/[0.07] rounded overflow-hidden">
            {/* top fade */}
            <div
              className="absolute inset-x-0 top-0 h-7 pointer-events-none z-10"
              style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, transparent 100%)' }}
            />
            {/* log rows pinned to bottom */}
            <div className="absolute inset-0 flex flex-col justify-end gap-px p-3 overflow-hidden">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className={
                    'flex gap-2 items-baseline font-mono text-[11px] leading-[1.55] whitespace-nowrap' +
                    (log.id === newestId ? ' atlas-log-new' : '')
                  }
                >
                  <span className="text-[--color-text-dim] tabular-nums w-[56px] shrink-0">
                    {log.time}
                  </span>
                  <span
                    className="shrink-0 w-9 tabular-nums font-semibold"
                    style={{ color: LEVEL_COLOR[log.level] }}
                  >
                    {log.level}
                  </span>
                  <span className="text-[--color-text-dim] shrink-0 w-36 truncate">
                    {log.agent}
                  </span>
                  <span className="text-[--color-text-muted] truncate">
                    {log.msg}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Legend */}
          <div className="flex gap-4 mt-2 shrink-0">
            {(Object.entries(LEVEL_COLOR) as [LogLevel, string][]).map(([lvl, color]) => (
              <div key={lvl} className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                <span className="font-mono text-[9px] text-[--color-text-dim] uppercase tracking-wider">
                  {lvl}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Acronym / capability breakdown */}
        <div className="shrink-0">
          <div className="border-t border-white/[0.07] pt-6">
            <p className="text-[10px] font-mono text-[--color-text-dim] uppercase tracking-[0.22em] mb-4">
              Platform Capabilities
            </p>
            <div className="space-y-3">
              {ACRONYM_ROWS.map((row, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="font-mono text-sm font-bold text-[--color-text-dim] w-3 shrink-0 tabular-nums mt-px">
                    {row.letter}
                  </span>
                  <div className="min-w-0">
                    <span className="font-mono text-xs font-semibold text-[--color-text]">
                      {row.word}
                    </span>
                    <p className="font-mono text-[10px] text-[--color-text-muted] mt-0.5 leading-snug">
                      {row.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          RIGHT PANEL — login form
      ════════════════════════════════════════════════════════════════════ */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md">

          {/* Mobile-only wordmark */}
          <div className="lg:hidden mb-8 text-center">
            <p className="text-xs font-mono font-bold text-[--color-text] tracking-tight mb-0.5">ATLAS</p>
            <p className="text-[10px] font-mono text-[--color-text-muted] leading-relaxed">
              Autonomous Telemetry, Logging,<br />Analysis &amp; Surveillance
            </p>
          </div>

          {/* Form header */}
          <div className="mb-10">
            <h1 className="text-4xl font-mono font-bold text-[--color-text] tracking-tight leading-none mb-3">
              ATLAS
            </h1>

            <p className="text-sm font-mono text-[--color-text-dim] uppercase tracking-[0.18em] mb-2">
              Central Server · Operator Access
            </p>

            <div className="h-px w-20 bg-white/10 mb-4" />

            <h2 className="text-xl font-mono font-semibold text-[--color-text]">
              Sign in
            </h2>
          </div>
          
          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-3" noValidate>
            {errors._global && (
              <p className="text-xs font-mono text-red-400 p-2 rounded border border-red-900 bg-red-950/30">
                {errors._global}
              </p>
            )}
            <Input
              label="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              error={errors.username}
              autoComplete="username"
              autoFocus
              disabled={loading}
            />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={errors.password}
              autoComplete="current-password"
              disabled={loading}
            />
            <div className="pt-1">
              <Button
                type="submit"
                variant="primary"
                size="md"
                loading={loading}
                className="w-full"
              >
                Sign in
              </Button>
            </div>
          </form>

          <div className="mt-4 text-center">
            <Link
              to="/recover"
              className="text-xs font-mono text-[--color-text-muted] hover:text-[--color-text] transition-colors"
            >
              Forgot password? Use recovery key
            </Link>
          </div>

          {/* Mobile capability cards */}
          <div className="mt-10 pt-6 border-t border-white/[0.07] lg:hidden">
            <p className="text-[10px] font-mono text-[--color-text-dim] uppercase tracking-[0.2em] mb-3 text-center">
              Platform
            </p>
            <div className="space-y-1.5">
              {ACRONYM_ROWS.map((row, i) => (
                <div key={i} className="flex gap-3 p-2.5 border border-white/[0.07] rounded">
                  <span className="font-mono text-xs font-bold text-[--color-text-dim] w-3 shrink-0 mt-px">
                    {row.letter}
                  </span>
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-semibold text-[--color-text]">{row.word}</p>
                    <p className="font-mono text-[10px] text-[--color-text-muted] mt-0.5 leading-snug">{row.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}