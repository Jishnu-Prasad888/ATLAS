import { useEffect, useRef, useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  authApi,
  agentsApi,
  telemetryApi,
  logsApi,
  auditApi,
  healthApi,
  usersApi,
  configApi,
} from '@/api'
import { wsClient } from '@/ws/client'
import { useUiStore } from '@/store/uiStore'
import { queryKeys } from './queryKeys'
import type {
  AgentListParams,
  Metric,
  LogEntry,
  LogQueryParams,
  TelemetryQueryParams,
  AuditQueryParams,
  WsChannel,
  CpuData,
  RamData,
  NetworkData,
} from '@/types'

// ─── Auth hooks ───────────────────────────────────────────────────────────────

export function useWhoami() {
  return useQuery({
    queryKey: queryKeys.whoami(),
    queryFn: authApi.whoami,
    staleTime: 5 * 60 * 1000,
  })
}

// ─── Fleet health ─────────────────────────────────────────────────────────────

export function useFleetHealth() {
  return useQuery({
    queryKey: queryKeys.fleetHealth(),
    queryFn: healthApi.fleet,
    refetchInterval: 15_000,
  })
}

export function useAgentHealth(agentId: string | null) {
  return useQuery({
    queryKey: queryKeys.agentHealth(agentId ?? ''),
    queryFn: () => healthApi.agent(agentId!),
    enabled: !!agentId,
    refetchInterval: 30_000,
  })
}

// ─── Agents ───────────────────────────────────────────────────────────────────

export function useAgents(params?: AgentListParams) {
  return useQuery({
    queryKey: queryKeys.agents(params),
    queryFn: () => agentsApi.list(params),
    refetchInterval: 30_000,
  })
}

export function useAgent(agentId: string | null) {
  return useQuery({
    queryKey: queryKeys.agent(agentId ?? ''),
    queryFn: () => agentsApi.get(agentId!),
    enabled: !!agentId,
    refetchInterval: 30_000,
  })
}

export function useAgentMutations() {
  const qc = useQueryClient()
  const addNotification = useUiStore((s) => s.addNotification)

  const invalidateAgents = () => {
    qc.invalidateQueries({ queryKey: ['agents'] })
    qc.invalidateQueries({ queryKey: ['health'] })
  }

  const enableAgent = useMutation({
    mutationFn: agentsApi.enable,
    onSuccess: () => {
      invalidateAgents()
      addNotification({ type: 'success', title: 'Agent enabled' })
    },
    onError: (e: Error) => addNotification({ type: 'error', title: 'Failed to enable agent', message: e.message }),
  })

  const disableAgent = useMutation({
    mutationFn: agentsApi.disable,
    onSuccess: () => {
      invalidateAgents()
      addNotification({ type: 'success', title: 'Agent disabled' })
    },
    onError: (e: Error) => addNotification({ type: 'error', title: 'Failed to disable agent', message: e.message }),
  })

  const deleteAgent = useMutation({
    mutationFn: agentsApi.delete,
    onSuccess: () => {
      invalidateAgents()
      addNotification({ type: 'success', title: 'Agent removed' })
    },
    onError: (e: Error) => addNotification({ type: 'error', title: 'Failed to remove agent', message: e.message }),
  })

  const renameAgent = useMutation({
    mutationFn: ({ agentId, hostname }: { agentId: string; hostname: string }) =>
      agentsApi.rename(agentId, hostname),
    onSuccess: () => {
      invalidateAgents()
      addNotification({ type: 'success', title: 'Agent renamed' })
    },
    onError: (e: Error) => addNotification({ type: 'error', title: 'Failed to rename agent', message: e.message }),
  })

  const regenerateId = useMutation({
    mutationFn: agentsApi.regenerateId,
    onSuccess: () => {
      invalidateAgents()
      addNotification({ type: 'success', title: 'Agent ID regenerated' })
    },
    onError: (e: Error) => addNotification({ type: 'error', title: 'Failed to regenerate ID', message: e.message }),
  })

  return { enableAgent, disableAgent, deleteAgent, renameAgent, regenerateId }
}

// ─── Telemetry ────────────────────────────────────────────────────────────────

export function useTelemetry(params: TelemetryQueryParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.telemetry(params),
    queryFn: () => telemetryApi.query(params),
    enabled,
    staleTime: 5 * 60 * 1000,
  })
}

