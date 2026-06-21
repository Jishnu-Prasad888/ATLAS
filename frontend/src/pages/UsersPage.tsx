import { useState, type FormEvent } from 'react'
import { useUsers, useUserMutations, useRegistrations, useRegistrationDecisions, useOrganizations, useAgents } from '@/hooks'
import { useAuthStore } from '@/store/authStore'
import { PageHeader } from '@/components/layout/AppLayout'
import {
  Card,
  Button,
  Input,
  Select,
  Toggle,
  ConfirmDialog,
  LoadingState,
  EmptyState,
  ErrorState,
  StatusBadge,
  SectionHeader,
} from '@/components/common'
import { validateUsername, validatePassword, validateEmail, mapServerErrors, formatDate, timeAgo } from '@/utils'
import { ApiError } from '@/api'
import type { User, Role, RegistrationRequest, Organization, Agent } from '@/types'

function parseAgentList(value: string): string[] {
  return value
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean)
}

function parseOrgList(value: string): number[] {
  return value
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
    .map((o) => Number(o))
    .filter((n) => !Number.isNaN(n))
}

export function UsersPage() {
  const { user: currentUser } = useAuthStore()
  const { data: users, isLoading, error, refetch } = useUsers()
  const { deleteUser, toggleUser, assignRole } = useUserMutations()
  const registrations = useRegistrations()
  const registrationDecisions = useRegistrationDecisions()
  const organizations = useOrganizations()
  const agents = useAgents()

  const [showCreate, setShowCreate] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null)

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle={`${users?.length ?? 0} accounts`}
        actions={
          <Button size="sm" variant="primary" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? 'Cancel' : 'New User'}
          </Button>
        }
      />

      {deleteTarget && (
        <ConfirmDialog
          title="Delete user"
          message={`Delete account "${deleteTarget.username}"? This action cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            deleteUser.mutate(deleteTarget.id)
            setDeleteTarget(null)
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {showCreate && (
      <Card className="mb-5">
        <SectionHeader title="Create User" />
        <CreateUserForm
          organizations={organizations.data ?? []}
          agents={agents.data ?? []}
          onSuccess={() => setShowCreate(false)}
          onError={() => {}}
        />
      </Card>
      )}

      <Card className="mb-5">
        <SectionHeader title="Registrations" subtitle="Approve or reject new access requests" />
        {registrations.isLoading ? (
          <LoadingState />
        ) : registrations.error ? (
          <ErrorState error="Failed to load registrations" onRetry={registrations.refetch} />
        ) : !registrations.data?.length ? (
          <EmptyState message="No pending registrations" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[--color-border] text-[--color-text-muted] uppercase tracking-wide">
                  {['User', 'Role', 'Reason', 'Submitted', 'Status', 'Actions'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[--color-border]">
                {registrations.data?.map((req) => (
                  <RegistrationRow key={req.id} request={req} decisions={registrationDecisions} organizations={organizations.data ?? []} agents={agents.data ?? []} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card padding={false}>
        {isLoading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState error="Failed to load users" onRetry={refetch} />
        ) : !users?.length ? (
          <EmptyState message="No users" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-[--color-border]">
                  {['Username', 'Email', 'Role', 'Approval', 'Status', 'Last Login', 'Created', 'Actions'].map((h) => (
                    <th key={h} className="text-left px-3 py-2 text-[--color-text-muted] font-normal uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[--color-border]">
                {users.map((u) => (
                  <UserRow
                    key={u.id}
                    user={u}
                    isSelf={u.id === currentUser?.id}
                    onDelete={() => setDeleteTarget(u)}
                    onToggle={(active) => toggleUser.mutate({ id: u.id, active })}
                    onRoleChange={(role) => assignRole.mutate({ id: u.id, role })}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function RegistrationRow({ request, decisions, organizations, agents }: { request: RegistrationRequest; decisions: ReturnType<typeof useRegistrationDecisions>; organizations: Organization[]; agents: Agent[] }) {
  const [role, setRole] = useState<Role>(request.role_requested)
  const [accessAll, setAccessAll] = useState(false)
  const [agentIds, setAgentIds] = useState('')
  const [orgIds, setOrgIds] = useState('')
  const [pending, setPending] = useState<'approve' | 'reject' | null>(null)
  const [orgSelections, setOrgSelections] = useState<Set<number>>(new Set())
  const [agentSelections, setAgentSelections] = useState<Set<string>>(new Set())

  const approve = () => {
    setPending('approve')
    decisions.approve.mutate(
      {
        id: request.id,
        role,
        access_all_agents: accessAll,
        agent_ids: [...new Set([...agentSelections, ...parseAgentList(agentIds)])],
        organization_ids: [...new Set([...orgSelections, ...parseOrgList(orgIds)])],
      },
      { onSettled: () => setPending(null) },
    )
  }

  const reject = () => {
    setPending('reject')
    decisions.reject.mutate(request.id, { onSettled: () => setPending(null) })
  }

  return (
    <tr className="hover:bg-[--color-surface-2]">
      <td className="px-3 py-2 font-mono text-[--color-text]">
        {request.username}
        <span className="text-[--color-text-muted] ml-2">{request.email}</span>
      </td>
      <td className="px-3 py-2 text-[--color-text-muted]">
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="bg-transparent text-xs font-mono border border-[--color-border] rounded px-1.5 py-1"
          disabled={pending !== null}
        >
          <option value="viewer">viewer</option>
          <option value="moderator">moderator</option>
          <option value="administrator">administrator</option>
          <option value="guest">guest</option>
        </select>
      </td>
      <td className="px-3 py-2 text-[--color-text-muted]">{request.reason || '—'}</td>
      <td className="px-3 py-2 text-[--color-text-muted]">{formatDate(request.created_at)}</td>
      <td className="px-3 py-2">
        <StatusBadge status={request.status === 'pending' ? 'warning' : request.status === 'approved' ? 'active' : 'inactive'} label={request.status} />
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Toggle label="Access all" checked={accessAll} onChange={setAccessAll} disabled={pending !== null} />
          </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <input
            value={agentIds}
            onChange={(e) => setAgentIds(e.target.value)}
                placeholder="Agent IDs"
                className="text-xs font-mono border border-[--color-border] rounded px-2 py-1 bg-transparent text-[--color-text]"
                disabled={pending !== null}
              />
          <input
            value={orgIds}
            onChange={(e) => setOrgIds(e.target.value)}
            placeholder="Org IDs"
            className="text-xs font-mono border border-[--color-border] rounded px-2 py-1 bg-transparent text-[--color-text]"
            disabled={pending !== null}
          />
          <div className="col-span-full space-y-2">
            <label className="text-[10px] uppercase tracking-wide text-[--color-text-muted] font-semibold">Select agents</label>
            <select
              multiple
              size={Math.min(4, Math.max(2, agents.length))}
              className="w-full border border-[--color-border] bg-transparent text-[--color-text] text-xs font-mono rounded p-1.5"
              disabled={pending !== null || agents.length === 0}
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
          </div>
          <div className="col-span-full space-y-2">
            <label className="text-[10px] uppercase tracking-wide text-[--color-text-muted] font-semibold">Select organizations</label>
            <select
              multiple
              size={Math.min(4, Math.max(2, organizations.length))}
              className="w-full border border-[--color-border] bg-transparent text-[--color-text] text-xs font-mono rounded p-1.5"
              disabled={pending !== null || organizations.length === 0}
              value={[...orgSelections].map(String)}
              onChange={(e) => {
                const next = new Set<number>()
                Array.from(e.target.selectedOptions).forEach((opt) => next.add(Number(opt.value)))
                setOrgSelections(next)
              }}
            >
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} — (ID {o.id})
                </option>
              ))}
              {organizations.length === 0 && <option disabled>No organizations available</option>}
            </select>
          </div>
        </div>
          <div className="flex gap-2">
            <Button size="xs" variant="primary" loading={pending === 'approve'} disabled={pending === 'reject'} onClick={approve}>
              Approve
            </Button>
            <Button size="xs" variant="danger" loading={pending === 'reject'} disabled={pending === 'approve'} onClick={reject}>
              Reject
            </Button>
          </div>
        </div>
      </td>
    </tr>
  )
}

function UserRow({
  user,
  isSelf,
  onDelete,
  onToggle,
  onRoleChange,
}: {
  user: User
  isSelf: boolean
  onDelete: () => void
  onToggle: (active: boolean) => void
  onRoleChange: (role: Role) => void
}) {
  return (
    <tr className="hover:bg-[--color-surface-2] transition-colors">
      <td className="px-3 py-2 text-[--color-text] font-medium">
        {user.username}
        {isSelf && <span className="ml-1.5 text-[--color-text-dim]">(you)</span>}
      </td>
      <td className="px-3 py-2 text-[--color-text-muted]">{user.email || '--'}</td>
      <td className="px-3 py-2">
        <select
          value={user.role}
          onChange={(e) => onRoleChange(e.target.value as Role)}
          disabled={isSelf}
          className="bg-transparent text-xs font-mono text-[--color-text] border border-[--color-border] rounded px-1.5 py-0.5 disabled:opacity-40"
        >
           <option value="viewer">viewer</option>
           <option value="moderator">moderator</option>
           <option value="administrator">administrator</option>
           <option value="guest">guest</option>
         </select>
      </td>
      <td className="px-3 py-2 text-[--color-text-muted] uppercase tracking-wide text-[10px]">
        {user.approval_status}
      </td>
      <td className="px-3 py-2">
        <StatusBadge
          status={user.is_active ? 'active' : 'inactive'}
          variant={user.is_active ? 'online' : 'muted'}
        />
      </td>
      <td className="px-3 py-2 text-[--color-text-muted]">{user.last_login ? timeAgo(user.last_login) : 'Never'}</td>
      <td className="px-3 py-2 text-[--color-text-muted]">{formatDate(user.created_at)}</td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <Toggle
            checked={user.is_active}
            onChange={onToggle}
            disabled={isSelf}
          />
          <Button
            size="sm"
            variant="danger"
            onClick={onDelete}
            disabled={isSelf}
          >
            Delete
          </Button>
        </div>
      </td>
    </tr>
  )
}

function CreateUserForm({
  onSuccess,
  onError,
  organizations,
  agents,
}: {
  onSuccess: () => void
  onError: (e: string) => void
  organizations: Organization[]
  agents: Agent[]
}) {
  const { createUser } = useUserMutations()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('viewer')
  const [accessAll, setAccessAll] = useState(true)
  const [agentIds, setAgentIds] = useState('')
  const [orgIds, setOrgIds] = useState('')
  const [orgSelections, setOrgSelections] = useState<Set<number>>(new Set())
  const [agentSelections, setAgentSelections] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setErrors({})

    const fieldErrors: Record<string, string> = {}
    const unErr = validateUsername(username)
    if (unErr) fieldErrors.username = unErr
    const pwErr = validatePassword(password)
    if (pwErr) fieldErrors.password = pwErr
    const emErr = validateEmail(email)
    if (emErr) fieldErrors.email = emErr

    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors)
      return
    }

    const agent_ids = [...new Set([...agentSelections, ...parseAgentList(agentIds)])]
    const organization_ids = [...new Set([...orgSelections, ...parseOrgList(orgIds)])]

    setLoading(true)
    try {
      await createUser.mutateAsync({ username, email, password, role, access_all_agents: accessAll, agent_ids, organization_ids })
      onSuccess()
    } catch (err) {
      if (err instanceof ApiError && err.body) {
        setErrors(mapServerErrors(err.body as Record<string, string | string[]>))
      } else {
        onError(err instanceof Error ? err.message : 'Unknown error')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <Input
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          error={errors.username}
          autoComplete="off"
          disabled={loading}
        />
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          autoComplete="off"
          disabled={loading}
        />
        <Input
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          hint="Minimum 12 characters"
          autoComplete="new-password"
          disabled={loading}
        />
        <Select
          label="Role"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          disabled={loading}
        >
          <option value="viewer">viewer</option>
          <option value="moderator">moderator</option>
          <option value="administrator">administrator</option>
          <option value="guest">guest</option>
        </Select>
        <Toggle label="Access all agents" checked={accessAll} onChange={setAccessAll} disabled={loading} />
        <Input label="Agent IDs (comma separated)" value={agentIds} onChange={(e) => setAgentIds(e.target.value)} disabled={loading} />
        <div className="col-span-full space-y-2">
          <label className="text-[11px] uppercase tracking-wide text-[--color-text-muted] font-semibold">Select agents</label>
          <select
            multiple
            size={Math.min(6, Math.max(3, agents.length))}
            className="w-full border border-[--color-border] bg-transparent text-[--color-text] text-xs font-mono rounded p-2"
            disabled={loading || agents.length === 0}
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
          <p className="text-[10px] text-[--color-text-muted] font-mono">Use Ctrl/Cmd + click to multi-select</p>
        </div>
        <Input label="Organization IDs (comma separated)" value={orgIds} onChange={(e) => setOrgIds(e.target.value)} disabled={loading} />
        <div className="col-span-full space-y-2">
          <label className="text-[11px] uppercase tracking-wide text-[--color-text-muted] font-semibold">Select organizations</label>
          <select
            multiple
            size={Math.min(6, Math.max(3, organizations.length))}
            className="w-full border border-[--color-border] bg-transparent text-[--color-text] text-xs font-mono rounded p-2"
            disabled={loading || organizations.length === 0}
            value={[...orgSelections].map(String)}
            onChange={(e) => {
              const next = new Set<number>()
              Array.from(e.target.selectedOptions).forEach((opt) => next.add(Number(opt.value)))
              setOrgSelections(next)
            }}
          >
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} — (ID {o.id})
              </option>
            ))}
            {organizations.length === 0 && <option disabled>No organizations available</option>}
          </select>
          <p className="text-[10px] text-[--color-text-muted] font-mono">Use Ctrl/Cmd + click to multi-select</p>
        </div>
      </div>
      {errors._global && (
        <p className="text-xs text-red-400 mb-3">{errors._global}</p>
      )}
      <Button type="submit" variant="primary" size="sm" loading={loading}>
        Create User
      </Button>
    </form>
  )
}
