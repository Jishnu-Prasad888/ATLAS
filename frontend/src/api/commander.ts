import { request } from '@/api/client'

export interface CommanderToolCall {
  id?: string
  function?: { name?: string; arguments?: string }
}

export interface CommanderTurn {
  role: string
  content?: string
  tool_calls?: CommanderToolCall[]
}

export interface CommanderResponse {
  transcript: CommanderTurn[]
}

export async function askCommander(question: string, apiKey?: string): Promise<CommanderResponse> {
  const data: Record<string, unknown> = { question }
  if (apiKey) data.api_key = apiKey
  return request<CommanderResponse>({
    method: 'POST',
    url: '/ai/commander/',
    data,
  })
}
