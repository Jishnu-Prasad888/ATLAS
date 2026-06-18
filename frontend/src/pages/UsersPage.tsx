import { useState, type FormEvent } from 'react'
import { useUsers, useUserMutations } from '@/hooks'
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
import type { User, Role } from '@/types'

export function UsersPage() {
  const { user: currentUser } = useAuthStore()
  const { data: users, isLoading, error, refetch } = useUsers()
  const { deleteUser, toggleUser, assignRole } = useUserMutations()

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
            onSuccess={() => setShowCreate(false)}
            onError={() => {}}
          />
        </Card>
      )}

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
                  {['Username', 'Email', 'Role', 'Status', 'Last Login', 'Created', 'Actions'].map((h) => (
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
          <option value="administrator">administrator</option>
        </select>
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
}: {
  onSuccess: () => void
  onError: (e: string) => void
}) {
  const { createUser } = useUserMutations()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('viewer')
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

    setLoading(true)
    try {
      await createUser.mutateAsync({ username, email, password, role })
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
          <option value="administrator">administrator</option>
        </Select>
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
