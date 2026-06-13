import { useState, useCallback } from 'react'

const PREFIX = 'beacon_'

export function usePersistedState<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(PREFIX + key)
      return raw !== null ? (JSON.parse(raw) as T) : fallback
    } catch {
      return fallback
    }
  })

  const setPersisted = useCallback(
    (v: T) => {
      setState(v)
      try {
        localStorage.setItem(PREFIX + key, JSON.stringify(v))
      } catch { /* quota */ }
    },
    [key],
  )

  return [state, setPersisted]
}
