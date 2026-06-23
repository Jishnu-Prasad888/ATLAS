import { create } from 'zustand'
import {
  atlasAiApi,
  type AtlasAiMessage,
  type PendingAction,
  type KeyStatus,
  type ProviderOption,
  type AtlasAiThread,
  type AtlasAiStoredMessage,
} from '@/api'
import { askCommander, type CommanderMessage } from '@/api/commander'
import { env } from '@/config/env'

const getErrorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback)

const MAX_HISTORY_MESSAGES = 12
const MAX_COMMANDER_MESSAGE_CHARS = 4000
const MAX_SAVED_ASSISTANT_CHARS = 6000

function truncateMessage(content: string, limit: number): string {
  if (!content) return content
  if (content.length <= limit) return content
  return `${content.slice(0, limit)}\n\n…[truncated ${content.length - limit} chars]`
}

export type ChatRole = AtlasAiMessage['role']

export interface ChatEntry {
  id: string
  role: ChatRole
  content: string
  created_at?: string
}

interface AtlasAiState {
  open: boolean
  sending: boolean
  messages: ChatEntry[]
  pending: PendingAction[]
  error?: string | null
  keyStatus: KeyStatus | null
  keyLoading: boolean
  keyWorking: boolean
  panelWidth: number
  threads: AtlasAiThread[]
  activeThreadId: string | null
  threadMessages: Record<string, ChatEntry[]>
  threadPending: Record<string, PendingAction[]>
  loadingThreads: boolean
  loadingMessages: boolean
  sessionKey: string | null
  sessionKeyExpiry: number | null
  sessionKeyTimer: ReturnType<typeof setTimeout> | null
  provider: ProviderOption
  model: string
  baseUrl: string
  sessionProvider: ProviderOption | null
  sessionModel: string | null
  sessionBaseUrl: string | null
  threadRenameLoading: boolean
}

interface AtlasAiActions {
  toggle: () => void
  openPanel: () => void
  closePanel: () => void
  loadThreads: () => Promise<void>
  selectThread: (threadId: string) => Promise<void>
  startThread: (title?: string) => Promise<string | null>
  deleteThread: (threadId: string) => Promise<void>
  renameThread: (threadId: string, title: string) => Promise<void>
  send: (content: string, page?: string, context?: Record<string, unknown>) => Promise<void>
  confirm: (action: PendingAction) => Promise<void>
  reset: () => Promise<void>
  refreshKeyStatus: () => Promise<void>
  storeKey: (provider: ProviderOption, apiKey: string, passphrase: string, options?: { model?: string; baseUrl?: string }) => Promise<void>
  unlockKey: (passphrase: string) => Promise<void>
  lockKey: () => Promise<void>
  setPanelWidth: (w: number) => void
  setProvider: (provider: ProviderOption) => void
  setModel: (model: string) => void
  setBaseUrl: (url: string) => void
}

const PANEL_WIDTH_KEY = 'atlas_ai_panel_width'
const ACTIVE_THREAD_KEY = 'atlas_ai_active_thread'

let idCounter = 0

const readPanelWidth = () => {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(PANEL_WIDTH_KEY) : null
  const n = stored ? Number(stored) : 420
  return Number.isFinite(n) ? n : 420
}

const readActiveThreadId = () => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(ACTIVE_THREAD_KEY) : null
  } catch {
    return null
  }
}

const persistActiveThreadId = (id: string | null) => {
  try {
    if (!id) {
      localStorage.removeItem(ACTIVE_THREAD_KEY)
    } else {
      localStorage.setItem(ACTIVE_THREAD_KEY, id)
    }
  } catch {
    /* ignore */
  }
}

const mapStoredToChat = (m: AtlasAiStoredMessage): ChatEntry => ({
  id: `m-${m.id}`,
  role: m.role,
  content: m.content,
  created_at: m.created_at,
})

