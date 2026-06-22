import { request } from '@/api/client'

export interface AiRunPayload {
  fetch: {
    url: string
    params?: Record<string, unknown>
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH'
  }
  code: string
  input_data?: Record<string, unknown>
  timeout_s?: number
  mem_limit?: string
  cpu_quota?: number
  retries?: number
}

export interface AiRunResponse {
  duration_ms: number
  fetch_result: Record<string, unknown>
  exec_result: {
    exit_code?: number
    stdout?: string
    output_json?: unknown
  }
}

export async function runAiGraph(body: AiRunPayload): Promise<AiRunResponse> {
  return request<AiRunResponse>({
    method: 'POST',
    url: '/ai/run-graph/',
    data: body,
  })
}