export function useLatestMetrics(agentId: string | null) {
  return useQuery({
    queryKey: queryKeys.telemetryLatest(agentId ?? ''),
    queryFn: () => telemetryApi.latest(agentId!),
    enabled: !!agentId,
    staleTime: 10_000,
    refetchInterval: 10_000,
  })
}

export function useMetricConfig(agentId: string | null) {
  return useQuery({
    queryKey: queryKeys.metricConfig(agentId ?? ''),
    queryFn: () => telemetryApi.getConfig(agentId!),
    enabled: !!agentId,
  })
}

// ─── Logs ─────────────────────────────────────────────────────────────────────

export function useLogs(params: LogQueryParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.logs(params),
    queryFn: () => logsApi.query(params),
    enabled,
    staleTime: 10_000,
    refetchInterval: enabled ? 10_000 : undefined,
  })
}

// ─── Audit ────────────────────────────────────────────────────────────────────

export function useAudit(params?: AuditQueryParams) {
  return useQuery({
    queryKey: queryKeys.audit(params),
    queryFn: () => auditApi.query(params),
    staleTime: 30_000,
  })
}

// ─── Users ────────────────────────────────────────────────────────────────────

export function useUsers() {
  return useQuery({
    queryKey: queryKeys.users(),
    queryFn: usersApi.list,
    staleTime: 60_000,
  })
}

export function useUserMutations() {
  const qc = useQueryClient()
  const addNotification = useUiStore((s) => s.addNotification)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['users'] })

  const createUser = useMutation({
    mutationFn: usersApi.create,
    onSuccess: () => {
      invalidate()
      addNotification({ type: 'success', title: 'User created' })
    },
    onError: (e: Error) => addNotification({ type: 'error', title: 'Failed to create user', message: e.message }),
  })

  const deleteUser = useMutation({
    mutationFn: usersApi.delete,
    onSuccess: () => {
      invalidate()
      addNotification({ type: 'success', title: 'User deleted' })
    },
    onError: (e: Error) => addNotification({ type: 'error', title: 'Failed to delete user', message: e.message }),
  })

  const toggleUser = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      active ? usersApi.enable(id) : usersApi.disable(id),
    onSuccess: () => {
      invalidate()
    },
    onError: (e: Error) => addNotification({ type: 'error', title: 'Failed to update user', message: e.message }),
  })

  const assignRole = useMutation({
    mutationFn: ({ id, role }: Parameters<typeof usersApi.assignRole>[0] extends never ? never : { id: number; role: Parameters<typeof usersApi.assignRole>[1] }) =>
      usersApi.assignRole(id, role),
    onSuccess: () => {
      invalidate()
      addNotification({ type: 'success', title: 'Role updated' })
    },
    onError: (e: Error) => addNotification({ type: 'error', title: 'Failed to update role', message: e.message }),
  })

  return { createUser, deleteUser, toggleUser, assignRole }
}

// ─── Config ───────────────────────────────────────────────────────────────────

export function useServerConfig() {
  return useQuery({
    queryKey: queryKeys.config(),
    queryFn: configApi.list,
    staleTime: 60_000,
  })
}

export function useRetentionPolicy() {
  return useQuery({
    queryKey: queryKeys.retention(),
    queryFn: configApi.getRetention,
    staleTime: 60_000,
  })
}

// ─── Live metrics via WebSocket ───────────────────────────────────────────────

const HISTORY_SIZE = 60

export interface LiveMetrics {
  latest: Record<string, Metric>
  history: {
    cpu: number[]
    ram: number[]
    netRx: number[]
    netTx: number[]
    gpu: number[]
    timestamps: string[]
  }
}

