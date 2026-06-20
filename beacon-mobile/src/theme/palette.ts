export type ThemeMode = 'light' | 'dark'

export interface ThemePalette {
  mode: ThemeMode
  bg: string
  surface: string
  surface2: string
  border: string
  text: string
  textDim: string
  textMuted: string
  primary: string
  success: string
  warning: string
  danger: string
  cardShadow: string
  inputBg: string
  inputBorder: string
  chipBg: string
  chipText: string
}

export const lightPalette: ThemePalette = {
  mode: 'light',
  bg: '#f5f7fb',
  surface: '#ffffff',
  surface2: '#f2f4f8',
  border: '#e2e8f0',
  text: '#0f172a',
  textDim: '#334155',
  textMuted: '#64748b',
  primary: '#2563eb',
  success: '#16a34a',
  warning: '#d97706',
  danger: '#dc2626',
  cardShadow: 'rgba(15,23,42,0.05)',
  inputBg: '#ffffff',
  inputBorder: '#d4dbe6',
  chipBg: '#e2e8f0',
  chipText: '#334155',
}

export const darkPalette: ThemePalette = {
  mode: 'dark',
  bg: '#0b0d0f',
  surface: '#111418',
  surface2: '#181c22',
  border: '#1e252e',
  text: '#e5e7eb',
  textDim: '#cbd5e1',
  textMuted: '#6b7280',
  primary: '#3b82f6',
  success: '#22c55e',
  warning: '#eab308',
  danger: '#ef4444',
  cardShadow: 'rgba(0,0,0,0.12)',
  inputBg: '#111418',
  inputBorder: '#1e252e',
  chipBg: '#1e252e',
  chipText: '#e5e7eb',
}

export const getPalette = (mode: ThemeMode) => (mode === 'light' ? lightPalette : darkPalette)
