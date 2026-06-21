import { useState, useMemo, useCallback, useRef, memo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAgents, useLatestMetrics, useLogs } from '@/hooks'
import { queryKeys } from '@/hooks/queryKeys'
import { useUiStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { PageHeader } from '@/components/layout/AppLayout'
import { DockerMetricsCard, KubernetesMetricsCard } from '@/components/agents'
import {
  Card,
  AgentStatusBadge,
  SeverityBadge,
  Button,
  LoadingState,
  EmptyState,
  Tag,
} from '@/components/common'
import { timeAgo, formatBandwidth } from '@/utils'
import type {
  Agent,
  DockerData,
  KubernetesData,
  LogEntry,
  LogSource,
  NetworkData,
  NetworkInterface,
  ProcessConnection,
  OpenPort,
} from '@/types'
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronUp, ArrowUpToLine, Maximize2, X, Search } from 'lucide-react'

const CSS = `
  .ops-log-entry {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 6px 14px;
    border-bottom: 1px solid color-mix(in srgb, var(--color-border) 60%, transparent);
    transition: background 0.08s;
  }
  .ops-log-entry:hover { background: color-mix(in srgb, var(--color-text) 2.5%, transparent); }
  .ops-log-entry:last-child { border-bottom: none; }

  .ops-agent-row {
    width: 100%;
    text-align: left;
    padding: 10px 14px;
    border-bottom: 1px solid var(--color-border);
    transition: background 0.1s;
    cursor: pointer;
    background: transparent;
    border-left: 2px solid transparent;
  }
  .ops-agent-row:hover { background: color-mix(in srgb, var(--color-text) 3%, transparent); }
  .ops-agent-row.selected {
    background: color-mix(in srgb, #F0A500 6%, transparent);
    border-left-color: #F0A500;
  }

  .ops-view-bar {
    position: sticky;
    top: 0;
    z-index: 10;
    background: var(--color-bg);
    padding: 8px 0;
    margin-bottom: 4px;
  }
`

const DOCKER_SOURCES = new Set<string>(['docker', 'docker_engine'])
const K8S_SOURCES = new Set<string>(['kubernetes', 'k3s_engine'])
const ALL_COLLECTOR_SOURCES = new Set<string>([...DOCKER_SOURCES, ...K8S_SOURCES])

const AgentRow = memo(function AgentRow({
  agent,
  selected,
  onClick,
  hasDockerData,
  hasK8sData,
  hasNetworkData,
}: {
  agent: Agent
  selected: boolean
  onClick: () => void
  hasDockerData: boolean
  hasK8sData: boolean
  hasNetworkData: boolean
}) {
  return (
    <button className={`ops-agent-row ${selected ? 'selected' : ''}`} onClick={onClick}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-mono text-[--color-text] truncate font-medium">{agent.hostname}</span>
        <AgentStatusBadge status={agent.status} />
      </div>
      <div className="flex items-center gap-1.5 mb-1">
        {hasDockerData && <Tag>Docker</Tag>}
        {hasK8sData && <Tag>K8s</Tag>}
        {hasNetworkData && <Tag>Network</Tag>}
      </div>
      <p className="text-xs font-mono text-[--color-text-dim]">{timeAgo(agent.last_seen)}</p>
    </button>
  )
})

