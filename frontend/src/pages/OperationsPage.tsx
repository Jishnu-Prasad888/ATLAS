import { useState, useMemo, useCallback, useRef, useEffect, memo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAgents, useLatestMetrics, useLogs } from '@/hooks'
import { queryKeys } from '@/hooks/queryKeys'
import { useUiStore } from '@/store/uiStore'
import { PageHeader } from '@/components/layout/AppLayout'
import { DockerMetricsCard, KubernetesMetricsCard } from '@/components/agents'
import {
  Card,
  SectionHeader,
  AgentStatusBadge,
  SeverityBadge,
  Button,
  LoadingState,
  EmptyState,
  Tag,
} from '@/components/common'
import { timeAgo } from '@/utils'
import type { Agent, DockerData, KubernetesData, LogEntry, LogSource } from '@/types'

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
}: {
  agent: Agent
  selected: boolean
  onClick: () => void
  hasDockerData: boolean
  hasK8sData: boolean
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
      </div>
      <p className="text-xs font-mono text-[--color-text-dim]">{timeAgo(agent.last_seen)}</p>
    </button>
  )
})

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
  const bottomRef = useRef<HTMLDivElement>(null)
  const isNearBottom = useRef(true)

  const onScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    isNearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }, [])

  useEffect(() => {
    if (isNearBottom.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [filtered.length])

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
      <div ref={containerRef} onScroll={onScroll} className="overflow-y-auto" style={{ maxHeight: 300 }}>
        {isLoading ? (
          <div className="py-6"><LoadingState label="Loading logs..." /></div>
        ) : filtered.length === 0 ? (
          <div className="py-8">
            <EmptyState message={agentId ? 'No collector logs yet' : 'Select an agent'} />
          </div>
        ) : (
          <>
            {filtered.map((log) => <CollectorLogRow key={log.id} log={log} />)}
            <div ref={bottomRef} />
          </>
        )}
      </div>
    </Card>
  )
}

export function OperationsPage() {
  const qc = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const { selectedAgentId, selectAgent } = useUiStore()
  const { data: agents, isLoading: agentsLoading } = useAgents()

  const activeAgentId = useMemo(
    () => selectedAgentId ?? agents?.[0]?.agent_id ?? null,
    [selectedAgentId, agents],
  )

  const activeAgent = useMemo(
    () => agents?.find((a) => a.agent_id === activeAgentId),
    [agents, activeAgentId],
  )

  const { data: latestMetrics, isLoading: metricsLoading } = useLatestMetrics(activeAgentId)

  const dockerData = latestMetrics?.['docker']?.data as DockerData | undefined
  const k8sData = latestMetrics?.['kubernetes']?.data as KubernetesData | undefined

  const agentsForList = agents ?? []

  const dockerAgentCount = dockerData ? 1 : 0
  const k8sAgentCount = k8sData ? 1 : 0

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

  return (
    <div className="atlas-dash" style={{ height: '100%', color: 'var(--color-text)' }}>
      <style>{CSS}</style>

      <PageHeader
        title="Operations"
        subtitle="Docker & Kubernetes"
        actions={
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-[--color-text-dim]">
              {agents?.length ?? 0} agents
              {dockerAgentCount > 0 && ` · ${dockerAgentCount} Docker`}
              {k8sAgentCount > 0 && ` · ${k8sAgentCount} K8s`}
            </span>
            <Button size="sm" variant="ghost" onClick={handleRefresh}>
              <span className={refreshing ? 'atlas-spin' : ''} style={{ display: 'inline-block' }}>⟳</span> Refresh
            </Button>
          </div>
        }
      />

      <div className="flex gap-4" style={{ height: 'calc(100% - 48px)' }}>
        {/* Agent list */}
        <Card padding={false} className="shrink-0 overflow-hidden" style={{ width: 220 }}>
          <div className="p-2.5 border-b border-[--color-border]">
            <span className="text-[10px] font-mono text-[--color-text-dim] uppercase tracking-wider">Agents</span>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 200px)' }}>
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
                />
              ))
            )}
          </div>
        </Card>

        {/* Main content */}
        <div className="flex-1 min-w-0 overflow-y-auto space-y-4" style={{ maxHeight: 'calc(100vh - 200px)' }}>
          {!activeAgentId ? (
            <div className="py-16"><EmptyState message="Select an agent" /></div>
          ) : (
            <>
              {dockerData && <DockerMetricsCard data={dockerData} loading={metricsLoading} />}
              {k8sData && <KubernetesMetricsCard data={k8sData} loading={metricsLoading} />}
              <CollectorLogsPanel agentId={activeAgentId} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
