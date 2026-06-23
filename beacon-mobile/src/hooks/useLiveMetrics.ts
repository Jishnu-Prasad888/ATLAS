import { useEffect, useState, useCallback, useMemo } from 'react'
import { telemetryApi } from '@/api/endpoints'
import { Metric } from '@/types'
import { useBeaconWs } from '@/ws/useBeaconWs'

const HISTORY_SIZE = 60

export interface LiveMetricHistory {
  cpu: number[]
  ram: number[]
  netRx: number[]
  netTx: number[]
  gpu: number[]
  timestamps: string[]
}

export interface LiveMetricsState {
  latest: Record<string, Metric>
  history: LiveMetricHistory
}

const emptyHistory = (): LiveMetricHistory => ({
  cpu: [],
  ram: [],
  netRx: [],
  netTx: [],
  gpu: [],
  timestamps: [],
})

export function useLiveMetrics(agentId: string | null): LiveMetricsState {
  const [latest, setLatest] = useState<Record<string, Metric>>({})
  const [history, setHistory] = useState<LiveMetricHistory>(() => emptyHistory())

  const appendNumber = useCallback((arr: number[], value: number) => {
    return [...arr, value].slice(-HISTORY_SIZE)
  }, [])

  const appendString = useCallback((arr: string[], value: string) => {
    return [...arr, value].slice(-HISTORY_SIZE)
  }, [])

  const resetState = useCallback(() => {
    setLatest({})
    setHistory(emptyHistory())
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!agentId) {
      resetState()
      return
    }

    ;(async () => {
      try {
        const response = await telemetryApi.latest(agentId)
        if (!cancelled) {
          setLatest(response.data ?? {})
        }
      } catch {
        if (!cancelled) {
          setLatest({})
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [agentId, resetState])

  const onMessage = useCallback((message: unknown) => {
    const metric = message as Metric
    if (!metric || typeof metric.metric_type !== 'string') return

    setLatest((prev) => ({ ...prev, [metric.metric_type]: metric }))
    setHistory((prev) => {
      const next: LiveMetricHistory = { ...prev }
      const ts = new Date(metric.timestamp).toISOString()
      next.timestamps = appendString(prev.timestamps, ts)

      if (metric.metric_type === 'cpu') {
        const payload = metric.data as { usage_pct?: number }
        next.cpu = appendNumber(prev.cpu, Number(payload?.usage_pct ?? 0))
      } else if (metric.metric_type === 'ram') {
        const payload = metric.data as { usage_pct?: number }
        next.ram = appendNumber(prev.ram, Number(payload?.usage_pct ?? 0))
      } else if (metric.metric_type === 'network') {
        const payload = metric.data as { interfaces?: Array<{ name?: string; rx_bytes_rate?: number; tx_bytes_rate?: number }> }
        const iface = payload.interfaces?.find((i) => i.name && i.name !== 'lo') ?? payload.interfaces?.[0]
        next.netRx = appendNumber(prev.netRx, Number(iface?.rx_bytes_rate ?? 0))
        next.netTx = appendNumber(prev.netTx, Number(iface?.tx_bytes_rate ?? 0))
      } else if (metric.metric_type === 'gpu') {
        const payload = metric.data as { summary?: { avg_utilization_pct?: number } }
        next.gpu = appendNumber(prev.gpu, Number(payload.summary?.avg_utilization_pct ?? 0))
      }
      return next
    })
  }, [appendNumber, appendString])

  const wsEnabled = Boolean(agentId)
  useBeaconWs({ channel: 'metrics', agentId: agentId ?? undefined, onMessage, enabled: wsEnabled })

  return useMemo(() => ({ latest, history }), [latest, history])
}
