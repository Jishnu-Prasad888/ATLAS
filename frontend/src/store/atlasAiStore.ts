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
import { env } from '@/config/env'

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
}

interface AtlasAiActions {
  toggle: () => void
  openPanel: () => void
  closePanel: () => void
  loadThreads: () => Promise<void>
  selectThread: (threadId: string) => Promise<void>
  startThread: (title?: string) => Promise<string | null>
  deleteThread: (threadId: string) => Promise<void>
  send: (content: string, page?: string, context?: Record<string, unknown>) => Promise<void>
  confirm: (action: PendingAction) => Promise<void>
  reset: () => Promise<void>
  refreshKeyStatus: () => Promise<void>
  storeKey: (provider: ProviderOption, apiKey: string, passphrase: string) => Promise<void>
  unlockKey: (passphrase: string) => Promise<void>
  lockKey: () => Promise<void>
  setPanelWidth: (w: number) => void
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
      } catch (err: any) {
        set({ loadingThreads: false, error: err?.message ?? 'Failed to load threads' })
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
      } catch (err: any) {
        set({ loadingMessages: false, error: err?.message ?? 'Failed to load conversation' })
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
      } catch (err: any) {
        set({ error: err?.message ?? 'Failed to start a new thread' })
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
      } catch (err: any) {
        set({ error: err?.message ?? 'Failed to delete thread' })
      }
    },

    async send(content, page, context) {
      const trimmed = content.trim()
      if (!trimmed) return
      if (!env.atlasAiEnabled) {
        set({ error: 'ATLAS-AI is disabled' })
        return
      }

      set({ sending: true, error: null })

      let threadId = get().activeThreadId
      if (!threadId) {
        threadId = await get().startThread(trimmed.slice(0, 80))
        if (!threadId) {
          set({ sending: false })
          return
        }
      }

      const existing = get().threadMessages[threadId] ?? get().messages
      const userMsg: ChatEntry = { id: `m-${++idCounter}`, role: 'user', content: trimmed, created_at: new Date().toISOString() }
      let workingMessages = [...existing, userMsg]
      applyThreadState(threadId, workingMessages)

      try {
        const savedUser = await atlasAiApi.appendMessages(threadId, [{ role: 'user', content: trimmed }])
        const base = workingMessages.slice(0, workingMessages.length - savedUser.length)
        workingMessages = [...base, ...savedUser.map(mapStoredToChat)]
        applyThreadState(threadId, workingMessages)
        bumpThreadMeta(threadId, savedUser.length, savedUser[savedUser.length - 1]?.created_at)
      } catch (err: any) {
        applyThreadState(threadId, existing)
        set({ sending: false, error: err?.message ?? 'Failed to store message' })
        return
      }

      try {
        const payloadMessages: AtlasAiMessage[] = workingMessages.map((m) => ({ role: m.role, content: m.content }))
        const res = await atlasAiApi.chat({ messages: payloadMessages, page, context })
        const assistantMsg: ChatEntry = {
          id: `m-${++idCounter}`,
          role: 'assistant',
          content: res.message,
          created_at: new Date().toISOString(),
        }

        workingMessages = [...workingMessages, assistantMsg]
        applyThreadState(threadId, workingMessages, res.pending_actions)

        try {
          const savedAssistant = await atlasAiApi.appendMessages(threadId, [{ role: 'assistant', content: res.message }])
          const base = workingMessages.slice(0, workingMessages.length - savedAssistant.length)
          workingMessages = [...base, ...savedAssistant.map(mapStoredToChat)]
          applyThreadState(threadId, workingMessages, res.pending_actions)
          bumpThreadMeta(threadId, savedAssistant.length, savedAssistant[savedAssistant.length - 1]?.created_at)
        } catch (err: any) {
          set({ error: err?.message ?? 'Failed to store reply' })
        }
      } catch (err: any) {
        const failureMsg: ChatEntry = {
          id: `m-${++idCounter}`,
          role: 'assistant',
          content: 'ATLAS-AI failed to respond.',
        }
        workingMessages = [...workingMessages, failureMsg]
        applyThreadState(threadId, workingMessages)
        set({ error: err?.message ?? 'ATLAS-AI error' })
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
          } catch (err: any) {
            set({ error: err?.message ?? 'Failed to store confirmation' })
          }
        } else {
          set({ messages: updated, pending: [] })
        }
      } catch (err: any) {
        set({ error: err?.message ?? 'Action failed' })
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
        set({ keyStatus: status, keyLoading: false })
      } catch (err: any) {
        set({ keyLoading: false, error: err?.message ?? 'Key status error' })
      }
    },

    async storeKey(provider, apiKey, passphrase) {
      set({ keyWorking: true, error: null })
      try {
        await atlasAiApi.storeKey(provider, apiKey, passphrase)
        await get().refreshKeyStatus()
      } catch (err: any) {
        set({ error: err?.message ?? 'Failed to store key' })
      } finally {
        set({ keyWorking: false })
      }
    },

    async unlockKey(passphrase) {
      set({ keyWorking: true, error: null })
      try {
        await atlasAiApi.unlockKey(passphrase)
        await get().refreshKeyStatus()
      } catch (err: any) {
        set({ error: err?.message ?? 'Unlock failed' })
      } finally {
        set({ keyWorking: false })
      }
    },

    async lockKey() {
      set({ keyWorking: true, error: null })
      try {
        await atlasAiApi.lockKey()
        await get().refreshKeyStatus()
      } catch (err: any) {
        set({ error: err?.message ?? 'Lock failed' })
      } finally {
        set({ keyWorking: false })
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
  }
})
