import { env } from '@/config/env'
import type { WsChannel, WsEnvelope } from '@/types'

export type WsListener<T = unknown> = (data: T) => void

interface Subscription {
  channel: WsChannel
  agentId: string
  listeners: Set<WsListener>
}

type WsEventMap = {
  connected: void
  disconnected: { code: number; reason: string }
  error: Event
  'session-expired': void
}

type WsEventListener<K extends keyof WsEventMap> = (data: WsEventMap[K]) => void

class BeaconWebSocketClient {
  private ws: WebSocket | null = null
  private token: string = ''
  private subscriptions = new Map<string, Subscription>()
  private reconnectDelay = 1000
  private readonly maxDelay = 30_000
  private destroyed = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private eventListeners = new Map<string, Set<WsEventListener<keyof WsEventMap>>>()

  connect(token: string): void {
    this.token = token
    this.destroyed = false
    this._connect()
  }

  private _connect(): void {
    if (this.destroyed) return

    const url = `${env.wsUrl}?token=${encodeURIComponent(this.token)}`
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      this.reconnectDelay = 1000
      this._emit('connected', undefined)
      // Re-subscribe all active subscriptions
      for (const sub of this.subscriptions.values()) {
        this._send({ action: 'subscribe', channel: sub.channel, agent_id: sub.agentId })
      }
    }

    this.ws.onclose = (event) => {
      this._emit('disconnected', { code: event.code, reason: event.reason })

      if (event.code === 4001) {
        this._emit('session-expired', undefined)
        return
      }

      if (!this.destroyed) {
        this.reconnectTimer = setTimeout(() => {
          this._connect()
        }, this.reconnectDelay)
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxDelay)
      }
    }

    this.ws.onerror = (event) => {
      this._emit('error', event)
    }

    this.ws.onmessage = (event: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(event.data) as WsEnvelope
        if (msg.channel) {
          this._dispatch(msg.channel, msg.data)
        }
      } catch {
        // Malformed message — ignore
      }
    }
  }

  /**
   * Subscribe to a channel for a specific agent.
   * Returns an unsubscribe function.
   */
  subscribe<T>(channel: WsChannel, agentId: string, listener: WsListener<T>): () => void {
    const key = `${channel}::${agentId}`

    if (!this.subscriptions.has(key)) {
      this.subscriptions.set(key, { channel, agentId, listeners: new Set() })
      if (this.ws?.readyState === WebSocket.OPEN) {
        this._send({ action: 'subscribe', channel, agent_id: agentId })
      }
    }

    this.subscriptions.get(key)!.listeners.add(listener as WsListener)
    return () => this.unsubscribe(channel, agentId, listener as WsListener)
  }

  unsubscribe(channel: WsChannel, agentId: string, listener: WsListener): void {
    const key = `${channel}::${agentId}`
    const sub = this.subscriptions.get(key)
    if (!sub) return

    sub.listeners.delete(listener)

    if (sub.listeners.size === 0) {
      this.subscriptions.delete(key)
      if (this.ws?.readyState === WebSocket.OPEN) {
        this._send({ action: 'unsubscribe', channel, agent_id: agentId })
      }
    }
  }

  /** Update the token (call after silent refresh) */
  updateToken(token: string): void {
    this.token = token
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  on<K extends keyof WsEventMap>(event: K, listener: WsEventListener<K>): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set())
    }
    this.eventListeners.get(event)!.add(listener as WsEventListener<keyof WsEventMap>)
    return () => {
      this.eventListeners.get(event)?.delete(listener as WsEventListener<keyof WsEventMap>)
    }
  }

  destroy(): void {
    this.destroyed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
    this.subscriptions.clear()
    this.eventListeners.clear()
  }

  private _send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  private _dispatch(channel: string, data: unknown): void {
    for (const [key, sub] of this.subscriptions) {
      if (key.startsWith(`${channel}::`)) {
        sub.listeners.forEach((fn) => {
          try {
            fn(data)
          } catch {
            // Listener error — don't kill other listeners
          }
        })
      }
    }
  }

  private _emit<K extends keyof WsEventMap>(event: K, data: WsEventMap[K]): void {
    this.eventListeners.get(event)?.forEach((fn) => {
      try {
        ;(fn as WsEventListener<K>)(data)
      } catch {
        // ignore
      }
    })
  }
}

// Singleton — one WS connection for the entire app
export const wsClient = new BeaconWebSocketClient()
