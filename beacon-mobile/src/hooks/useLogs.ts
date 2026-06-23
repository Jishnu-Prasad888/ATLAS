import { useQuery } from '@tanstack/react-query'
import { logsApi } from '@/api/endpoints'
import { LogEntry, LogQueryParams } from '@/types'

export function useLogs(params: LogQueryParams, enabled = true) {
  return useQuery({
    queryKey: ['logs', params],
    queryFn: async () => {
      const response = await logsApi.list(params)
      return response.data ?? [] as LogEntry[]
    },
    enabled,
    staleTime: 10_000,
    refetchInterval: enabled ? 10_000 : undefined,
  })
}
