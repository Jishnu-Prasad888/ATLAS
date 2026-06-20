import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { Appearance } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { ThemeMode, ThemePalette, getPalette } from './palette'

type ModeSetting = ThemeMode | 'system'

interface ThemeContextValue {
  mode: ModeSetting
  setMode: (m: ModeSetting) => void
  resolvedMode: ThemeMode
  palette: ThemePalette
  loaded: boolean
}

const ThemeContext = createContext<ThemeContextValue | null>(null)
const THEME_KEY = 'beacon_theme_mode'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ModeSetting>('system')
  const [loaded, setLoaded] = useState(false)
  const [systemMode, setSystemMode] = useState<ThemeMode>(Appearance.getColorScheme() === 'light' ? 'light' : 'dark')

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemMode(colorScheme === 'light' ? 'light' : 'dark')
    })
    ;(async () => {
      try {
        const stored = await SecureStore.getItemAsync(THEME_KEY)
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setModeState(stored)
        }
      } catch {
        // ignore
      } finally {
        setLoaded(true)
      }
    })()

    return () => sub.remove()
  }, [])

  const resolvedMode: ThemeMode = mode === 'system' ? systemMode : mode
  const palette = useMemo(() => getPalette(resolvedMode), [resolvedMode])

  const setMode = (m: ModeSetting) => {
    setModeState(m)
    SecureStore.setItemAsync(THEME_KEY, m).catch(() => {})
  }

  const value = useMemo<ThemeContextValue>(() => ({ mode, setMode, resolvedMode, palette, loaded }), [mode, resolvedMode, palette, loaded])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
