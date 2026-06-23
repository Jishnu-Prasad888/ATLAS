import { useCallback, useEffect, useRef, useState } from 'react'
import { askCommander, type CommanderMessage, type CommanderMessageRole, type CommanderTurn } from '@/api/commander'

interface UseCommanderChatOptions {
  initialMessages?: CommanderMessage[]
  staticMessages?: CommanderMessage[]
  apiKey?: string
}

interface UseCommanderChatResult {
  transcript: CommanderTurn[]
  history: CommanderMessage[]
  sending: boolean
  error: string | null
  sendMessage: (content: string) => Promise<boolean>
  reset: () => void
}

const ALLOWED_ROLES: CommanderMessageRole[] = ['system', 'user', 'assistant', 'tool']

function toCommanderMessages(transcript: CommanderTurn[]): CommanderMessage[] {
  return transcript
    .filter((turn) => ALLOWED_ROLES.includes(turn.role as CommanderMessageRole) && turn.role !== 'system')
    .map((turn) => ({
      role: turn.role as CommanderMessageRole,
      content: turn.content ?? undefined,
      name: turn.name,
      tool_call_id: turn.tool_call_id,
      tool_calls: turn.tool_calls,
    }))
}

export function useCommanderChat(options: UseCommanderChatOptions = {}): UseCommanderChatResult {
  const { initialMessages = [], staticMessages = [], apiKey } = options
  const historyRef = useRef<CommanderMessage[]>(initialMessages)
  const staticRef = useRef<CommanderMessage[]>(staticMessages)
  const [history, setHistory] = useState<CommanderMessage[]>(initialMessages)
  const [transcript, setTranscript] = useState<CommanderTurn[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    staticRef.current = staticMessages
  }, [staticMessages])

  const updateHistory = useCallback((next: CommanderMessage[]) => {
    historyRef.current = next
    setHistory(next)
  }, [])

  const reset = useCallback(() => {
    historyRef.current = []
    setHistory([])
    setTranscript([])
    setError(null)
  }, [])

  const sendMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim()
      if (!trimmed) return false

      const optimisticHistory = [...historyRef.current, { role: 'user' as const, content: trimmed }]
      updateHistory(optimisticHistory)
      setTranscript((prev) => [...prev, { role: 'user', content: trimmed }])
      setSending(true)
      setError(null)

      try {
        const response = await askCommander({ messages: [...staticRef.current, ...optimisticHistory], apiKey })
        setTranscript(response.transcript)
        const derivedHistory = toCommanderMessages(response.transcript)
        updateHistory(derivedHistory)
        return true
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Commander request failed'
        setError(message)
        const rollback = historyRef.current.slice(0, Math.max(0, historyRef.current.length - 1))
        updateHistory(rollback)
        setTranscript((prev) => prev.slice(0, Math.max(0, prev.length - 1)))
        return false
      } finally {
        setSending(false)
      }
    },
    [apiKey, updateHistory],
  )

  return {
    transcript,
    history,
    sending,
    error,
    sendMessage,
    reset,
  }
}
