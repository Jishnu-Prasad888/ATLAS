import { create } from 'zustand'
import * as SecureStore from 'expo-secure-store'
import { AppSettings, DEFAULT_SETTINGS } from '@/types'

const SETTINGS_KEY = 'beacon_settings'

interface SettingsState {
  settings: AppSettings
  loaded: boolean
  load: () => Promise<void>
  save: (s: Partial<AppSettings>) => Promise<void>
  reset: () => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  load: async () => {
    try {
      const raw = await SecureStore.getItemAsync(SETTINGS_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<AppSettings>
        set({ settings: { ...DEFAULT_SETTINGS, ...parsed }, loaded: true })
      } else {
        set({ loaded: true })
      }
    } catch {
      set({ loaded: true })
    }
  },

  save: async (partial) => {
    const next = { ...get().settings, ...partial }
    set({ settings: next })
    await SecureStore.setItemAsync(SETTINGS_KEY, JSON.stringify(next))
  },

  reset: async () => {
    set({ settings: DEFAULT_SETTINGS })
    await SecureStore.deleteItemAsync(SETTINGS_KEY)
  },
}))
