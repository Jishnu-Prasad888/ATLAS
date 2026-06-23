import { useQuery } from '@tanstack/react-query'
import { healthApi } from '@/api/endpoints'
import { FleetHealth } from '@/types'

export function useFleetHealth() {
  return useQuery({
    queryKey: ['fleet-health-overview'],
    queryFn: async () => {
      const response = await healthApi.overview()
      return response.data as FleetHealth
    },
    refetchInterval: 15_000,
    staleTime: 10_000,
  })
}
