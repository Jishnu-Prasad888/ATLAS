import { create } from 'zustand'

export interface Notification {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  message?: string
  duration?: number
}

export type Theme = 'dark' | 'light'

interface UiState {
  sidebarCollapsed: boolean
  selectedAgentId: string | null
  wsConnected: boolean
  notifications: Notification[]
  theme: Theme
}

interface UiActions {
  toggleSidebar: () => void
  setSidebarCollapsed: (v: boolean) => void
  selectAgent: (id: string | null) => void
  setWsConnected: (v: boolean) => void
  addNotification: (n: Omit<Notification, 'id'>) => void
  removeNotification: (id: string) => void
  setTheme: (t: Theme) => void
}

let notifCounter = 0

function loadUi<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem('beacon_ui_' + key)
    return raw !== null ? JSON.parse(raw) : fallback
  } catch { return fallback }
}

function saveUi(key: string, value: unknown) {
  try { localStorage.setItem('beacon_ui_' + key, JSON.stringify(value)) } catch { /* quota */ }
}

function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', t === 'light' ? '#f4f5f7' : '#0b0d0f')
}

const initialTheme = loadUi<Theme>('theme', 'dark')
applyTheme(initialTheme)

export const useUiStore = create<UiState & UiActions>((set, get) => ({
  sidebarCollapsed: loadUi('sidebar', false),
  selectedAgentId: loadUi('selected_agent', null),
  wsConnected: false,
  notifications: [],
  theme: initialTheme,

  toggleSidebar() {
    set((s) => {
      const v = !s.sidebarCollapsed
      saveUi('sidebar', v)
      return { sidebarCollapsed: v }
    })
  },

  setSidebarCollapsed(v) {
    saveUi('sidebar', v)
    set({ sidebarCollapsed: v })
  },

  selectAgent(id) {
    saveUi('selected_agent', id)
    set({ selectedAgentId: id })
  },

  setWsConnected(v) {
    set({ wsConnected: v })
  },

  addNotification(n) {
    const id = `notif-${++notifCounter}`
    const notification: Notification = { ...n, id }
    set((s) => ({ notifications: [...s.notifications, notification] }))

    const duration = n.duration ?? 5000
    if (duration > 0) {
      setTimeout(() => {
        get().removeNotification(id)
      }, duration)
    }
  },

  removeNotification(id) {
    set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) }))
  },

  setTheme(t) {
    saveUi('theme', t)
    applyTheme(t)
    set({ theme: t })
  },
}))
