import { PageHeader } from '@/components/layout/AppLayout'
import { Card, EmptyState, Tag } from '@/components/common'
import { useAuthStore } from '@/store/authStore'

export function OrganizationsPage() {
  const { user } = useAuthStore()
  const access = user?.accessScope
  const orgIds = access?.organization_ids ?? []
  const hasGlobal = access?.access_all_agents

  const organizations = hasGlobal
    ? ['All organizations']
    : orgIds.map((id) => `Organization ${id}`)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Organizations"
        subtitle={hasGlobal ? 'Global access' : `${organizations.length || 0} assigned`}
      />

      <Card className="space-y-3">
        {organizations.length === 0 ? (
          <EmptyState message="No organizations assigned yet" />
        ) : (
          <ul className="divide-y divide-[--color-border]">
            {organizations.map((name) => (
              <li key={name} className="py-3 px-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-mono text-[--color-text]">{name}</p>
                  <Tag>{hasGlobal ? 'global' : 'assigned'}</Tag>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
