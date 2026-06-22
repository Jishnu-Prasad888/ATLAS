import { create } from 'zustand'
import { atlasAiApi, type AtlasAiMessage, type PendingAction, type KeyStatus, type ProviderOption } from '@/api'
import { env } from '@/config/env'

export type ChatRole = AtlasAiMessage['role']

export interface ChatEntry {
  id: string
  role: ChatRole
  content: string
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
}

interface AtlasAiActions {
  toggle: () => void
  openPanel: () => void
  closePanel: () => void
  send: (content: string, page?: string, context?: Record<string, unknown>) => Promise<void>
  confirm: (action: PendingAction) => Promise<void>
  reset: () => void
  refreshKeyStatus: () => Promise<void>
  storeKey: (provider: ProviderOption, apiKey: string, passphrase: string) => Promise<void>
  unlockKey: (passphrase: string) => Promise<void>
  lockKey: () => Promise<void>
  setPanelWidth: (w: number) => void
}

let idCounter = 0

export const useAtlasAiStore = create<AtlasAiState & AtlasAiActions>((set, get) => ({
  open: false,
  sending: false,
  messages: [],
  pending: [],
  error: null,
  keyStatus: null,
  keyLoading: false,
  keyWorking: false,
  panelWidth: (() => {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('atlas_ai_panel_width') : null
    const n = stored ? Number(stored) : 420
    return Number.isFinite(n) ? n : 420
  })(),

  toggle() {
    set((s) => ({ open: !s.open }))
  },

  openPanel() {
    set({ open: true })
  },

  closePanel() {
    set({ open: false })
  },

  async send(content, page, context) {
    if (!content.trim()) return
    if (!env.atlasAiEnabled) {
      set({ error: 'ATLAS-AI is disabled' })
      return
    }

    const userMsg: ChatEntry = { id: `m-${++idCounter}`, role: 'user', content }
    const history = [...get().messages, userMsg]
    set({ messages: history, sending: true, error: null })

    try {
      const payloadMessages: AtlasAiMessage[] = history.map((m) => ({ role: m.role, content: m.content }))
      const res = await atlasAiApi.chat({ messages: payloadMessages, page, context })
      const assistant: ChatEntry = { id: `m-${++idCounter}`, role: 'assistant', content: res.message }
      set((s) => ({ messages: [...s.messages, assistant], pending: res.pending_actions, sending: false }))
    } catch (err: any) {
      if (err.needs_key || err.needs_unlock) {
        set({ sending: false, error: err.message, keyStatus: err.key_status ?? null })
      } else {
        set((s) => ({ sending: false, error: err?.message ?? 'ATLAS-AI error', messages: [...s.messages, { id: `m-${++idCounter}`, role: 'assistant', content: 'ATLAS-AI failed to respond.' }] }))
      }
    }
  },

  async confirm(action) {
    set({ sending: true, error: null })
    try {
      const res = await atlasAiApi.confirm(action)
      const msg: ChatEntry = {
        id: `m-${++idCounter}`,
        role: 'assistant',
        content: `Action ${action.name} executed. Result: ${JSON.stringify(res.result).slice(0, 1800)}`,
      }
      set((s) => ({
        messages: [...s.messages, msg],
        pending: s.pending.filter((p) => p.name !== action.name),
        sending: false,
      }))
    } catch (err: any) {
      set({ sending: false, error: err?.message ?? 'Action failed' })
    }
  },

  reset() {
    set({ messages: [], pending: [], error: null })
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
      localStorage.setItem('atlas_ai_panel_width', String(clamped))
    } catch {
      /* ignore */
    }
  },
}))
