import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAgents, useAgentHealth, useAgentMutations, useMetricConfig, usePersistedState, useLatestMetrics } from '@/hooks'
import { telemetryApi } from '@/api'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import { PageHeader } from '@/components/layout/AppLayout'
import {
  Card,
  AgentStatusBadge,
  CollectorStatusBadge,
  Button,
  Input,
  ConfirmDialog,
  LoadingState,
  EmptyState,
  ErrorState,
  KvRow,
  Tag,
  Toggle,
  SectionHeader,
  GaugeBar,
} from '@/components/common'
import { timeAgo, formatTimestamp, validateHostname, formatUptime, formatBytes } from '@/utils'
import type { Agent, MetricConfig, SystemInventoryData, KernelData, GpuData } from '@/types'

type ConfirmAction =
  | { type: 'delete'; agentId: string; hostname: string }
  | { type: 'regenerate'; agentId: string; hostname: string }

type StatusFilter = 'all' | 'active' | 'inactive' | 'stale'

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'stale', label: 'Stale' },
  { key: 'inactive', label: 'Disabled' },
]

export function AgentsPage() {
  const { isAdmin, isModerator, canAccessAgent } = useAuthStore()
  const canControlAgents = isAdmin || isModerator
  const { data: agents, isLoading, error, refetch } = useAgents()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = usePersistedState('agents_search', '')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null)
  const { enableAgent, disableAgent, deleteAgent, renameAgent, regenerateId } = useAgentMutations()
  const addNotification = useUiStore((s) => s.addNotification)

  const scopedAgents = agents?.filter((a) => canAccessAgent(a.agent_id)) ?? []

  const counts = {
    total: scopedAgents.length,
    active: scopedAgents.filter((a) => a.is_active).length,
    stale: scopedAgents.filter((a) => a.is_stale).length,
    inactive: scopedAgents.filter((a) => !a.is_active).length,
  }

  const filtered = scopedAgents.filter((a) => {
    const matchesSearch =
      !search ||
      a.hostname.toLowerCase().includes(search.toLowerCase()) ||
      a.agent_id.includes(search) ||
      a.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))

    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && a.is_active) ||
      (statusFilter === 'inactive' && !a.is_active) ||
      (statusFilter === 'stale' && a.is_stale)

    return matchesSearch && matchesStatus
  })

  const selected = scopedAgents.find((a) => a.agent_id === selectedId) ?? null

  const handleDelete = (agentId: string) => {
    setConfirm(null)
    deleteAgent.mutate(agentId, {
      onSuccess: () => {
        if (selectedId === agentId) setSelectedId(null)
      },
    })
  }

  const handleRegenerate = (agentId: string) => {
    setConfirm(null)
    regenerateId.mutate(agentId, {
      onSuccess: (data) => {
        addNotification({
          type: 'warning',
          title: 'Agent ID regenerated',
          message: `New ID: ${data.agent_id}. Update agent config.`,
          duration: 0, // persist until dismissed
        })
        setSelectedId(null)
      },
    })
  }

  return (
    <div
      className="rounded-2xl border border-[--color-border] bg-[--color-surface] p-3 sm:p-4 space-y-4 shadow-sm"
      style={{
        backgroundImage:
          'linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)',
        backgroundSize: '26px 26px',
      }}
    >
      <PageHeader
        title="Agents"
        subtitle={
          counts.total
            ? `${counts.total} registered · ${counts.active} active${counts.stale ? ` · ${counts.stale} stale` : ''}`
            : 'No agents registered'
        }
        actions={
          <Button size="sm" variant="ghost" onClick={() => refetch()}>
            Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <OverviewTile label="Registered" value={counts.total} hint="All agents" />
        <OverviewTile label="Active" value={counts.active} hint="Heartbeat received" />
        <OverviewTile label="Stale" value={counts.stale} hint="Missing heartbeat" />
        <OverviewTile label="Disabled" value={counts.inactive} hint="Manually paused" />
      </div>

      {confirm?.type === 'delete' && (
        <ConfirmDialog
          title="Remove agent"
          message={`Remove "${confirm.hostname}"? This deletes all associated health records from the registry.`}
          confirmLabel="Remove"
          danger
          onConfirm={() => handleDelete(confirm.agentId)}
          onCancel={() => setConfirm(null)}
        />
      )}

      {confirm?.type === 'regenerate' && (
        <ConfirmDialog
          title="Regenerate agent ID"
          message={`Regenerate the ID for "${confirm.hostname}"? The agent config must be updated with the new ID, or it will fail to reconnect.`}
          confirmLabel="Regenerate"
          danger
          onConfirm={() => handleRegenerate(confirm.agentId)}
          onCancel={() => setConfirm(null)}
        />
      )}

      <div className="flex gap-4 flex-col lg:flex-row">
        {/* List */}
        <div className={`lg:w-80 shrink-0 ${selectedId ? 'hidden lg:block' : ''}`}>
          <div className="mb-3 space-y-2">
            <Input
              placeholder="Search by hostname, ID, or tag..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
              {STATUS_FILTERS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setStatusFilter(key)}
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-mono font-medium transition-colors ${
                    statusFilter === key
                      ? 'bg-[--color-surface-2] text-[--color-text] ring-1 ring-inset ring-[--color-border]'
                      : 'text-[--color-text-muted] hover:bg-[--color-surface-2] hover:text-[--color-text]'
                  }`}
                >
                  {label}
                  {key !== 'all' && counts[key] > 0 && (
                    <span className="ml-1 tabular-nums opacity-70">{counts[key]}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <Card padding={false} className="overflow-hidden">
            {isLoading ? (
              <LoadingState />
            ) : error ? (
              <ErrorState error="Failed to load agents" onRetry={refetch} />
            ) : !filtered?.length ? (
              <EmptyState message={search || statusFilter !== 'all' ? 'No agents match these filters' : 'No agents registered yet'} />
            ) : (
              <ul className="divide-y divide-[--color-border] max-h-[calc(100vh-260px)] overflow-y-auto">
                {filtered.map((agent) => (
                  <li key={agent.agent_id}>
                    <AgentListItem
                      agent={agent}
                      active={selectedId === agent.agent_id}
                      onSelect={() => setSelectedId(agent.agent_id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Detail */}
        <div className="flex-1 min-w-0 pt-20">
          {selectedId && (
            <button
              onClick={() => setSelectedId(null)}
              className="lg:hidden mb-3 flex items-center gap-1 text-xs font-mono text-[--color-text-muted] hover:text-[--color-text] transition-colors"
            >
              ← Back to agents
            </button>
          )}
          {selected ? (
            <AgentDetail
              agent={selected}
              canControl={canControlAgents}
              onEnable={() => enableAgent.mutate(selected.agent_id)}
              onDisable={() => disableAgent.mutate(selected.agent_id)}
              onDelete={() => setConfirm({ type: 'delete', agentId: selected.agent_id, hostname: selected.hostname })}
              onRegenerate={() => setConfirm({ type: 'regenerate', agentId: selected.agent_id, hostname: selected.hostname })}
              onRename={(hostname) => renameAgent.mutate({ agentId: selected.agent_id, hostname })}
              renameLoading={renameAgent.isPending}
            />
          ) : (
            <Card>
              <EmptyState message="Select an agent from the list to view its details" />
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function AgentListItem({
  agent,
  active,
  onSelect,
}: {
  agent: Agent
  active: boolean
  onSelect: () => void
}) {
  const visibleTags = agent.tags.slice(0, 2)
  const extraTags = agent.tags.length - visibleTags.length

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-3.5 py-3 transition-colors relative ${
        active ? 'bg-[--color-surface-2]' : 'hover:bg-[--color-surface-2]/60'
      }`}
    >
      {active && <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-blue-500" />}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-mono text-[--color-text] truncate font-medium">{agent.hostname}</span>
        <AgentStatusBadge status={agent.status} />
      </div>
      <p className="text-[11px] font-mono text-[--color-text-muted] mt-1">
        {agent.architecture} · v{agent.version}
      </p>
      <div className="flex items-center justify-between gap-2 mt-1.5">
        <span className="text-[11px] font-mono text-[--color-text-dim]">{timeAgo(agent.last_seen)}</span>
        {agent.is_stale && (
          <span className="text-[10px] font-mono uppercase tracking-wide text-yellow-500/90 bg-yellow-500/10 rounded px-1.5 py-0.5">
            no heartbeat
          </span>
        )}
      </div>
      {visibleTags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {visibleTags.map((t) => <Tag key={t}>{t}</Tag>)}
          {extraTags > 0 && <Tag>+{extraTags}</Tag>}
        </div>
      )}
    </button>
  )
}

