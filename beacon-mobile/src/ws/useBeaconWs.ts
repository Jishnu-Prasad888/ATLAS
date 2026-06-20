import { useEffect, useRef, useCallback, useState } from 'react'
import { useSettingsStore } from '@/store/settingsStore'
import { useAuthStore } from '@/store/authStore'
import { WsChannel } from '@/types'

export type WsStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

interface UseBeaconWsOptions {
  channel: WsChannel
  agentId?: string
  onMessage: (data: unknown) => void
  enabled?: boolean
}

export function useBeaconWs({ channel, agentId, onMessage, enabled = true }: UseBeaconWsOptions) {
  const ws = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  const [status, setStatus] = useState<WsStatus>('disconnected')
  const attemptsRef = useRef(0)

  const getWsUrl = useCallback(() => {
    const { settings } = useSettingsStore.getState()
    const { accessToken } = useAuthStore.getState()
    const wsBase = settings.wsBaseUrl || 'ws://localhost:8000'
    const path = settings.wsPath || '/ws/subscribe/'
    const params = new URLSearchParams({ channel })
    if (agentId) params.set('agent_id', agentId)
    if (accessToken) params.set('token', accessToken)
    return `${wsBase}${path}?${params.toString()}`
  }, [channel, agentId])

  const connect = useCallback(() => {
    if (!enabled || !mountedRef.current) return
    if (ws.current && ws.current.readyState < 2) return

    const url = getWsUrl()
    setStatus('connecting')
    attemptsRef.current += 1

    const socket = new WebSocket(url)
    ws.current = socket

    socket.onopen = () => {
      if (!mountedRef.current) return socket.close()
      setStatus('connected')
      attemptsRef.current = 0
    }

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        onMessage(data)
      } catch {
        // ignore parse errors
      }
    }

    socket.onerror = () => {
      setStatus('error')
    }

    socket.onclose = () => {
      if (!mountedRef.current) return
      setStatus('disconnected')
      const delay = Math.min(1000 * 2 ** Math.min(attemptsRef.current, 5), 30_000)
      reconnectTimer.current = setTimeout(connect, delay)
    }
  }, [enabled, getWsUrl, onMessage])

  useEffect(() => {
    mountedRef.current = true
    if (enabled) connect()

    return () => {
      mountedRef.current = false
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      ws.current?.close()
    }
  }, [enabled, connect])

  const disconnect = useCallback(() => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    ws.current?.close()
    setStatus('disconnected')
  }, [])

  return { status, disconnect }
}
