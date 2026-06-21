import { useMemo, useState } from 'react'
import { PageHeader } from '@/components/layout/AppLayout'
import { Card, EmptyState, ErrorState, LoadingState, Button, Input, Tag, SectionHeader } from '@/components/common'
import { useOrganizations, useOrganizationMutations, useAgents } from '@/hooks'
import { formatDate } from '@/utils'
import type { Organization } from '@/types'

export function OrganizationsPage() {
  const { data, isLoading, error, refetch } = useOrganizations()
  const { create, update, remove } = useOrganizationMutations()
  const agents = useAgents()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [agentIdsInput, setAgentIdsInput] = useState('')
  const [agentSelections, setAgentSelections] = useState<Set<string>>(new Set())

  const submitting = create.isPending

  const handleCreate = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const agent_ids = [
      ...new Set([
        ...agentSelections,
        ...agentIdsInput
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ]),
    ]
    create.mutate(
      { name: trimmed, description, agent_ids },
      { onSuccess: () => { setName(''); setDescription(''); setAgentIdsInput(''); setAgentSelections(new Set()) } },
    )
  }

  const orgs = useMemo(() => data ?? [], [data])

  return (
    <div className="space-y-5">
      <PageHeader title="Organizations" subtitle={`${orgs.length} orgs`} />

      <Card className="space-y-3">
        <SectionHeader title="Create organization" subtitle="Group agents and assign them quickly" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} disabled={submitting} />
          <Input label="Description" value={description} onChange={(e) => setDescription(e.target.value)} disabled={submitting} />
          <Input label="Agent IDs (comma separated)" value={agentIdsInput} onChange={(e) => setAgentIdsInput(e.target.value)} disabled={submitting} />
        </div>
        <div className="space-y-2">
          <label className="text-[11px] uppercase tracking-wide text-[--color-text-muted] font-semibold">Select agents</label>
          <select
            multiple
            size={Math.min(8, Math.max(3, (agents.data ?? []).length))}
            className="w-full border border-[--color-border] bg-transparent text-[--color-text] text-xs font-mono rounded p-2"
            disabled={submitting || (agents.data ?? []).length === 0}
            value={[...agentSelections]}
            onChange={(e) => {
              const next = new Set<string>()
              Array.from(e.target.selectedOptions).forEach((opt) => next.add(opt.value))
              setAgentSelections(next)
            }}
          >
            {(agents.data ?? []).map((a) => (
              <option key={a.agent_id} value={a.agent_id}>
                {a.agent_id} — {a.hostname}
              </option>
            ))}
            {(!agents.data || agents.data.length === 0) && <option disabled>No agents available</option>}
          </select>
          <p className="text-[10px] text-[--color-text-muted] font-mono">Use Ctrl/Cmd + click to multi-select; manual IDs still accepted.</p>
        </div>
        <Button size="sm" variant="primary" onClick={handleCreate} loading={submitting} disabled={!name.trim()}>
          Save organization
        </Button>
      </Card>

      <Card padding={false}>
        {isLoading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState error="Failed to load organizations" onRetry={refetch} />
        ) : !orgs.length ? (
          <EmptyState message="No organizations created yet" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[--color-border] text-[--color-text-muted] text-xs uppercase">
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Agents</th>
                <th className="px-3 py-2 text-left">Updated</th>
                <th className="px-3 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[--color-border]">
              {orgs.map((org) => (
                <OrganizationRow
                  key={org.id}
                  org={org}
                  onUpdate={(data) => update.mutate({ id: org.id, data })}
                  onDelete={() => remove.mutate(org.id)}
                  updating={update.isPending}
                  deleting={remove.isPending}
                  agents={agents.data ?? []}
                />
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}

function OrganizationRow({ org, onUpdate, onDelete, updating, deleting, agents }: { org: Organization; onUpdate: (data: { name?: string; description?: string; agent_ids?: string[] }) => void; onDelete: () => void; updating: boolean; deleting: boolean; agents: { agent_id: string; hostname: string }[] }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(org.name)
  const [description, setDescription] = useState(org.description ?? '')
  const [agentInput, setAgentInput] = useState(org.agent_ids.join(', '))
  const [agentSelections, setAgentSelections] = useState<Set<string>>(new Set(org.agent_ids))

  const save = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const combined = new Set([
      ...agentSelections,
      ...agentInput.split(',').map((a) => a.trim()).filter(Boolean),
    ])
    onUpdate({ name: trimmed, description, agent_ids: [...combined] })
    setEditing(false)
  }

  return (
    <tr className="hover:bg-[--color-surface-2]">
      <td className="px-3 py-2 font-mono text-[--color-text]">
        {editing ? (
          <Input value={name} onChange={(e) => setName(e.target.value)} size="sm" disabled={updating || deleting} />
        ) : (
          <div className="flex items-center gap-2">
            <span>{org.name}</span>
            <Tag>{org.id}</Tag>
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-[--color-text-muted]">
        {editing ? (
          <div className="space-y-2">
            <Input value={agentInput} onChange={(e) => setAgentInput(e.target.value)} size="sm" disabled={updating || deleting} />
            <select
              multiple
              size={Math.min(8, Math.max(3, agents.length))}
              className="w-full border border-[--color-border] bg-transparent text-[--color-text] text-xs font-mono rounded p-2"
              disabled={updating || deleting || agents.length === 0}
              value={[...agentSelections]}
              onChange={(e) => {
                const next = new Set<string>()
                Array.from(e.target.selectedOptions).forEach((opt) => next.add(opt.value))
                setAgentSelections(next)
              }}
            >
              {agents.map((a) => (
                <option key={a.agent_id} value={a.agent_id}>
                  {a.agent_id} — {a.hostname}
                </option>
              ))}
              {agents.length === 0 && <option disabled>No agents available</option>}
            </select>
            <p className="text-[10px] text-[--color-text-muted] font-mono">Use Ctrl/Cmd + click to multi-select; manual IDs are merged.</p>
          </div>
        ) : (
          <span>{org.agent_ids.join(', ') || '—'}</span>
        )}
      </td>
      <td className="px-3 py-2 text-[--color-text-muted] text-xs">{org.updated_at ? formatDate(org.updated_at) : '—'}</td>
      <td className="px-3 py-2">
        <div className="flex gap-2">
          {editing ? (
            <>
              <Button size="xs" variant="primary" onClick={save} disabled={!name.trim()} loading={updating}>Save</Button>
              <Button size="xs" variant="ghost" onClick={() => { setEditing(false); setName(org.name); setDescription(org.description ?? ''); setAgentInput(org.agent_ids.join(', ')); setAgentSelections(new Set(org.agent_ids)) }} disabled={updating}>Cancel</Button>
            </>
          ) : (
            <>
              <Button size="xs" variant="ghost" onClick={() => setEditing(true)} disabled={updating || deleting}>Edit</Button>
              <Button size="xs" variant="danger" onClick={() => { if (window.confirm(`Delete organization "${org.name}"?`)) { onDelete() } }} loading={deleting} disabled={updating}>Delete</Button>
            </>
          )}
        </div>
      </td>
    </tr>
  )
}