export function useLiveMetrics(agentId: string | null): LiveMetrics {
  const [state, setState] = useState<LiveMetrics>({
    latest: {},
    history: { cpu: [], ram: [], netRx: [], netTx: [], gpu: [], timestamps: [] },
  })

  useEffect(() => {
    if (!agentId) {
      setState({ latest: {}, history: { cpu: [], ram: [], netRx: [], netTx: [], gpu: [], timestamps: [] } })
      return
    }

    let active = true

    const resetHistory = () => ({ cpu: [], ram: [], netRx: [], netTx: [], gpu: [], timestamps: [] })

    setState({ latest: {}, history: resetHistory() })

    ;(async () => {
      try {
        const seeded = await telemetryApi.latest(agentId)
        if (!active) return
        setState((prev) => ({ ...prev, latest: seeded }))
      } catch (error) {
        console.warn('[metrics] failed to seed latest metrics', error)
      }
    })()

    const append = (arr: number[], val: number): number[] =>
      [...arr, val].slice(-HISTORY_SIZE)

    const unsubscribe = wsClient.subscribe<Metric>('metrics', agentId, (metric) => {
      setState((prev) => {
        const latest = { ...prev.latest, [metric.metric_type]: metric }
        const h = { ...prev.history }

        if (metric.metric_type === 'cpu') {
          const d = metric.data as unknown as CpuData
          h.cpu = append(h.cpu, d.usage_pct ?? 0)
          h.timestamps = append(h.timestamps as unknown as number[], metric.timestamp as unknown as number) as unknown as string[]
        } else if (metric.metric_type === 'ram') {
          const d = metric.data as unknown as RamData
          h.ram = append(h.ram, d.usage_pct ?? 0)
        } else if (metric.metric_type === 'network') {
          const d = metric.data as unknown as NetworkData
          const iface = d.interfaces?.find((i) => i.name !== 'lo') ?? d.interfaces?.[0]
          if (iface) {
            h.netRx = append(h.netRx, iface.rx_bytes_rate)
            h.netTx = append(h.netTx, iface.tx_bytes_rate)
          }
        } else if (metric.metric_type === 'gpu') {
          const d = metric.data as unknown as { summary?: { avg_utilization_pct?: number } }
          const util = d.summary?.avg_utilization_pct ?? 0
          h.gpu = append(h.gpu, util)
        }

        return { latest, history: h }
      })
    })

    return () => {
      active = false
      unsubscribe?.()
    }
  }, [agentId])

  return state
}

// ─── Live logs via WebSocket ──────────────────────────────────────────────────

const MAX_LIVE_LOGS = 500

export function useLiveLogs(agentId: string | null) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [connected, setConnected] = useState(false)
  const wsConnected = useUiStore((s) => s.wsConnected)

  useEffect(() => {
    if (!agentId) return

    const unsubscribe = wsClient.subscribe<LogEntry>('logs', agentId, (entry) => {
      setLogs((prev) => [entry, ...prev].slice(0, MAX_LIVE_LOGS))
    })

    return unsubscribe
  }, [agentId])

  useEffect(() => {
    setConnected(wsConnected)
  }, [wsConnected])

  const clear = useCallback(() => setLogs([]), [])

  return { logs, connected, clear }
}

// ─── WebSocket subscription helper ───────────────────────────────────────────

export function useWsSubscription<T>(
  channel: WsChannel,
  agentId: string | null,
  onMessage: (data: T) => void,
) {
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  useEffect(() => {
    if (!agentId) return
    const unsubscribe = wsClient.subscribe<T>(channel, agentId, (data) => {
      onMessageRef.current(data)
    })
    return unsubscribe
  }, [channel, agentId])
}

// ─── Polling hook ─────────────────────────────────────────────────────────────

export function usePolling<T>(
  fn: () => Promise<T>,
  intervalMs: number,
  enabled = true,
): { data: T | null; loading: boolean; error: string | null; refresh: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fnRef = useRef(fn)
  fnRef.current = fn

  const run = useCallback(async () => {
    try {
      const result = await fnRef.current()
      setData(result)
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    run()
    const id = setInterval(run, intervalMs)
    return () => clearInterval(id)
  }, [enabled, intervalMs, run])

  return { data, loading, error, refresh: run }
}

// ─── Debounce hook ────────────────────────────────────────────────────────────

export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}

// ─── Outside click ────────────────────────────────────────────────────────────

export function useOutsideClick<T extends HTMLElement>(callback: () => void) {
  const ref = useRef<T>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        callback()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [callback])

  return ref
}

// ─── Copy to clipboard ────────────────────────────────────────────────────────

export function useCopyToClipboard(resetMs = 2000) {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), resetMs)
    } catch {
      setCopied(false)
    }
  }, [resetMs])

  return { copied, copy }
}

export { usePersistedState } from './usePersistedState'
