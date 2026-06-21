import { PageHeader } from '@/components/layout/AppLayout'
import { Card } from '@/components/common'
import { useAuthStore } from '@/store/authStore'

export function AwaitingApprovalPage() {
  const { user } = useAuthStore()
  const statusLabel = user?.approvalStatus ?? 'pending'

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader
        title="Access Restricted"
        subtitle="Your account is awaiting administrator approval"
      />

      <Card className="space-y-4">
        <p className="text-sm text-[--color-text] font-mono leading-relaxed">
          Your account has been created successfully but is awaiting administrator approval. Access will become available
          once an administrator reviews and authorizes your account.
        </p>

        <div className="rounded-lg border border-[--color-border] bg-[--color-surface-2] px-3.5 py-3 text-xs font-mono text-[--color-text-dim]">
          <div className="flex items-center justify-between">
            <span>Status</span>
            <span className="uppercase tracking-wide text-amber-400">{statusLabel}</span>
          </div>
          {user?.username && (
            <div className="flex items-center justify-between mt-2">
              <span>User</span>
              <span className="text-[--color-text]">{user.username}</span>
            </div>
          )}
          {user?.role && (
            <div className="flex items-center justify-between mt-2">
              <span>Requested role</span>
              <span className="text-[--color-text]">{user.role}</span>
            </div>
          )}
        </div>

        <div className="text-xs text-[--color-text-muted] font-mono leading-relaxed space-y-2">
          <p>If you believe this is unexpected, contact an administrator to review your registration.</p>
          <p>OAuth sign-ins follow the same approval flow. No access is granted until approval completes.</p>
        </div>
      </Card>
    </div>
  )
}