function InterfaceCard({ iface }: { iface: NetworkInterface }) {
  const addresses = iface.addresses ?? []
  const isUp = (iface.state ?? '').toLowerCase() === 'up'
  const isDown = ['down', 'lowerlayerdown'].includes((iface.state ?? '').toLowerCase())
  const stateBg = isUp ? 'color-mix(in srgb, #22c55e 12%, transparent)' :
    isDown ? 'color-mix(in srgb, #ef4444 12%, transparent)' :
    'color-mix(in srgb, #eab308 15%, transparent)'
  const stateFg = isUp ? '#22c55e' : isDown ? '#ef4444' : '#eab308'
  return (
    <Card className="flex flex-col gap-0 overflow-hidden" padding={false}>
      <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <span className="text-xs font-mono font-semibold text-[--color-text] truncate">{iface.name}</span>
        <span className="text-[10px] uppercase font-mono font-semibold px-2 py-0.5 rounded" style={{ background: stateBg, color: stateFg }}>
          {iface.state ?? 'unknown'}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-px" style={{ background: 'var(--color-border)' }}>
        <div className="flex items-center justify-between px-3 py-1.5 text-[11px] font-mono" style={{ background: 'color-mix(in srgb, var(--color-surface-2) 50%, transparent)' }}>
          <span className="flex items-center gap-1 text-[--color-text-dim]"><ArrowDownRight size={14} /> In</span>
          <span className="text-[--color-text] font-medium tabular-nums">{formatBandwidth(iface.rx_bytes_rate ?? 0)}</span>
        </div>
        <div className="flex items-center justify-between px-3 py-1.5 text-[11px] font-mono" style={{ background: 'color-mix(in srgb, var(--color-surface-2) 50%, transparent)' }}>
          <span className="flex items-center gap-1 text-[--color-text-dim]"><ArrowUpRight size={14} /> Out</span>
          <span className="text-[--color-text] font-medium tabular-nums">{formatBandwidth(iface.tx_bytes_rate ?? 0)}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-px" style={{ background: 'var(--color-border)' }}>
        <div className="flex items-center justify-between px-3 py-1 text-[11px] font-mono" style={{ background: 'var(--color-surface)' }}>
          <span className="text-[--color-text-dim]">MTU</span>
          <span className="text-[--color-text] tabular-nums">{iface.mtu ?? '–'}</span>
        </div>
        <div className="flex items-center justify-between px-3 py-1 text-[11px] font-mono" style={{ background: 'var(--color-surface)' }}>
          <span className="text-[--color-text-dim]">qdisc</span>
          <span className="text-[--color-text]">{iface.qdisc ?? '–'}</span>
        </div>
      </div>
      <div className="flex items-center justify-between px-3 py-1 text-[11px] font-mono" style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
        <span className="text-[--color-text-dim]">MAC</span>
        <span className="text-[--color-text] truncate tabular-nums">{iface.mac ?? '–'}</span>
      </div>
      {addresses.length > 0 && (
        <div style={{ borderTop: '1px solid var(--color-border)' }}>
          <div className="px-3 py-1.5 text-[10px] font-mono text-[--color-text-dim] uppercase tracking-wide" style={{ background: 'color-mix(in srgb, var(--color-surface-2) 50%, transparent)' }}>
            Addresses
          </div>
          <div className="divide-y divide-[--color-border]">
            {addresses.map((addr, idx) => (
              <div key={`${iface.name}-addr-${idx}`} className="flex items-center justify-between px-3 py-1 text-[11px] font-mono" style={{ background: 'var(--color-surface)' }}>
                <span className="text-[--color-text-dim]">{addr.family === 'inet6' ? 'v6' : 'v4'}</span>
                <span className="text-[--color-text] truncate tabular-nums">{addr.address}/{addr.prefix}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

const STATE_COLOR: Record<string, string> = {
  ESTABLISHED: '#22c55e',
  LISTEN: '#3b82f6',
  TIME_WAIT: '#f97316',
  CLOSE_WAIT: '#f97316',
  SYN_SENT: '#eab308',
  SYN_RECV: '#eab308',
  FIN_WAIT1: '#eab308',
  FIN_WAIT2: '#eab308',
  CLOSE: '#9ca3af',
  LAST_ACK: '#9ca3af',
  CLOSING: '#9ca3af',
}

const COLUMN_BG = {
  pid: 'color-mix(in srgb, #22c55e 5%, transparent)',
  process: 'color-mix(in srgb, #0ea5e9 6%, transparent)',
  proto: 'color-mix(in srgb, #3b82f6 10%, transparent)',
  local: 'color-mix(in srgb, #8b5cf6 6%, transparent)',
  remote: 'color-mix(in srgb, #f97316 6%, transparent)',
  state: 'color-mix(in srgb, #22c55e 10%, transparent)',
  queues: 'color-mix(in srgb, #eab308 6%, transparent)',
  processInfo: 'color-mix(in srgb, #0ea5e9 6%, transparent)',
}

const HEADER_BG = {
  pid: 'color-mix(in srgb, #22c55e 65%, #0b0d10 35%)',
  process: 'color-mix(in srgb, #0ea5e9 65%, #0b0d10 35%)',
  proto: 'color-mix(in srgb, #3b82f6 65%, #0b0d10 35%)',
  local: 'color-mix(in srgb, #8b5cf6 65%, #0b0d10 35%)',
  remote: 'color-mix(in srgb, #f97316 65%, #0b0d10 35%)',
  state: 'color-mix(in srgb, #22c55e 65%, #0b0d10 35%)',
  queues: 'color-mix(in srgb, #eab308 65%, #0b0d10 35%)',
  processInfo: 'color-mix(in srgb, #0ea5e9 65%, #0b0d10 35%)',
}

function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'color-mix(in srgb, #000 60%, transparent)' }}
      onClick={onClose}
    >
      <div
        className="flex flex-col overflow-hidden rounded-lg"
        style={{
          width: '70vw',
          height: '70vh',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <span className="text-xs font-mono text-[--color-text] uppercase tracking-wide">{title}</span>
          <button onClick={onClose} className="text-[--color-text-dim] hover:text-[--color-text] transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function ProcessConnectionsTable({ rows, compact }: { rows: ProcessConnection[]; compact?: boolean }) {
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState('')

  const filtered = useMemo(() => {
    let result = rows
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter((c) =>
        String(c.pid).includes(q) ||
        c.name.toLowerCase().includes(q) ||
        (c.exe ?? '').toLowerCase().includes(q) ||
        c.protocol.toLowerCase().includes(q) ||
        c.local_addr.toLowerCase().includes(q) ||
        c.remote_addr.toLowerCase().includes(q) ||
        String(c.local_port).includes(q) ||
        String(c.remote_port).includes(q) ||
        c.state.toLowerCase().includes(q),
      )
    }
    if (stateFilter) {
      result = result.filter((c) => c.state === stateFilter)
    }
    return result
  }, [rows, search, stateFilter])

  if (!rows.length) return <EmptyState message="No process connections" />

  const stateOptions = useMemo(() => {
    const set = new Set(rows.map((c) => c.state))
    return Array.from(set).sort()
  }, [rows])

  return (
    <div>
      <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-1.5 flex-1" style={{ background: 'color-mix(in srgb, var(--color-text) 6%, transparent)', borderRadius: 4, padding: '4px 8px', border: '1px solid var(--color-border)' }}>
          <Search size={13} className="text-[--color-text-dim] shrink-0" />
          <input
            className="w-full bg-transparent text-[11px] font-mono text-[--color-text] outline-none"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="text-[11px] font-mono bg-transparent text-[--color-text-dim] outline-none px-1 py-1 rounded"
          style={{ border: '1px solid var(--color-border)' }}
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
        >
          <option value="">All states</option>
          {stateOptions.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <span className="text-[10px] font-mono text-[--color-text-muted] whitespace-nowrap">{filtered.length} of {rows.length}</span>
      </div>
      {filtered.length === 0 ? (
        <div className="py-6"><EmptyState message="No matches" /></div>
      ) : (
        <div className="overflow-x-auto" style={compact ? { maxHeight: 280 } : undefined}>
      <table className="min-w-full text-[11px] font-mono text-left">
        <thead className="text-[--color-text-dim] uppercase tracking-wide sticky top-0 z-10">
          <tr>
            <th className="py-2 pl-3 pr-3" style={{ background: HEADER_BG.pid, color: '#0b0d10' }}>PID</th>
            <th className="py-2 pl-3 pr-3" style={{ background: HEADER_BG.process, color: '#0b0d10' }}>Process</th>
            <th className="py-2 pl-3 pr-3" style={{ background: HEADER_BG.proto, color: '#0b0d10' }}>Proto</th>
            <th className="py-2 pl-3 pr-3" style={{ background: HEADER_BG.local, color: '#0b0d10' }}>Local</th>
            <th className="py-2 pl-3 pr-3" style={{ background: HEADER_BG.remote, color: '#0b0d10' }}>Remote</th>
            <th className="py-2 pl-3 pr-3" style={{ background: HEADER_BG.state, color: '#0b0d10' }}>State</th>
            <th className="py-2 pl-3 pr-3" style={{ background: HEADER_BG.queues, color: '#0b0d10' }}>Queues</th>
          </tr>
        </thead>
        <tbody className="text-[--color-text]">
          {filtered.map((c, idx) => {
            const stateColor = STATE_COLOR[c.state] ?? 'var(--color-text-dim)'
            const protoColor = c.protocol.startsWith('udp') ? '#22c55e' : '#3b82f6'
            return (
              <tr key={`${c.pid}-${c.local_port}-${c.remote_port}-${idx}`} className="border-t border-[--color-border]">
                <td className="py-1 pl-3 pr-3" style={{ background: COLUMN_BG.pid }}>{c.pid}</td>
                <td className="py-1 pl-3 pr-3" style={{ background: COLUMN_BG.process }}>
                  <div className="flex flex-col">
                    <span className="truncate">{c.name}</span>
                    {c.exe && <span className="text-[--color-text-dim] truncate">{c.exe}</span>}
                  </div>
                </td>
                <td className="py-1 pl-3 pr-3" style={{ background: COLUMN_BG.proto }}>
                  <span className="px-2 py-0.5 rounded" style={{ background: 'color-mix(in srgb, ' + protoColor + ' 18%, transparent)', color: protoColor }}>
                    {c.protocol}
                  </span>
                </td>
                <td className="py-1 pl-3 pr-3" style={{ background: COLUMN_BG.local }}>{c.local_addr}:{c.local_port}</td>
                <td className="py-1 pl-3 pr-3" style={{ background: COLUMN_BG.remote }}>{c.remote_addr}:{c.remote_port}</td>
                <td className="py-1 pl-3 pr-3" style={{ background: COLUMN_BG.state }}>
                  <span className="px-2 py-0.5 rounded" style={{ background: 'color-mix(in srgb, ' + stateColor + ' 16%, transparent)', color: stateColor }}>
                    {c.state}
                  </span>
                </td>
                <td className="py-1 pl-3 pr-3" style={{ background: COLUMN_BG.queues }}>{c.rx_queue}/{c.tx_queue}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
      )}
    </div>
  )
}

function OpenPortsTable({ rows, compact }: { rows: OpenPort[]; compact?: boolean }) {
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState('')

  const filtered = useMemo(() => {
    let result = rows
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter((p) =>
        p.protocol.toLowerCase().includes(q) ||
        p.local_addr.toLowerCase().includes(q) ||
        String(p.local_port).includes(q) ||
        p.state.toLowerCase().includes(q) ||
        (p.name ?? '').toLowerCase().includes(q) ||
        String(p.pid ?? '').includes(q),
      )
    }
    if (stateFilter) {
      result = result.filter((p) => p.state === stateFilter)
    }
    return result
  }, [rows, search, stateFilter])

  if (!rows.length) return <EmptyState message="No open ports" />

  const stateOptions = useMemo(() => {
    const set = new Set(rows.map((p) => p.state))
    return Array.from(set).sort()
  }, [rows])

  return (
    <div>
      <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-1.5 flex-1" style={{ background: 'color-mix(in srgb, var(--color-text) 6%, transparent)', borderRadius: 4, padding: '4px 8px', border: '1px solid var(--color-border)' }}>
          <Search size={13} className="text-[--color-text-dim] shrink-0" />
          <input
            className="w-full bg-transparent text-[11px] font-mono text-[--color-text] outline-none"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="text-[11px] font-mono bg-transparent text-[--color-text-dim] outline-none px-1 py-1 rounded"
          style={{ border: '1px solid var(--color-border)' }}
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
        >
          <option value="">All states</option>
          {stateOptions.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <span className="text-[10px] font-mono text-[--color-text-muted] whitespace-nowrap">{filtered.length} of {rows.length}</span>
      </div>
      {filtered.length === 0 ? (
        <div className="py-6"><EmptyState message="No matches" /></div>
      ) : (
        <div className="overflow-x-auto" style={compact ? { maxHeight: 280 } : undefined }>
      <table className="min-w-full text-[11px] font-mono text-left">
        <thead className="text-[--color-text-dim] uppercase tracking-wide sticky top-0 z-10">
          <tr>
            <th className="py-2 pl-3 pr-3" style={{ background: HEADER_BG.proto, color: '#0b0d10' }}>Proto</th>
            <th className="py-2 pl-3 pr-3" style={{ background: HEADER_BG.local, color: '#0b0d10' }}>Address</th>
            <th className="py-2 pl-3 pr-3" style={{ background: HEADER_BG.state, color: '#0b0d10' }}>State</th>
            <th className="py-2 pl-3 pr-3" style={{ background: HEADER_BG.processInfo, color: '#0b0d10' }}>Process</th>
          </tr>
        </thead>
        <tbody className="text-[--color-text]">
          {filtered.map((p, idx) => {
            const protoColor = p.protocol.startsWith('udp') ? '#22c55e' : '#3b82f6'
            const stateColor = STATE_COLOR[p.state] ?? 'var(--color-text-dim)'
            return (
              <tr key={`${p.protocol}-${p.local_port}-${idx}`} className="border-t border-[--color-border]">
                <td className="py-1 pl-3 pr-3" style={{ background: COLUMN_BG.proto }}>
                  <span className="px-2 py-0.5 rounded" style={{ background: 'color-mix(in srgb, ' + protoColor + ' 18%, transparent)', color: protoColor }}>
                    {p.protocol}
                  </span>
                </td>
                <td className="py-1 pl-3 pr-3" style={{ background: COLUMN_BG.local }}>{p.local_addr}:{p.local_port}</td>
                <td className="py-1 pl-3 pr-3" style={{ background: COLUMN_BG.state }}>
                  <span className="px-2 py-0.5 rounded" style={{ background: 'color-mix(in srgb, ' + stateColor + ' 16%, transparent)', color: stateColor }}>
                    {p.state}
                  </span>
                </td>
                <td className="py-1 pl-3 pr-3" style={{ background: COLUMN_BG.processInfo }}>
                  {p.pid ? (
                    <div className="flex flex-col">
                      <span>{p.name ?? 'pid ' + p.pid}</span>
                      {p.exe && <span className="text-[--color-text-dim] truncate">{p.exe}</span>}
                    </div>
                  ) : (
                    <span className="text-[--color-text-dim]">–</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
      )}
    </div>
  )
}

function NetworkPanel({ data }: { data?: NetworkData }) {
  if (!data) return <EmptyState message="No network data for this agent" />

  const interfaces = data.interfaces ?? []
  const processConnections = data.process_connections ?? []
  const openPorts = data.open_ports ?? []
  const [showProcesses, setShowProcesses] = useState(true)
  const [showOpenPorts, setShowOpenPorts] = useState(true)
  const [modalContent, setModalContent] = useState<'processes' | 'ports' | null>(null)
  const topRef = useRef<HTMLDivElement>(null)

  const scrollToTop = useCallback(() => {
    const el = topRef.current?.closest('.flex-1.min-w-0')
    if (el) {
      el.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [])

  const closeModal = useCallback(() => setModalContent(null), [])

  return (
    <div className="space-y-4">
      <div ref={topRef} />

      <Modal open={modalContent === 'processes'} title="Per-process connections" onClose={closeModal}>
        <ProcessConnectionsTable rows={processConnections} />
      </Modal>
      <Modal open={modalContent === 'ports'} title="Open ports" onClose={closeModal}>
        <OpenPortsTable rows={openPorts} />
      </Modal>

      {interfaces.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-mono text-[--color-text-dim] uppercase tracking-wide">Interfaces</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {interfaces.map((iface) => (
              <InterfaceCard key={iface.name} iface={iface} />
            ))}
          </div>
        </div>
      )}

      <Card>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-mono text-[--color-text-dim] uppercase tracking-wide">Per-process connections</p>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-[--color-text-muted]">{processConnections.length} entries</span>
            <Button size="sm" variant="ghost" onClick={() => setModalContent('processes')} title="Expand">
              <Maximize2 size={14} />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowProcesses((v) => !v)}>
              {showProcesses ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </Button>
          </div>
        </div>
        {showProcesses && <ProcessConnectionsTable rows={processConnections} compact />}
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-mono text-[--color-text-dim] uppercase tracking-wide">Open ports</p>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-[--color-text-muted]">{openPorts.length} ports</span>
            <Button size="sm" variant="ghost" onClick={() => setModalContent('ports')} title="Expand">
              <Maximize2 size={14} />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowOpenPorts((v) => !v)}>
              {showOpenPorts ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </Button>
          </div>
        </div>
        {showOpenPorts && <OpenPortsTable rows={openPorts} compact />}
      </Card>

      {(interfaces.length > 0 || processConnections.length > 0 || openPorts.length > 0) && (
        <div className="flex justify-center pt-2 pb-4">
          <Button size="sm" variant="ghost" onClick={scrollToTop}>
            <ArrowUpToLine size={16} className="mr-1" /> Back to top
          </Button>
        </div>
      )}
    </div>
  )
}

const CollectorLogRow = memo(function CollectorLogRow({ log }: { log: LogEntry }) {
  return (
    <div className="ops-log-entry">
      <span className="text-[10px] font-mono text-[--color-text-dim] shrink-0 px-1 py-0.5 rounded border border-[--color-border] bg-[--color-surface-2] uppercase tracking-wide">
        {log.source === 'docker' ? 'D' : log.source === 'kubernetes' ? 'K' : '?'}
      </span>
      <SeverityBadge severity={log.severity} />
      <span className="text-[10px] font-mono text-[--color-text-dim] tabular-nums shrink-0">
        {new Date(log.timestamp).toLocaleTimeString()}
      </span>
      <span className="text-xs font-mono text-[--color-text-muted] truncate flex-1">{log.message}</span>
    </div>
  )
})

function CollectorLogsPanel({ agentId }: { agentId: string | null }) {
  const [filterSource, setFilterSource] = useState<LogSource | 'all'>('all')
  const { data: logs = [], isLoading } = useLogs(
    { agent_id: agentId ?? undefined, limit: 200 },
    !!agentId,
  )
  const filtered = useMemo(() => {
    return logs.filter((l) => {
      const source = l.source ?? ''
      if (filterSource === 'docker') return DOCKER_SOURCES.has(source)
      if (filterSource === 'kubernetes') return K8S_SOURCES.has(source)
      return ALL_COLLECTOR_SOURCES.has(source)
    })
  }, [logs, filterSource])

  const containerRef = useRef<HTMLDivElement>(null)

  return (
    <Card padding={false}>
      <div className="p-3 border-b border-[--color-border] flex items-center justify-between">
        <span className="text-[10px] font-mono text-[--color-text-dim] uppercase tracking-wider">
          {filtered.length > 0 ? `${filtered.length} entries` : 'Collector Logs'}
        </span>
        <div className="flex gap-1">
          {(['all', 'docker', 'kubernetes'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilterSource(s)}
              className={`text-[9px] font-mono px-1.5 py-0.5 rounded uppercase tracking-wide transition-colors ${
                filterSource === s
                  ? 'bg-[--color-surface-2] text-[--color-text] border border-[--color-border]'
                  : 'text-[--color-text-dim] hover:text-[--color-text-muted]'
              }`}
            >
              {s === 'all' ? 'All' : s === 'docker' ? 'Docker' : 'K8s'}
            </button>
          ))}
        </div>
      </div>
      <div ref={containerRef} className="overflow-y-auto" style={{ maxHeight: 300 }}>
        {isLoading ? (
          <div className="py-6"><LoadingState label="Loading logs..." /></div>
        ) : filtered.length === 0 ? (
          <div className="py-8">
            <EmptyState message={agentId ? 'No collector logs yet' : 'Select an agent'} />
          </div>
        ) : (
          filtered.map((log) => <CollectorLogRow key={log.id} log={log} />)
        )}
      </div>
    </Card>
  )
}

export function OperationsPage() {
  const qc = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const { selectedAgentId, selectAgent } = useUiStore()
  const { canAccessAgent } = useAuthStore()
  const { data: agentsData, isLoading: agentsLoading } = useAgents()
  const agents = useMemo(() => agentsData?.filter((a) => canAccessAgent(a.agent_id)) ?? [], [agentsData, canAccessAgent])

  const activeAgentId = useMemo(
    () => selectedAgentId ?? agents?.[0]?.agent_id ?? null,
    [selectedAgentId, agents],
  )

  useEffect(() => {
    if (!agents.length && selectedAgentId) {
      selectAgent(null)
      return
    }
    if (selectedAgentId && !agents.some((a) => a.agent_id === selectedAgentId)) {
      selectAgent(agents[0]?.agent_id ?? null)
    }
  }, [agents, selectedAgentId, selectAgent])

  const { data: latestMetrics } = useLatestMetrics(activeAgentId)

  const dockerData = latestMetrics?.['docker']?.data as DockerData | undefined
  const k8sData = latestMetrics?.['kubernetes']?.data as KubernetesData | undefined
  const networkData = latestMetrics?.['network']?.data as NetworkData | undefined

  const agentsForList = agents ?? []

  const dockerAgentCount = dockerData ? 1 : 0
  const k8sAgentCount = k8sData ? 1 : 0
  const networkAgentCount = networkData ? 1 : 0

  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    qc.invalidateQueries({ queryKey: queryKeys.agents() })
    if (activeAgentId) {
      qc.invalidateQueries({ queryKey: queryKeys.telemetryLatest(activeAgentId) })
      qc.invalidateQueries({
        queryKey: queryKeys.logs({ agent_id: activeAgentId, limit: 200 }),
      })
    }
    setTimeout(() => setRefreshing(false), 800)
  }, [qc, activeAgentId])

  const preferredView = useMemo(() => {
    if (dockerData) return 'docker'
    if (k8sData) return 'kubernetes'
    return 'network'
  }, [dockerData, k8sData])

  const [view, setView] = useState<'docker' | 'kubernetes' | 'network'>(preferredView as 'docker' | 'kubernetes' | 'network')

  useEffect(() => {
    if (view === 'docker' && !dockerData && (k8sData || networkData)) {
      setView(k8sData ? 'kubernetes' : 'network')
    } else if (view === 'kubernetes' && !k8sData && (dockerData || networkData)) {
      setView(dockerData ? 'docker' : 'network')
    } else if (!dockerData && !k8sData && view !== 'network') {
      setView('network')
    }
  }, [view, dockerData, k8sData, networkData])

  const viewOptions: Array<{ key: 'docker' | 'kubernetes' | 'network'; label: string; disabled: boolean }> = [
    { key: 'docker', label: 'Docker', disabled: !dockerData },
    { key: 'kubernetes', label: 'Kubernetes', disabled: !k8sData },
    { key: 'network', label: 'Network', disabled: !networkData },
  ]

  return (
    <div className="atlas-dash flex flex-col" style={{ height: '100%', color: 'var(--color-text)', margin: '0 -2rem', width: 'calc(100% + 4rem)' }}>
      <style>{CSS}</style>
        <PageHeader
          title="Operations"
          subtitle="Docker, Kubernetes & Network"
        actions={
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-[--color-text-dim]">
              {agents?.length ?? 0} agents
              {dockerAgentCount > 0 && ` · ${dockerAgentCount} Docker`}
              {k8sAgentCount > 0 && ` · ${k8sAgentCount} K8s`}
              {networkAgentCount > 0 && ` · ${networkAgentCount} Network`}
            </span>
            <Button size="sm" variant="ghost" onClick={handleRefresh}>
              <span className={refreshing ? 'atlas-spin' : ''} style={{ display: 'inline-block' }}>⟳</span> Refresh
            </Button>
          </div>
        }
      />

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Agent list */}
        <Card padding={false} className="shrink-0 overflow-hidden" style={{ width: 220 }}>
          <div className="p-2.5 border-b border-[--color-border]">
            <span className="text-[10px] font-mono text-[--color-text-dim] uppercase tracking-wider">Agents</span>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 120px)' }}>
            {agentsLoading ? (
              <LoadingState />
            ) : agentsForList.length === 0 ? (
              <div className="py-8"><EmptyState message="No agents registered" /></div>
            ) : (
              agentsForList.map((agent) => (
                <AgentRow
                  key={agent.agent_id}
                  agent={agent}
                  selected={agent.agent_id === activeAgentId}
                  onClick={() => selectAgent(agent.agent_id)}
                  hasDockerData={agent.agent_id === activeAgentId && !!dockerData}
                  hasK8sData={agent.agent_id === activeAgentId && !!k8sData}
                  hasNetworkData={agent.agent_id === activeAgentId && !!networkData}
                />
              ))
            )}
          </div>
        </Card>

        {/* Main content */}
        <div className="flex-1 min-w-0 overflow-y-auto space-y-4 relative" style={{ maxHeight: 'calc(100vh - 120px)' }}>
          {!activeAgentId ? (
            <div className="py-16"><EmptyState message="Select an agent" /></div>
          ) : (
            <>
              <div className="ops-view-bar">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {viewOptions.map((opt) => {
                      const colorMap: Record<string, string> = { docker: 'border-sky-700 text-sky-400', kubernetes: 'border-violet-700 text-violet-400', network: 'border-emerald-700 text-emerald-400' }
                      const activeColor = colorMap[opt.key] ?? ''
                      return (
                        <button
                          key={opt.key}
                          onClick={() => !opt.disabled && setView(opt.key)}
                          className={`text-[11px] font-mono px-3 py-1.5 rounded border transition-colors ${
                            view === opt.key
                              ? `bg-[--color-surface-2] text-[--color-text] ${activeColor}`
                              : 'border-transparent bg-transparent text-[--color-text-dim] hover:text-[--color-text] hover:border-[--color-border]'
                          } ${opt.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                        >
                          {opt.label}
                        </button>
                      )
                    })}
                  </div>
                  <span className="text-[10px] font-mono text-[--color-text-dim]">{view === 'network' ? 'Network telemetry with per-process ports' : view === 'docker' ? 'Docker collector telemetry' : 'Kubernetes collector telemetry'}</span>
                </div>
              </div>

              {view === 'docker' && (
                dockerData ? <DockerMetricsCard data={dockerData} /> : <EmptyState message="No Docker data for this agent" />
              )}

              {view === 'kubernetes' && (
                k8sData ? <KubernetesMetricsCard data={k8sData} loading={false} /> : <EmptyState message="No Kubernetes data for this agent" />
              )}

              {view === 'network' && <NetworkPanel data={networkData} />}

              {view === 'network' && !networkData && (
                <Card>
                  <div className="text-sm text-[--color-text]">No network data yet.</div>
                  <div className="text-[11px] font-mono text-[--color-text-dim] mt-1">Enable the network collector for this agent to see interface, port, and per-process details.</div>
                </Card>
              )}

              <CollectorLogsPanel agentId={activeAgentId} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
