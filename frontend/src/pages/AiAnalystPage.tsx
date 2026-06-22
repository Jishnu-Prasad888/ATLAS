import { useState } from 'react'
import { askCommander, type CommanderTurn } from '@/api/commander'
import { PageHeader } from '@/components/layout/AppLayout'
import { Card, Button, Textarea, LoadingState, ErrorState } from '@/components/common'

export function AiAnalystPage() {
  const [question, setQuestion] = useState('Investigate high CPU on agent X')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<CommanderTurn[]>([])

  const onAsk = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await askCommander(question)
      setTranscript(res.transcript)
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Request failed'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="AI Analyst" subtitle="Ask the commander; it will call tools as needed" />

      <Card>
        <div className="flex flex-col gap-2">
          <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={4} spellCheck={false} />
          <Button onClick={onAsk} disabled={loading || !question.trim()}>
            {loading ? 'Thinking...' : 'Ask'}
          </Button>
        </div>
      </Card>

      {loading && <LoadingState label="Running commander..." />}
      {error && <ErrorState error={`Commander failed: ${error}`} />}

      {transcript.length > 0 && (
        <Card>
          <div className="flex flex-col gap-3 text-sm">
            {transcript.map((m, idx) => (
              <div key={idx} className="border-b border-[--color-border] pb-2">
                <div className="text-xs uppercase text-[--color-text-dim]">{m.role}</div>
                {m.content && <div className="whitespace-pre-wrap">{m.content}</div>}
                {m.tool_calls && (
                  <pre className="bg-black/5 p-2 rounded text-xs overflow-auto">{JSON.stringify(m.tool_calls, null, 2)}</pre>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

export default AiAnalystPage