export const useAtlasAiStore = create<AtlasAiState & AtlasAiActions>((set, get) => {
  const applyThreadState = (threadId: string, messages: ChatEntry[], pending?: PendingAction[]) => {
    set((s) => {
      const threadMessages = { ...s.threadMessages, [threadId]: messages }
      const nextState: Partial<AtlasAiState> = { threadMessages }

      if (pending) {
        nextState.threadPending = { ...s.threadPending, [threadId]: pending }
      }

      if (s.activeThreadId === threadId) {
        nextState.messages = messages
        if (pending) nextState.pending = pending
      }

      return nextState as Partial<AtlasAiState>
    })
  }

  const bumpThreadMeta = (threadId: string, added: number, latestTimestamp?: string) => {
    set((s) => {
      const threads = s.threads
        .map((t) => {
          if (t.id !== threadId) return t
          const updated_at = latestTimestamp ?? new Date().toISOString()
          return { ...t, message_count: (t.message_count ?? 0) + added, updated_at }
        })
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())

      return { threads } as Partial<AtlasAiState>
    })
  }

  return {
    open: false,
    sending: false,
    messages: [],
    pending: [],
    error: null,
    keyStatus: null,
    keyLoading: false,
    keyWorking: false,
    panelWidth: readPanelWidth(),
    threads: [],
    activeThreadId: readActiveThreadId(),
    threadMessages: {},
    threadPending: {},
    loadingThreads: false,
    loadingMessages: false,
    sessionKey: null,
    sessionKeyExpiry: null,
    sessionKeyTimer: null,
    provider: 'openai',
    model: '',
    baseUrl: '',
    sessionProvider: null,
    sessionModel: null,
    sessionBaseUrl: null,
    threadRenameLoading: false,

    toggle() {
      set((s) => ({ open: !s.open }))
    },

    openPanel() {
      set({ open: true })
    },

    closePanel() {
      set({ open: false })
    },

    async loadThreads() {
      set({ loadingThreads: true })
      try {
        const threads = await atlasAiApi.listThreads()
        set((s) => {
          let active = s.activeThreadId
          if (active && !threads.some((t) => t.id === active)) {
            active = threads[0]?.id ?? null
          }
          if (!active && threads.length) {
            active = threads[0].id
          }
          if (active !== s.activeThreadId) {
            persistActiveThreadId(active)
          }
          return {
            threads,
            activeThreadId: active,
            loadingThreads: false,
          }
        })

        const activeId = get().activeThreadId
        if (activeId && !get().threadMessages[activeId]) {
          await get().selectThread(activeId)
        }
      } catch (err: unknown) {
        set({ loadingThreads: false, error: getErrorMessage(err, 'Failed to load threads') })
      }
    },

    async selectThread(threadId) {
      const cached = get().threadMessages[threadId]
      set((s) => ({
        activeThreadId: threadId,
        messages: cached ?? [],
        pending: s.threadPending[threadId] ?? [],
        loadingMessages: !cached,
        error: null,
      }))
      persistActiveThreadId(threadId)

      if (cached) {
        set({ loadingMessages: false })
        return
      }

      try {
        const stored = await atlasAiApi.listMessages(threadId)
        const msgs = stored.map(mapStoredToChat)
        applyThreadState(threadId, msgs, get().threadPending[threadId] ?? [])
        set({ loadingMessages: false })
      } catch (err: unknown) {
        set({ loadingMessages: false, error: getErrorMessage(err, 'Failed to load conversation') })
      }
    },

    async startThread(title) {
      try {
        const thread = await atlasAiApi.createThread(title)
        set((s) => {
          const threads = [thread, ...s.threads.filter((t) => t.id !== thread.id)]
          persistActiveThreadId(thread.id)
          return {
            threads,
            activeThreadId: thread.id,
            messages: [],
            pending: [],
            threadMessages: { ...s.threadMessages, [thread.id]: [] },
            threadPending: { ...s.threadPending, [thread.id]: [] },
            loadingMessages: false,
            error: null,
          }
        })
        return thread.id
      } catch (err: unknown) {
        set({ error: getErrorMessage(err, 'Failed to start a new thread') })
        return null
      }
    },

    async deleteThread(threadId) {
      set({ error: null })
      try {
        await atlasAiApi.deleteThread(threadId)
        let nextActive: string | null = null
        set((s) => {
          const threads = s.threads.filter((t) => t.id !== threadId)
          const threadMessages = { ...s.threadMessages }
          const threadPending = { ...s.threadPending }
          delete threadMessages[threadId]
          delete threadPending[threadId]

          nextActive = s.activeThreadId === threadId ? threads[0]?.id ?? null : s.activeThreadId
          if (nextActive !== s.activeThreadId) persistActiveThreadId(nextActive)

          return {
            threads,
            threadMessages,
            threadPending,
            activeThreadId: nextActive,
            messages: nextActive ? threadMessages[nextActive] ?? [] : [],
            pending: nextActive ? threadPending[nextActive] ?? [] : [],
          }
        })

        if (nextActive && !get().threadMessages[nextActive]) {
          await get().selectThread(nextActive)
        }
      } catch (err: unknown) {
        set({ error: getErrorMessage(err, 'Failed to delete thread') })
      }
    },

    async renameThread(threadId, title) {
      const trimmed = title.trim()
      if (!trimmed) {
        set({ error: 'Thread title cannot be empty.' })
        return
      }
      set({ threadRenameLoading: true, error: null })
      try {
        const updated = await atlasAiApi.renameThread(threadId, trimmed)
        set((s) => {
          const threads = s.threads
            .map((t) => (t.id === threadId ? { ...t, title: updated.title, updated_at: updated.updated_at } : t))
            .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())

          return {
            threads,
            threadRenameLoading: false,
          }
        })
      } catch (err: unknown) {
        set({ threadRenameLoading: false, error: getErrorMessage(err, 'Failed to rename thread') })
      }
    },

    async send(content, page, ctx) {
      const trimmed = content.trim()
      if (!trimmed) return
      if (!env.atlasAiEnabled) {
        set({ error: 'ATLAS-AI is disabled' })
        return
      }

      const contextData = ctx ?? {}
      const snapshot = get()
      const runtimeKey = snapshot.sessionKey
      const runtimeProvider = snapshot.sessionProvider ?? snapshot.provider
      const runtimeModel = snapshot.sessionModel ?? snapshot.model
      const runtimeBaseUrl = snapshot.sessionBaseUrl ?? snapshot.baseUrl

      if (!runtimeKey) {
        set({ error: 'Unlock ATLAS-AI to continue.' })
        return
      }

      if (runtimeProvider === 'local' && !runtimeBaseUrl) {
        set({ error: 'Provide a local model URL before chatting.' })
        return
      }

      set({ sending: true, error: null })

      let threadId = snapshot.activeThreadId
      if (!threadId) {
        threadId = await get().startThread(trimmed.slice(0, 80))
        if (!threadId) {
          set({ sending: false })
          return
        }
      }

      const existing = get().threadMessages[threadId] ?? get().messages
      const userContent = truncateMessage(trimmed, MAX_COMMANDER_MESSAGE_CHARS)
      const userMsg: ChatEntry = { id: `m-${++idCounter}`, role: 'user', content: userContent, created_at: new Date().toISOString() }
      let workingMessages = [...existing, userMsg]
      applyThreadState(threadId, workingMessages)

      try {
        const savedUser = await atlasAiApi.appendMessages(threadId, [{ role: 'user', content: userContent }])
        const base = workingMessages.slice(0, workingMessages.length - savedUser.length)
        workingMessages = [...base, ...savedUser.map(mapStoredToChat)]
        applyThreadState(threadId, workingMessages)
        bumpThreadMeta(threadId, savedUser.length, savedUser[savedUser.length - 1]?.created_at)
      } catch (err: unknown) {
        applyThreadState(threadId, existing)
        set({ sending: false, error: getErrorMessage(err, 'Failed to store message') })
        return
      }

      try {
        const commanderHistory: CommanderMessage[] = []

        const contextParts: string[] = []
        if (page) contextParts.push(`Current page: ${page}`)
        const focusAgent = contextData && typeof contextData === 'object' ? (contextData as Record<string, unknown>).agentId : null
        if (typeof focusAgent === 'string' && focusAgent.length > 0) {
          contextParts.push(`Focused agent ID: ${focusAgent}`)
        }
        if (page && page.includes('logs')) {
          contextParts.push('When answering log questions, query relevant severities (Info, Warning, Error, Critical) for the focused agent and report counts found.')
          contextParts.push('Log severity names are case-sensitive: use Trace, Debug, Info, Warning, Error, Critical.')
        }
        if (contextData && Object.keys(contextData).length > 0) {
          const serialized = JSON.stringify(contextData)
          contextParts.push(`UI context: ${serialized.slice(0, 1600)}`)
        }
        if (contextParts.length > 0) {
          const contextMessage = truncateMessage(contextParts.join('. '), MAX_COMMANDER_MESSAGE_CHARS)
          commanderHistory.push({ role: 'system', content: contextMessage })
        }

        const recentMessages = workingMessages.slice(-MAX_HISTORY_MESSAGES)
        commanderHistory.push(
          ...recentMessages.map((msg) => ({
            role: msg.role,
            content: truncateMessage(msg.content, MAX_COMMANDER_MESSAGE_CHARS),
          })),
        )

        const liveState = get()
        const sessionKey = liveState.sessionKey ?? runtimeKey
        if (!sessionKey) {
          throw new Error('ATLAS-AI session expired. Unlock to continue.')
        }
        const providerNow = liveState.sessionProvider ?? liveState.provider ?? runtimeProvider
        const modelNow = liveState.sessionModel ?? liveState.model ?? runtimeModel
        const baseUrlNow = liveState.sessionBaseUrl ?? liveState.baseUrl ?? runtimeBaseUrl

        if (providerNow === 'local' && !baseUrlNow) {
          throw new Error('Local model URL missing. Provide a base URL in settings.')
        }

        const res = await askCommander({
          messages: commanderHistory,
          apiKey: sessionKey,
          provider: providerNow,
          model: modelNow || undefined,
          baseUrl: providerNow === 'local' ? baseUrlNow : undefined,
          question: trimmed,
        })
        const assistantContentRaw = [...res.transcript].reverse().find((m) => m.role === 'assistant')?.content || 'No response.'
        const assistantContent = truncateMessage(assistantContentRaw, MAX_COMMANDER_MESSAGE_CHARS)

        const assistantMsg: ChatEntry = {
          id: `m-${++idCounter}`,
          role: 'assistant',
          content: assistantContent,
          created_at: new Date().toISOString(),
        }

        workingMessages = [...workingMessages, assistantMsg]
        applyThreadState(threadId, workingMessages, [])

        try {
          const savedAssistantContent = truncateMessage(assistantContentRaw, MAX_SAVED_ASSISTANT_CHARS)
          const savedAssistant = await atlasAiApi.appendMessages(threadId, [{ role: 'assistant', content: savedAssistantContent }])
          const base = workingMessages.slice(0, workingMessages.length - savedAssistant.length)
          workingMessages = [...base, ...savedAssistant.map(mapStoredToChat)]
          applyThreadState(threadId, workingMessages, [])
          bumpThreadMeta(threadId, savedAssistant.length, savedAssistant[savedAssistant.length - 1]?.created_at)
        } catch (err: unknown) {
          set({ error: getErrorMessage(err, 'Failed to store reply') })
        }
      } catch (err: unknown) {
        const failureMsg: ChatEntry = {
          id: `m-${++idCounter}`,
          role: 'assistant',
          content: 'ATLAS-AI failed to respond.',
        }
        workingMessages = [...workingMessages, failureMsg]
        applyThreadState(threadId, workingMessages)
        set({ error: getErrorMessage(err, 'ATLAS-AI error') })
      } finally {
        set({ sending: false })
      }
    },

    async confirm(action) {
      set({ sending: true, error: null })
      const threadId = get().activeThreadId
      try {
        const res = await atlasAiApi.confirm(action)
        const msg: ChatEntry = {
          id: `m-${++idCounter}`,
          role: 'assistant',
          content: `Action ${action.name} executed. Result: ${JSON.stringify(res.result).slice(0, 1800)}`,
          created_at: new Date().toISOString(),
        }

        const history = threadId ? get().threadMessages[threadId] ?? [] : get().messages
        const updated = [...history, msg]
        if (threadId) {
          const remaining = (get().threadPending[threadId] ?? []).filter((p) => p.name !== action.name)
          applyThreadState(threadId, updated, remaining)
          bumpThreadMeta(threadId, 1, msg.created_at)
          try {
            await atlasAiApi.appendMessages(threadId, [{ role: 'assistant', content: msg.content }])
          } catch (err: unknown) {
            set({ error: getErrorMessage(err, 'Failed to store confirmation') })
          }
        } else {
          set({ messages: updated, pending: [] })
        }
      } catch (err: unknown) {
        set({ error: getErrorMessage(err, 'Action failed') })
      } finally {
        set({ sending: false })
      }
    },

    async reset() {
      const created = await get().startThread()
      if (!created) {
        set({ messages: [], pending: [], error: null })
      }
    },

    async refreshKeyStatus() {
      set({ keyLoading: true })
      try {
        const status = await atlasAiApi.keyStatus()
        set((state) => {
          let timer = state.sessionKeyTimer
          if (!status.unlocked && timer) {
            clearTimeout(timer)
            timer = null
          }
          const next: Partial<AtlasAiState> = {
            keyStatus: status,
            keyLoading: false,
            sessionKey: status.unlocked ? state.sessionKey : null,
            sessionKeyExpiry: status.unlocked ? state.sessionKeyExpiry : null,
            sessionKeyTimer: status.unlocked ? timer : null,
          }
          if (!status.unlocked) {
            next.sessionProvider = null
            next.sessionModel = null
            next.sessionBaseUrl = null
          }
          if (status.provider) next.provider = status.provider
          if (typeof status.model === 'string') next.model = status.model
          if (typeof status.base_url === 'string') next.baseUrl = status.base_url
          return next as Partial<AtlasAiState>
        })
      } catch (err: unknown) {
        set({ keyLoading: false, error: getErrorMessage(err, 'Key status error') })
      }
    },

    async storeKey(provider, apiKey, passphrase, options) {
      const normalizedModel = options?.model?.trim() ?? ''
      const normalizedBaseUrl = options?.baseUrl?.trim() ?? ''
      set({ keyWorking: true, error: null, provider, model: normalizedModel, baseUrl: normalizedBaseUrl })
      try {
        await atlasAiApi.storeKey(provider, apiKey, passphrase, { model: normalizedModel || undefined, baseUrl: normalizedBaseUrl || undefined })
        await get().refreshKeyStatus()
      } catch (err: unknown) {
        set({ error: getErrorMessage(err, 'Failed to store key') })
      } finally {
        set({ keyWorking: false })
      }
    },

    async unlockKey(passphrase) {
      set({ keyWorking: true, error: null })
      try {
        const res = await atlasAiApi.unlockKey(passphrase)
        const unlockExpiresAt = res.key_status.unlock_expires_at
        const expiryMs = unlockExpiresAt ? new Date(unlockExpiresAt).getTime() : null
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null
        if (expiryMs) {
          const delay = Math.max(0, expiryMs - Date.now())
          timeoutHandle = setTimeout(() => {
            set((state) => ({
              sessionKey: null,
              sessionKeyExpiry: null,
              sessionKeyTimer: null,
              sessionProvider: null,
              sessionModel: null,
              sessionBaseUrl: null,
              keyStatus: state.keyStatus
                ? { ...state.keyStatus, unlocked: false, unlock_expires_at: null }
                : state.keyStatus,
            }))
            void get().refreshKeyStatus()
          }, delay)
        }

        set((s) => {
          if (s.sessionKeyTimer) clearTimeout(s.sessionKeyTimer)
          return {
            keyWorking: false,
            keyStatus: res.key_status,
            sessionKey: res.apiKey,
            sessionKeyExpiry: expiryMs,
            sessionKeyTimer: timeoutHandle,
            sessionProvider: res.provider,
            sessionModel: res.model ?? (res.key_status.model ?? s.model),
            sessionBaseUrl: res.baseUrl ?? (res.key_status.base_url ?? s.baseUrl),
            provider: res.key_status.provider ?? res.provider ?? s.provider,
            model: res.key_status.model ?? res.model ?? s.model,
            baseUrl: res.key_status.base_url ?? res.baseUrl ?? s.baseUrl,
          }
        })
      } catch (err: unknown) {
        set({ keyWorking: false, error: getErrorMessage(err, 'Unlock failed') })
      }
    },

    async lockKey() {
      set({ keyWorking: true, error: null })
      try {
        const res = await atlasAiApi.lockKey()
        set((s) => {
          if (s.sessionKeyTimer) clearTimeout(s.sessionKeyTimer)
          return {
            keyWorking: false,
            keyStatus: res.key_status,
            sessionKey: null,
            sessionKeyExpiry: null,
            sessionKeyTimer: null,
            sessionProvider: null,
            sessionModel: null,
            sessionBaseUrl: null,
          }
        })
      } catch (err: unknown) {
        set({ keyWorking: false, error: getErrorMessage(err, 'Lock failed') })
      }
    },

    setPanelWidth(w) {
      const clamped = Math.min(640, Math.max(320, Math.round(w)))
      set({ panelWidth: clamped })
      try {
        localStorage.setItem(PANEL_WIDTH_KEY, String(clamped))
      } catch {
        /* ignore */
      }
    },

    setProvider(provider) {
      set({ provider })
    },

    setModel(model) {
      set({ model })
    },

    setBaseUrl(url) {
      set({ baseUrl: url })
    },
  }
})