function OverviewTile({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-[--color-border] bg-[--color-surface-2] px-3.5 py-3 shadow-sm">
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-white/6 via-white/3 to-transparent" />
      <div className="relative">
        <p className="text-[10px] font-mono uppercase tracking-[0.08em] text-[--color-text-muted]">{label}</p>
        <p className="text-lg font-mono font-semibold text-[--color-text] leading-tight">{value}</p>
        {hint && <p className="text-[11px] font-mono text-[--color-text-dim] mt-0.5">{hint}</p>}
      </div>
    </div>
  )
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="px-3.5 py-3" title={title}>
      <p className="text-[10px] font-mono uppercase tracking-[0.08em] text-[--color-text-dim] mb-1">{label}</p>
      <p className="text-[13px] font-mono text-[--color-text] truncate">{value}</p>
    </div>
  )
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-mono uppercase tracking-[0.08em] text-[--color-text-muted] mb-1.5">{children}</p>
  )
}

function AgentDetail({
  agent,
  canControl,
  onEnable,
  onDisable,
  onDelete,
  onRegenerate,
  onRename,
  renameLoading,
}: {
  agent: Agent
  canControl: boolean
  onEnable: () => void
  onDisable: () => void
  onDelete: () => void
  onRegenerate: () => void
  onRename: (hostname: string) => void
  renameLoading: boolean
}) {
  const [renameMode, setRenameMode] = useState(false)
  const [newHostname, setNewHostname] = useState(agent.hostname)
  const [hostnameErr, setHostnameErr] = useState('')
  const [copied, setCopied] = useState(false)

  const { data: health } = useAgentHealth(agent.agent_id)
  const { data: config } = useMetricConfig(agent.agent_id)
  const { data: latestMetrics } = useLatestMetrics(agent.agent_id)

  const systemInventory = latestMetrics?.system_inventory?.data as unknown as SystemInventoryData | undefined
  const kernelIdentity = systemInventory?.identity as KernelData | undefined
  const gpuData = latestMetrics?.gpu?.data as unknown as GpuData | undefined

  const handleRename = () => {
    const err = validateHostname(newHostname)
    if (err) { setHostnameErr(err); return }
    setHostnameErr('')
    onRename(newHostname)
    setRenameMode(false)
  }

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(agent.agent_id)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable — ignore silently
    }
  }

  return (
    <div className="space-y-4">
      {/* Identity + actions */}
      <Card>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            {renameMode ? (
              <div className="flex items-center gap-2">
                <Input
                  value={newHostname}
                  onChange={(e) => setNewHostname(e.target.value)}
                  error={hostnameErr}
                  className="w-48"
                  autoFocus
                />
                <Button size="sm" variant="primary" onClick={handleRename} loading={renameLoading}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRenameMode(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h2 className="text-base font-mono font-semibold text-[--color-text] truncate">{agent.hostname}</h2>
                {canControl && (
                  <button
                    onClick={() => { setNewHostname(agent.hostname); setRenameMode(true) }}
                    className="text-xs text-[--color-text-dim] hover:text-[--color-text-muted] font-mono transition-colors"
                  >
                    rename
                  </button>
                )}
              </div>
            )}
            <div className="flex items-center gap-1.5 mt-1">
              <p className="text-xs text-[--color-text-muted] font-mono break-all">{agent.agent_id}</p>
              <button
                onClick={handleCopyId}
                className="text-[10px] font-mono uppercase tracking-wide text-[--color-text-dim] hover:text-[--color-text-muted] transition-colors shrink-0"
              >
                {copied ? 'copied' : 'copy'}
              </button>
            </div>
          </div>
          <AgentStatusBadge status={agent.status} />
        </div>

        {canControl && (
          <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-[--color-border]">
              <div className="flex items-center gap-2">
              <Toggle checked={agent.is_active} onChange={(v) => (v ? onEnable() : onDisable())} />
              <span className="text-xs font-mono text-[--color-text-muted]">
                {agent.is_active ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={onRegenerate}>
                Regenerate ID
              </Button>
              <Button size="sm" variant="danger" onClick={onDelete}>
                Remove
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Quick stats */}
      <Card padding={false}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-y sm:divide-y-0 divide-[--color-border]">
          <Stat label="OS" value={agent.os} />
          <Stat label="Architecture" value={agent.architecture} />
          <Stat label="Version" value={agent.version} />
          <Stat label="Registered" value={formatTimestamp(agent.registered_at)} />
          <Stat label="Last seen" value={agent.last_seen ? timeAgo(agent.last_seen) : 'never'} title={agent.last_seen ? formatTimestamp(agent.last_seen) : '—'} />
          <Stat label="Status" value={agent.is_stale ? 'Stale' : 'Healthy'} />
        </div>
        {agent.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-3.5 py-3 border-t border-[--color-border]">
            <span className="text-[10px] font-mono uppercase tracking-[0.08em] text-[--color-text-dim]">Tags</span>
            {agent.tags.map((t) => <Tag key={t}>{t}</Tag>)}
          </div>
        )}
      </Card>

      {config && <MetricConfigPanel config={config} canControl={canControl} agentId={agent.agent_id} />}

      {gpuData && (
        <Card>
          <SectionHeader title="GPU" />
          {gpuData.collector_disabled ? (
            <p className="text-xs font-mono text-[--color-text-dim]">Collector disabled</p>
          ) : gpuData.gpus.length === 0 ? (
            <p className="text-xs font-mono text-[--color-text-dim]">No GPUs detected</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {gpuData.gpus.map((gpu) => {
                const memTotalBytes = gpu.memory_total_mb * 1024 * 1024
                const memUsedBytes = gpu.memory_used_mb * 1024 * 1024
                return (
                  <div key={gpu.uuid} className="rounded border border-[--color-border] bg-[--color-surface-2] p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-mono text-[--color-text] truncate">{gpu.name || `GPU ${gpu.index}`}</p>
                        <p className="text-[10px] font-mono text-[--color-text-dim] truncate">{gpu.pci_bus || `idx ${gpu.index}`}</p>
                      </div>
                      <span className="text-[11px] font-mono text-[--color-text-muted]">{gpu.uuid.slice(0, 8)}</span>
                    </div>

                    <GaugeBar label="Utilization" value={gpu.utilization_pct} />
                    <GaugeBar label="Memory" value={gpu.memory_utilization_pct} />

                    <div className="grid grid-cols-2 gap-x-2 text-[11px] font-mono text-[--color-text-dim]">
                      <span>Temp</span>
                      <span className="text-right text-[--color-text]">{gpu.temperature_c.toFixed(0)}°C</span>
                      <span>Memory</span>
                      <span className="text-right text-[--color-text]">{formatBytes(memUsedBytes)} / {formatBytes(memTotalBytes)}</span>
                      {gpu.power_draw_w != null && (
                        <>
                          <span>Power</span>
                          <span className="text-right text-[--color-text]">
                            {gpu.power_draw_w.toFixed(0)}W{gpu.power_limit_w ? ` / ${gpu.power_limit_w.toFixed(0)}W` : ''}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      )}

      {systemInventory && (
        <SystemInventorySection systemInventory={systemInventory} kernelIdentity={kernelIdentity} />
      )}

      {/* Collector health */}
      {health && Object.keys(health.collectors).length > 0 && (
        <Card>
          <SectionHeader title="Collector Health" />
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-xs font-mono border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="text-left py-2 px-1 text-[--color-text-dim] font-normal uppercase tracking-wide text-[10px]">Collector</th>
                  <th className="text-left py-2 px-1 text-[--color-text-dim] font-normal uppercase tracking-wide text-[10px]">Status</th>
                  <th className="text-left py-2 px-1 text-[--color-text-dim] font-normal uppercase tracking-wide text-[10px]">Last Run</th>
                  <th className="text-right py-2 px-1 text-[--color-text-dim] font-normal uppercase tracking-wide text-[10px]">Failures</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(health.collectors).map(([name, ch], i) => (
                  <tr key={name} className={i % 2 === 1 ? 'bg-[--color-surface-2]/40' : ''}>
                    <td className="py-2 px-1 capitalize text-[--color-text] rounded-l">{name}</td>
                    <td className="py-2 px-1">
                      <CollectorStatusBadge status={ch.status} />
                    </td>
                    <td className="py-2 px-1 text-[--color-text-muted]" title={ch.last_run ? formatTimestamp(ch.last_run) : '—'}>
                      {ch.last_run ? timeAgo(ch.last_run) : 'never'}
                    </td>
                    <td className="py-2 px-1 rounded-r">
                      <span
                        className={`block text-right tabular-nums ${
                          ch.failure_count > 0
                            ? 'text-red-400 font-medium'
                            : 'text-[--color-text-dim]'
                        }`}
                      >
                        {ch.failure_count}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Raw metadata */}
      {Object.keys(agent.metadata).length > 0 && (
        <Card>
          <SectionHeader title="Metadata" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            {Object.entries(agent.metadata).map(([k, v]) => (
              <KvRow key={k} label={k} value={String(v)} />
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

function SystemInventorySection({
  systemInventory,
  kernelIdentity,
}: {
  systemInventory: SystemInventoryData
  kernelIdentity?: KernelData
}) {
  const hasAccounts = systemInventory.users?.length || systemInventory.groups?.length
  const hasWifi = Boolean(systemInventory.network_profiles?.profiles?.length)
  const hasBluetooth = Boolean(systemInventory.bluetooth?.paired?.length)

  return (
    <Card>
      <SectionHeader title="System Inventory" />

      <div>
        <SubLabel>Hardware</SubLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
          <KvRow label="CPU Model" value={systemInventory.cpu_model ?? '—'} />
          <KvRow label="Displays" value={systemInventory.displays?.monitors != null ? `${systemInventory.displays?.monitors}` : '—'} />
          <KvRow
            label="Battery"
            value={
              systemInventory.battery?.present
                ? `${systemInventory.battery.capacity_pct ?? '—'}% ${systemInventory.battery.status ?? ''}`
                : 'No battery'
            }
          />
          <KvRow label="Kernel" value={kernelIdentity?.kernel_version ?? '—'} />
          <KvRow label="Uptime" value={kernelIdentity?.uptime_secs ? formatUptime(kernelIdentity.uptime_secs) : '—'} />
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-[--color-border]">
        <SubLabel>Runtime &amp; Shell</SubLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
          <KvRow label="Shell" value={systemInventory.shell ?? '—'} />
          <KvRow label="Node" value={String(systemInventory.runtimes?.node ?? '—')} />
          <KvRow label="Python" value={String(systemInventory.runtimes?.python ?? '—')} />
          <KvRow label="Bun" value={String(systemInventory.runtimes?.bun ?? '—')} />
          <KvRow label="Deno" value={String(systemInventory.runtimes?.deno ?? '—')} />
        </div>
      </div>

      {Boolean(hasAccounts) && (
        <div className="mt-4 pt-4 border-t border-[--color-border] grid grid-cols-1 sm:grid-cols-2 gap-4">
          {systemInventory.users?.length ? (
            <div>
              <SubLabel>Users ({systemInventory.users.length})</SubLabel>
              <div className="rounded-md bg-[--color-surface-2]/60 px-2.5 py-2 max-h-32 overflow-y-auto space-y-0.5 text-[11px] font-mono text-[--color-text]">
                {systemInventory.users.slice(0, 12).map((u) => <div key={u}>{u}</div>)}
              </div>
            </div>
          ) : null}
          {systemInventory.groups?.length ? (
            <div>
              <SubLabel>Groups ({systemInventory.groups.length})</SubLabel>
              <div className="rounded-md bg-[--color-surface-2]/60 px-2.5 py-2 max-h-32 overflow-y-auto space-y-0.5 text-[11px] font-mono text-[--color-text]">
                {systemInventory.groups.slice(0, 12).map((g) => <div key={g}>{g}</div>)}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {(hasWifi || hasBluetooth) && (
        <div className="mt-4 pt-4 border-t border-[--color-border] grid grid-cols-1 sm:grid-cols-2 gap-4">
          {hasWifi && (
            <div>
              <SubLabel>Wi-Fi Profiles</SubLabel>
              <div className="flex flex-wrap gap-1">
                {systemInventory.network_profiles!.profiles!.slice(0, 12).map((p) => <Tag key={p}>{p}</Tag>)}
              </div>
            </div>
          )}
          {hasBluetooth && (
            <div>
              <SubLabel>Bluetooth</SubLabel>
              <div className="space-y-0.5 text-[11px] font-mono text-[--color-text]">
                {systemInventory.bluetooth!.paired!.slice(0, 8).map((b) => <div key={b}>{b}</div>)}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

const COLLECTOR_GROUPS: Array<{ title: string; items: Array<{ key: keyof MetricConfig; label: string }> }> = [
  {
    title: 'Core Metrics',
    items: [
      { key: 'cpu_enabled', label: 'CPU' },
      { key: 'ram_enabled', label: 'RAM' },
      { key: 'storage_enabled', label: 'Storage' },
      { key: 'network_enabled', label: 'Network' },
      { key: 'process_enabled', label: 'Processes' },
      { key: 'gpu_enabled', label: 'GPU' },
    ],
  },
  {
    title: 'Platform',
    items: [
      { key: 'systemd_enabled', label: 'Systemd' },
      { key: 'docker_enabled', label: 'Docker' },
      { key: 'kubernetes_enabled', label: 'Kubernetes' },
      { key: 'system_inventory_enabled', label: 'System Inventory' },
    ],
  },
  {
    title: 'Environment',
    items: [
      { key: 'temperature_enabled', label: 'Temperature' },
      { key: 'power_enabled', label: 'Power' },
    ],
  },
]

function MetricConfigPanel({
  config,
  canControl,
  agentId,
}: {
  config: MetricConfig
  canControl: boolean
  agentId: string
}) {
  const addNotification = useUiStore((s) => s.addNotification)
  const qc = useQueryClient()

  const toggleCollector = async (field: keyof MetricConfig, value: boolean) => {
    try {
      await telemetryApi.updateConfig(agentId, { [field]: value })
      qc.invalidateQueries({ queryKey: ['metrics', 'config', agentId] })
    } catch (e: unknown) {
      addNotification({ type: 'error', title: 'Failed to update config', message: e instanceof Error ? e.message : undefined })
    }
  }

  return (
    <Card>
      <SectionHeader title="Collectors" />
      <div className="space-y-4">
        {COLLECTOR_GROUPS.map((group) => (
          <div key={group.title}>
            <SubLabel>{group.title}</SubLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {group.items.map(({ key, label }) => (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-md px-2.5 py-1.5 bg-[--color-surface-2]/50"
                >
                  <span className="text-xs font-mono text-[--color-text-muted]">{label}</span>
                  <Toggle
                    checked={config[key] as boolean}
                    onChange={(v) => toggleCollector(key, v)}
                    disabled={!canControl}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="grid grid-cols-2 gap-4 pt-3 border-t border-[--color-border]">
          <KvRow label="Interval" value={`${config.interval_seconds}s`} />
          <KvRow label="Retention" value={`${config.retention_days}d`} />
        </div>
      </div>
    </Card>
  )
}
