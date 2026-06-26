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
  bg: '#eef6ff',
  surface: '#ffffff',
  surface2: '#dbeafe',
  border: '#2563eb',
  text: '#061225',
  textDim: '#172554',
  textMuted: '#1e40af',
  primary: '#2563eb',
  success: '#16a34a',
  warning: '#d97706',
  danger: '#dc2626',
  cardShadow: 'rgba(37,99,235,0.18)',
  inputBg: '#f8fbff',
  inputBorder: '#1d4ed8',
  chipBg: '#bfdbfe',
  chipText: '#172554',
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
