import { useState } from 'react'
import { PageHeader } from '@/components/layout/AppLayout'
import { Card, Button, Textarea, LoadingState, ErrorState } from '@/components/common'
import { CommanderTranscript } from '@/components/atlasAi/CommanderTranscript'
import { useCommanderChat } from '@/hooks/useCommanderChat'

export function AiAnalystPage() {
  const [question, setQuestion] = useState('Investigate high CPU on agent X')
  const commander = useCommanderChat()

  const onAsk = async () => {
    await commander.sendMessage(question)
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="AI Analyst" subtitle="Ask the commander; it will call tools as needed" />

      <Card>
        <div className="flex flex-col gap-2">
          <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={4} spellCheck={false} />
          <div className="flex items-center gap-2">
            <Button onClick={onAsk} disabled={commander.sending || !question.trim()}>
              {commander.sending ? 'Thinking...' : 'Ask'}
            </Button>
            {commander.transcript.length > 0 && (
              <Button variant="secondary" onClick={() => commander.reset()} disabled={commander.sending}>
                Reset
              </Button>
            )}
          </div>
        </div>
      </Card>

      {commander.sending && <LoadingState label="Running commander..." />}
      {commander.error && <ErrorState error={`Commander failed: ${commander.error}`} />}

      {commander.transcript.length > 0 && (
        <Card>
          <CommanderTranscript transcript={commander.transcript} />
        </Card>
      )}
    </div>
  )
}

export default AiAnalystPage
