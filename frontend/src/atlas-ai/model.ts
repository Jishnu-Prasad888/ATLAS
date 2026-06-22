import { config } from './env'

interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  name?: string
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

interface ToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

interface ChatCall {
  system: string
  messages: ChatMessage[]
  tools?: ToolDef[]
  provider?: 'openai' | 'local'
  apiKeyOverride?: string
  baseUrlOverride?: string
  modelOverride?: string
}

interface ChatChoice {
  index: number
  message: {
    role: 'assistant'
    content: string | null
    tool_calls?: Array<{
      id: string
      type: 'function'
      function: { name: string; arguments: string }
    }>
  }
  finish_reason: string
}

interface ChatResponse {
  choices: ChatChoice[]
}

export async function runChat(call: ChatCall): Promise<ChatResponse> {
  const provider = call.provider ?? config.llmProvider
  const apiKey = call.apiKeyOverride ?? (provider === 'openai' ? config.openaiApiKey : 'sk-local')
  const baseURL = call.baseUrlOverride ?? (provider === 'openai' ? 'https://api.openai.com/v1' : config.localLlmBaseUrl)
  const model = call.modelOverride ?? (provider === 'openai' ? config.openaiModel : config.localLlmModel)

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: call.system },
      ...call.messages,
    ],
    temperature: 0.2,
  }

  if (call.tools?.length) {
    body.tools = call.tools
    body.tool_choice = 'auto'
  }

  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`LLM ${res.status}: ${text.slice(0, 500)}`)
  }

  return res.json() as Promise<ChatResponse>
}
