import { PageHeader } from '@/components/layout/AppLayout'
import { Card, EmptyState } from '@/components/common'
import { useAuthStore } from '@/store/authStore'

export function ReportsPage() {
  const { user } = useAuthStore()
  const role = user?.role ?? 'viewer'

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reports"
        subtitle="Read-only access to assigned resources"
      />

      <Card className="space-y-2">
        <p className="text-sm font-mono text-[--color-text] leading-relaxed">
          Reports are scoped to the organizations and agents assigned to your account. Exports and administrative
          controls are hidden for {role === 'guest' ? 'guest' : 'non-administrator'} roles.
        </p>
        <EmptyState message="Reporting data will appear here once connected to the backend." />
      </Card>
    </div>
  )
}
