import { useQuery, UseQueryResult } from '@tanstack/react-query'
import { telemetryApi } from '@/api/endpoints'
import { Metric, TelemetryQueryParams } from '@/types'

export function useTelemetry(params?: TelemetryQueryParams, enabled = true): UseQueryResult<Metric[]> {
  return useQuery({
    queryKey: ['telemetry', params ?? {}],
    queryFn: async () => {
      if (!params) return []
      const response = await telemetryApi.list(params)
      return response.data ?? []
    },
    staleTime: 5 * 60 * 1000,
    enabled: enabled && Boolean(params),
  })
}
