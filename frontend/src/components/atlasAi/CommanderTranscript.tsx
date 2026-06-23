import type { CommanderTurn } from '@/api/commander'
import { AtlasAiMarkdown } from './Markdown'

interface CommanderTranscriptProps {
  transcript: CommanderTurn[]
  hideSystem?: boolean
}

export function CommanderTranscript({ transcript, hideSystem = true }: CommanderTranscriptProps) {
  const filtered = hideSystem ? transcript.filter((turn) => turn.role !== 'system') : transcript

  if (filtered.length === 0) {
    return <p className="text-xs font-mono text-[--color-text-dim]">No messages yet. Ask a question to get started.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      {filtered.map((turn, idx) => (
        <div
          key={`${turn.role}-${idx}`}
          className="rounded border border-[--color-border] bg-[--color-surface] px-3 py-2 text-xs font-mono text-[--color-text]"
        >
          <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-[--color-text-dim]">
            <span>{turn.role}</span>
            {turn.name && <span className="text-[--color-text-muted] lowercase">{turn.name}</span>}
            {turn.tool_call_id && <span className="text-[--color-text-muted] lowercase">#{turn.tool_call_id}</span>}
          </div>
          {turn.content && (
            <AtlasAiMarkdown className="whitespace-pre-wrap leading-relaxed text-[--color-text]">
              {turn.content}
            </AtlasAiMarkdown>
          )}
          {turn.tool_calls && turn.tool_calls.length > 0 && (
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-[--color-bg] px-2 py-1 text-[10px] text-[--color-text-muted]">
              {JSON.stringify(turn.tool_calls, null, 2)}
            </pre>
          )}
        </div>
      ))}
    </div>
  )
}
