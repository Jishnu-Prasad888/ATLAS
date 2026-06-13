import { request } from './client'
import { env } from '@/config/env'
import type { Metric, MetricConfig, TelemetryQueryParams } from '@/types'

export const telemetryApi = {
  query: (params: TelemetryQueryParams) =>
    request<Metric[]>({ method: 'GET', url: '/telemetry/', params }),

  latest: (agentId: string) =>
    request<Record<string, Metric>>({
      method: 'GET',
      url: `/telemetry/latest/${encodeURIComponent(agentId)}/`,
    }),

  prune: () =>
    request<{ pruned: Record<string, number> }>({
      method: 'POST',
      url: '/telemetry/prune/',
      data: {},
    }),

  getConfig: (agentId: string) =>
    request<MetricConfig>({
      method: 'GET',
      url: `/metrics/config/${encodeURIComponent(agentId)}/`,
    }),

  updateConfig: (agentId: string, data: Partial<Omit<MetricConfig, 'agent_id' | 'updated_at'>>) =>
    request<MetricConfig>({
      method: 'PATCH',
      url: `/metrics/config/${encodeURIComponent(agentId)}/`,
      data,
    }),
}

export function buildLogsExportUrl(params?: {
  agent_id?: string
  severity?: string
  start?: string
  end?: string
}): string {
  const url = new URL(`${env.restBase}/logs/export/`)
  if (params?.agent_id) url.searchParams.set('agent_id', params.agent_id)
  if (params?.severity) url.searchParams.set('severity', params.severity)
  if (params?.start) url.searchParams.set('start', params.start)
  if (params?.end) url.searchParams.set('end', params.end)
  return url.toString()
}

export function buildAuditExportUrl(): string {
  return `${env.restBase}/audit/export/`
}
