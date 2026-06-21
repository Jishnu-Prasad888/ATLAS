import { useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/layout/AppLayout'
import { Card, Button } from '@/components/common'

export function NotFoundPage() {
  const navigate = useNavigate()

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader title="404 Not Found" subtitle="We could not find that page" />

      <Card className="space-y-4">
        <p className="text-sm font-mono text-[--color-text] leading-relaxed">
          The requested page does not exist or may have been moved. Check the URL or return to the dashboard to
          continue.
        </p>

        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={() => navigate('/')}>Return to dashboard</Button>
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>Go back</Button>
        </div>
      </Card>
    </div>
  )
}
