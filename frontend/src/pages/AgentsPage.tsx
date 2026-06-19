import { useState } from 'react'
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
} from '@/components/common'
import { timeAgo, formatTimestamp, validateHostname, formatUptime } from '@/utils'
import type { Agent, MetricConfig, SystemInventoryData, KernelData } from '@/types'

type ConfirmAction =
  | { type: 'delete'; agentId: string; hostname: string }
  | { type: 'regenerate'; agentId: string; hostname: string }

export function AgentsPage() {
  const { isAdmin } = useAuthStore()
  const { data: agents, isLoading, error, refetch } = useAgents()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = usePersistedState('agents_search', '')
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null)
  const { enableAgent, disableAgent, deleteAgent, renameAgent, regenerateId } = useAgentMutations()
  const addNotification = useUiStore((s) => s.addNotification)

  const filtered = agents?.filter(
    (a) =>
      !search ||
      a.hostname.toLowerCase().includes(search.toLowerCase()) ||
      a.agent_id.includes(search) ||
      a.tags.some((t) => t.toLowerCase().includes(search.toLowerCase())),
  )

  const selected = agents?.find((a) => a.agent_id === selectedId) ?? null

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
    <div>
      <PageHeader
        title="Agents"
        subtitle={`${agents?.length ?? 0} registered`}
        actions={
          <Button size="sm" variant="ghost" onClick={() => refetch()}>
            Refresh
          </Button>
        }
      />

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
        <div className="lg:w-80 shrink-0">
          <div className="mb-3">
            <Input
              placeholder="Search agents..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <Card padding={false}>
            {isLoading ? (
              <LoadingState />
            ) : error ? (
              <ErrorState error="Failed to load agents" onRetry={refetch} />
            ) : !filtered?.length ? (
              <EmptyState message={search ? 'No agents match filter' : 'No agents registered'} />
            ) : (
              <ul className="divide-y divide-[--color-border]">
                {filtered.map((agent) => (
                  <li key={agent.agent_id}>
                    <button
                      onClick={() => setSelectedId(agent.agent_id)}
                      className={`w-full text-left px-3 py-2.5 hover:bg-[--color-surface-2] transition-colors ${selectedId === agent.agent_id ? 'bg-[--color-surface-2] border-l-2 border-blue-500' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="text-xs font-mono text-[--color-text] truncate font-medium">{agent.hostname}</span>
                        <AgentStatusBadge status={agent.status} />
                      </div>
                      <p className="text-xs font-mono text-[--color-text-muted]">{agent.architecture} · {agent.version}</p>
                      <p className="text-xs font-mono text-[--color-text-dim] mt-0.5">{timeAgo(agent.last_seen)}</p>
                      {agent.is_stale && (
                        <p className="text-xs text-yellow-500 font-mono mt-0.5">no heartbeat</p>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Detail */}
        <div className="flex-1 min-w-0">
          {selected ? (
            <AgentDetail
              agent={selected}
              isAdmin={isAdmin}
              onEnable={() => enableAgent.mutate(selected.agent_id)}
              onDisable={() => disableAgent.mutate(selected.agent_id)}
              onDelete={() => setConfirm({ type: 'delete', agentId: selected.agent_id, hostname: selected.hostname })}
              onRegenerate={() => setConfirm({ type: 'regenerate', agentId: selected.agent_id, hostname: selected.hostname })}
              onRename={(hostname) => renameAgent.mutate({ agentId: selected.agent_id, hostname })}
              renameLoading={renameAgent.isPending}
            />
          ) : (
            <EmptyState message="Select an agent to view details" />
          )}
        </div>
      </div>
    </div>
  )
}

function AgentDetail({
  agent,
  isAdmin,
  onEnable,
  onDisable,
  onDelete,
  onRegenerate,
  onRename,
  renameLoading,
}: {
  agent: Agent
  isAdmin: boolean
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

  const { data: health } = useAgentHealth(agent.agent_id)
  const { data: config } = useMetricConfig(agent.agent_id)
  const { data: latestMetrics } = useLatestMetrics(agent.agent_id)

  const systemInventory = latestMetrics?.system_inventory?.data as unknown as SystemInventoryData | undefined
  const kernelIdentity = systemInventory?.identity as KernelData | undefined

  const handleRename = () => {
    const err = validateHostname(newHostname)
    if (err) { setHostnameErr(err); return }
    setHostnameErr('')
    onRename(newHostname)
    setRenameMode(false)
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
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
                <h2 className="text-sm font-mono font-semibold text-[--color-text]">{agent.hostname}</h2>
                {isAdmin && (
                  <button
                    onClick={() => { setNewHostname(agent.hostname); setRenameMode(true) }}
                    className="text-xs text-[--color-text-dim] hover:text-[--color-text-muted] font-mono transition-colors"
                  >
                    rename
                  </button>
                )}
              </div>
            )}
            <p className="text-xs text-[--color-text-muted] font-mono mt-1 break-all">{agent.agent_id}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <AgentStatusBadge status={agent.status} />
            {isAdmin && (
              <>
                <Toggle
                  checked={agent.is_active}
                  onChange={(v) => v ? onEnable() : onDisable()}
                />
                <Button size="sm" variant="ghost" onClick={onRegenerate}>
                  Regen ID
                </Button>
                <Button size="sm" variant="danger" onClick={onDelete}>
                  Remove
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* Info grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <SectionHeader title="System" />
          <KvRow label="OS" value={agent.os} />
          <KvRow label="Architecture" value={agent.architecture} />
          <KvRow label="Version" value={agent.version} />
          <KvRow label="Registered" value={formatTimestamp(agent.registered_at)} />
          <KvRow label="Last seen" value={timeAgo(agent.last_seen)} />
          <KvRow label="Stale" value={agent.is_stale ? 'Yes' : 'No'} />
          {agent.tags.length > 0 && (
            <div className="flex items-start justify-between gap-4 py-1.5 border-b border-[--color-border] last:border-0">
              <span className="text-xs text-[--color-text-muted] font-mono">Tags</span>
              <div className="flex flex-wrap gap-1 justify-end">
                {agent.tags.map((t) => <Tag key={t}>{t}</Tag>)}
              </div>
            </div>
          )}
        </Card>

        {config && (
          <MetricConfigPanel config={config} isAdmin={isAdmin} agentId={agent.agent_id} />
        )}
      </div>

      {systemInventory && (
        <Card>
          <SectionHeader title="System Inventory" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <KvRow label="CPU Model" value={systemInventory.cpu_model ?? '—'} />
            <KvRow label="Shell" value={systemInventory.shell ?? '—'} />
            <KvRow label="Displays" value={systemInventory.displays?.monitors != null ? `${systemInventory.displays?.monitors}` : '—'} />
            <KvRow label="Battery" value={
              systemInventory.battery?.present
                ? `${systemInventory.battery.capacity_pct ?? '—'}% ${systemInventory.battery.status ?? ''}`
                : 'No battery'
            } />
            <KvRow label="Node" value={String(systemInventory.runtimes?.node ?? '—')} />
            <KvRow label="Python" value={String(systemInventory.runtimes?.python ?? '—')} />
            <KvRow label="Bun" value={String(systemInventory.runtimes?.bun ?? '—')} />
            <KvRow label="Deno" value={String(systemInventory.runtimes?.deno ?? '—')} />
            <KvRow label="Kernel" value={kernelIdentity?.kernel_version ?? '—'} />
            <KvRow label="Uptime" value={kernelIdentity?.uptime_secs ? formatUptime(kernelIdentity.uptime_secs) : '—'} />
          </div>

          {(systemInventory.users?.length || systemInventory.groups?.length) && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px] font-mono text-[--color-text]">
              {systemInventory.users?.length ? (
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.1em] text-[--color-text-muted] mb-1">Users</p>
                  <div className="space-y-0.5 max-h-32 overflow-auto">
                    {systemInventory.users.slice(0, 12).map((u) => <div key={u}>{u}</div>)}
                  </div>
                </div>
              ) : null}
              {systemInventory.groups?.length ? (
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.1em] text-[--color-text-muted] mb-1">Groups</p>
                  <div className="space-y-0.5 max-h-32 overflow-auto">
                    {systemInventory.groups.slice(0, 12).map((g) => <div key={g}>{g}</div>)}
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {systemInventory.network_profiles?.profiles?.length ? (
            <div className="mt-3">
              <p className="text-[10px] font-mono uppercase tracking-[0.1em] text-[--color-text-muted] mb-1">Wi‑Fi Profiles</p>
              <div className="flex flex-wrap gap-1 text-[11px] font-mono text-[--color-text]">
                {systemInventory.network_profiles.profiles.slice(0, 12).map((p) => <Tag key={p}>{p}</Tag>)}
              </div>
            </div>
          ) : null}

          {systemInventory.bluetooth?.paired?.length ? (
            <div className="mt-3">
              <p className="text-[10px] font-mono uppercase tracking-[0.1em] text-[--color-text-muted] mb-1">Bluetooth</p>
              <div className="space-y-0.5 text-[11px] font-mono text-[--color-text]">
                {systemInventory.bluetooth.paired.slice(0, 8).map((b) => <div key={b}>{b}</div>)}
              </div>
            </div>
          ) : null}
        </Card>
      )}

      {/* Collector health */}
      {health && Object.keys(health.collectors).length > 0 && (
        <Card>
          <SectionHeader title="Collector Health" />
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-[--color-border]">
                  <th className="text-left py-2 text-[--color-text-muted] font-normal uppercase tracking-wide">Collector</th>
                  <th className="text-left py-2 text-[--color-text-muted] font-normal uppercase tracking-wide">Status</th>
                  <th className="text-left py-2 text-[--color-text-muted] font-normal uppercase tracking-wide">Last Run</th>
                  <th className="text-right py-2 text-[--color-text-muted] font-normal uppercase tracking-wide">Failures</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[--color-border]">
                {Object.entries(health.collectors).map(([name, ch]) => (
                  <tr key={name}>
                    <td className="py-2 capitalize text-[--color-text]">{name}</td>
                    <td className="py-2">
                      <CollectorStatusBadge status={ch.status} />
                    </td>
                    <td className="py-2 text-[--color-text-muted]">{timeAgo(ch.last_run)}</td>
                    <td className={`py-2 text-right tabular-nums ${ch.failure_count > 0 ? 'text-red-400' : 'text-[--color-text-dim]'}`}>
                      {ch.failure_count}
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
          {Object.entries(agent.metadata).map(([k, v]) => (
            <KvRow key={k} label={k} value={String(v)} />
          ))}
        </Card>
      )}
    </div>
  )
}

function MetricConfigPanel({
  config,
  isAdmin,
  agentId,
}: {
  config: MetricConfig
  isAdmin: boolean
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

  const collectors: Array<{ key: keyof MetricConfig; label: string }> = [
    { key: 'cpu_enabled', label: 'CPU' },
    { key: 'ram_enabled', label: 'RAM' },
    { key: 'storage_enabled', label: 'Storage' },
    { key: 'network_enabled', label: 'Network' },
    { key: 'process_enabled', label: 'Processes' },
    { key: 'systemd_enabled', label: 'Systemd' },
    { key: 'system_inventory_enabled', label: 'System Inventory' },
    { key: 'docker_enabled', label: 'Docker' },
    { key: 'kubernetes_enabled', label: 'Kubernetes' },
    { key: 'temperature_enabled', label: 'Temperature' },
    { key: 'power_enabled', label: 'Power' },
  ]

  return (
    <Card>
      <SectionHeader title="Collectors" />
      <div className="space-y-2">
        {collectors.map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between">
            <span className="text-xs font-mono text-[--color-text-muted]">{label}</span>
            <Toggle
              checked={config[key] as boolean}
              onChange={(v) => toggleCollector(key, v)}
              disabled={!isAdmin}
            />
          </div>
        ))}
        <div className="pt-2 border-t border-[--color-border]">
          <KvRow label="Interval" value={`${config.interval_seconds}s`} />
          <KvRow label="Retention" value={`${config.retention_days}d`} />
        </div>
      </div>
    </Card>
  )
}

import { useQueryClient } from '@tanstack/react-query'
