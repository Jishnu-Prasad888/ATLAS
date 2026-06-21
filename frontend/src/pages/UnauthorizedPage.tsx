import { useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/layout/AppLayout'
import { Card, Button } from '@/components/common'

export function UnauthorizedPage() {
  const navigate = useNavigate()

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader title="401 Unauthorized" subtitle="You need to sign in to continue" />

      <Card className="space-y-4">
        <p className="text-sm font-mono text-[--color-text] leading-relaxed">
          Your session is missing or expired. Please sign in to access the Beacon console. If you recently logged out,
          use the button below to return to the login page.
        </p>

        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={() => navigate('/login')}>Go to login</Button>
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>Go back</Button>
        </div>
      </Card>
    </div>
  )
}
