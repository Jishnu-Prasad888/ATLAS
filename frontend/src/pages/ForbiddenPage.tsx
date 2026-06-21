import { PageHeader } from '@/components/layout/AppLayout'
import { Card, Button } from '@/components/common'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'

export function ForbiddenPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader title="403 Forbidden" subtitle="You do not have access to this page" />

      <Card className="space-y-4">
        <p className="text-sm font-mono text-[--color-text] leading-relaxed">
          The requested action is not permitted for your role or assigned resources. If you believe you should have
          access, ask an administrator to grant the appropriate permissions.
        </p>

        <div className="rounded-lg border border-[--color-border] bg-[--color-surface-2] px-3.5 py-3 text-xs font-mono text-[--color-text-dim]">
          <div className="flex items-center justify-between">
            <span>User</span>
            <span className="text-[--color-text]">{user?.username ?? 'unknown'}</span>
          </div>
          <div className="flex items-center justify-between mt-2">
            <span>Role</span>
            <span className="text-[--color-text] uppercase tracking-wide">{user?.role ?? 'n/a'}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={() => navigate('/')}>Return to dashboard</Button>
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>Go back</Button>
        </div>
      </Card>
    </div>
  )
}
