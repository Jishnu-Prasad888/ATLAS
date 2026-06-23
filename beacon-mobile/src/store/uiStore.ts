import { create } from 'zustand'

export type NotificationType = 'success' | 'error' | 'warning' | 'info'

export interface Notification {
  id: string
  type: NotificationType
  title: string
  message?: string
  duration?: number
}

interface UiState {
  notifications: Notification[]
  selectedAgentId: string | null
  wsConnected: boolean
}

interface UiActions {
  addNotification: (n: Omit<Notification, 'id'>) => void
  removeNotification: (id: string) => void
  selectAgent: (agentId: string | null) => void
  setWsConnected: (connected: boolean) => void
}

let notifCounter = 0

export const useUiStore = create<UiState & UiActions>((set, get) => ({
  notifications: [],
  selectedAgentId: null,
  wsConnected: false,

  addNotification(notification) {
    const id = `notif-${++notifCounter}`
    const entry: Notification = { id, ...notification }
    set((state) => ({ notifications: [...state.notifications, entry] }))

    const duration = notification.duration ?? 4000
    if (duration > 0) {
      setTimeout(() => {
        get().removeNotification(id)
      }, duration)
    }
  },

  removeNotification(id) {
    set((state) => ({ notifications: state.notifications.filter((n) => n.id !== id) }))
  },

  selectAgent(agentId) {
    set({ selectedAgentId: agentId })
  },

  setWsConnected(connected) {
    set({ wsConnected: connected })
  },
}))
