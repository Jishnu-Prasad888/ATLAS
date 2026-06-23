import { request } from '@/api/client'

export interface CommanderToolCall {
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}

export interface CommanderTurn {
  role: string
  content?: string
  tool_calls?: CommanderToolCall[]
  name?: string
  tool_call_id?: string
}

export interface CommanderResponse {
  transcript: CommanderTurn[]
}

export type CommanderMessageRole = 'system' | 'user' | 'assistant' | 'tool'

export interface CommanderMessage {
  role: CommanderMessageRole
  content?: string
  name?: string
  tool_call_id?: string
  tool_calls?: CommanderToolCall[]
}

export interface CommanderChatRequest {
  messages: CommanderMessage[]
  apiKey?: string
  question?: string
}

export async function askCommander(requestPayload: CommanderChatRequest): Promise<CommanderResponse> {
  const data: Record<string, unknown> = {}

  if (requestPayload.messages?.length) {
    data.messages = requestPayload.messages.map((message) => {
      const payload: Record<string, string> = { role: message.role }
      if (typeof message.content === 'string') payload.content = message.content
      if (message.name) payload.name = message.name
      if (message.tool_call_id) payload.tool_call_id = message.tool_call_id
      if (message.tool_calls?.length && message.role === 'assistant') {
        payload.tool_calls = message.tool_calls.map((call) => {
          const callPayload: Record<string, unknown> = {}
          if (call.id) callPayload.id = call.id
          if (call.type) callPayload.type = call.type
          if (call.function) {
            const fnPayload: Record<string, string> = {}
            if (call.function.name) fnPayload.name = call.function.name
            if (call.function.arguments) fnPayload.arguments = call.function.arguments
            callPayload.function = fnPayload
          }
          return callPayload
        })
      }
      return payload
    })
  }

  if (requestPayload.question) data.question = requestPayload.question
  if (requestPayload.apiKey) data.api_key = requestPayload.apiKey

  return request<CommanderResponse>({
    method: 'POST',
    url: '/ai/commander/',
    data,
  })
}
