import { create } from 'zustand'

export interface Notification {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  message?: string
  duration?: number
}

interface UiState {
  sidebarCollapsed: boolean
  selectedAgentId: string | null
  wsConnected: boolean
  notifications: Notification[]
}

interface UiActions {
  toggleSidebar: () => void
  setSidebarCollapsed: (v: boolean) => void
  selectAgent: (id: string | null) => void
  setWsConnected: (v: boolean) => void
  addNotification: (n: Omit<Notification, 'id'>) => void
  removeNotification: (id: string) => void
}

let notifCounter = 0

export const useUiStore = create<UiState & UiActions>((set, get) => ({
  sidebarCollapsed: false,
  selectedAgentId: null,
  wsConnected: false,
  notifications: [],

  toggleSidebar() {
    set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }))
  },

  setSidebarCollapsed(v) {
    set({ sidebarCollapsed: v })
  },

  selectAgent(id) {
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
}))
