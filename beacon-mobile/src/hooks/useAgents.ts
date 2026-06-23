import { useQuery } from '@tanstack/react-query'
import { agentsApi } from '@/api/endpoints'
import { Agent, AgentListParams } from '@/types'

export function useAgents(params?: AgentListParams) {
  return useQuery({
    queryKey: ['agents', params],
    queryFn: async () => {
      const response = await agentsApi.list(params)
      return response.data ?? [] as Agent[]
    },
    staleTime: 30_000,
  })
}
