import { request } from './client'
import { whoAmI, tools, allowedToolsForRole, mutatingTools } from '@/atlas-ai/beacon'
import { toOpenAITools } from '@/atlas-ai/tooling'
import { runChat } from '@/atlas-ai/model'
import { keyStatus as ks, storeApiKey, unlockKey, lockKey } from '@/atlas-ai/keyStore'
import { writeAudit } from '@/atlas-ai/audit'

export interface AtlasAiMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
}

export interface PendingAction {
  name: string
  arguments: Record<string, unknown>
}

export interface AtlasAiChatResponse {
  message: string
  pending_actions: PendingAction[]
  needs_key?: boolean
  needs_unlock?: boolean
  key_status?: KeyStatus
}

export interface KeyStatus {
  hasKey: boolean
  provider?: 'openai' | 'local'
  created_at?: string
  unlocked: boolean
  unlock_expires_at?: string | null
}

export interface AtlasAiThread {
  id: string
  title: string
  created_at: string
  updated_at: string
  deleted_at?: string | null
  message_count: number
}

export interface AtlasAiStoredMessage extends AtlasAiMessage {
  id: number
  created_at: string
}

export type ProviderOption = 'openai' | 'local'

export const atlasAiApi = {
  async chat(payload: {
    messages: AtlasAiMessage[]
    page?: string
    context?: Record<string, unknown>
    provider?: 'openai' | 'local'
    apiKey?: string
  }): Promise<AtlasAiChatResponse> {
    const { user, scope } = await whoAmI()
    const kStatus = ks(String(user.id))
    const provider = payload.provider ?? kStatus.provider ?? 'openai'
    const runtimeKey = payload.apiKey

    if (!kStatus.hasKey) {
      const err = new Error('No API key stored') as Error & { needs_key: boolean; key_status: KeyStatus }
      err.needs_key = true
      err.key_status = kStatus
      throw err
    }
    if (!runtimeKey) {
      const err = new Error('API key locked. Unlock to continue.') as Error & { needs_unlock: boolean; key_status: KeyStatus }
      err.needs_unlock = true
      err.key_status = kStatus
      throw err
    }

    const allowed = allowedToolsForRole(user.role)
    const system = buildSystemPrompt(user.username, user.role, payload.page)
    const toolsForModel = toOpenAITools(allowed)

    const modelMessages = [...payload.messages]
    if (payload.context) {
      modelMessages.unshift({ role: 'system' as const, content: `Context: ${JSON.stringify(payload.context).slice(0, 1800)}` })
    }

    const result = await runChat({
      system,
      messages: modelMessages,
      tools: toolsForModel,
      provider,
      apiKeyOverride: runtimeKey,
    })
    const choice = result.choices[0]

    writeAudit({
      timestamp: new Date().toISOString(),
      user_id: user.id,
      username: user.username,
      role: user.role,
      action: 'atlas-ai.chat',
      status: 'ok',
      details: { page: payload.page, messages: payload.messages.length, provider },
    })

    const pending: PendingAction[] = []
    const toolResponses: Array<{ id: string; name: string; content: unknown }> = []

    if (choice.message.tool_calls?.length) {
      for (const call of choice.message.tool_calls) {
        const name = call.function.name as keyof typeof tools
        if (!allowed.includes(name)) {
          pending.push({ name, arguments: { denied: true } })
          continue
        }

        const args = safeParseArgs(call.function.arguments)

        if (mutatingTools.has(name)) {
          pending.push({ name, arguments: args })
          continue
        }

        try {
          const res = await tools[name](scope, args as any)
          writeAudit({
            timestamp: new Date().toISOString(),
            user_id: user.id,
            username: user.username,
            role: user.role,
            action: `atlas-ai.tool.${name}`,
            status: 'ok',
            details: { args },
          })
          toolResponses.push({ id: call.id, name, content: res })
        } catch (err: any) {
          writeAudit({
            timestamp: new Date().toISOString(),
            user_id: user.id,
            username: user.username,
            role: user.role,
            action: `atlas-ai.tool.${name}`,
            status: 'error',
            error: err?.message ?? 'tool failed',
            details: { args },
          })
          throw err
        }
      }
    }

    let assistantMessage = choice.message.content ?? ''

    if (toolResponses.length > 0) {
      const followUp = await runChat({
        system,
        messages: [
          ...modelMessages,
          { role: 'assistant' as const, content: choice.message.content ?? '', tool_calls: choice.message.tool_calls },
          ...toolResponses.map((tr) => ({ role: 'tool' as const, name: tr.name, content: JSON.stringify(tr.content), tool_call_id: tr.id })),
        ],
        tools: toolsForModel,
        provider,
        apiKeyOverride: runtimeKey,
      })
      assistantMessage = followUp.choices[0].message.content ?? assistantMessage
    }

    return { message: assistantMessage, pending_actions: pending }
  },

  async listThreads(): Promise<AtlasAiThread[]> {
    return request<AtlasAiThread[]>({ method: 'GET', url: '/atlas-ai/threads/' })
  },

  async createThread(title?: string): Promise<AtlasAiThread> {
    return request<AtlasAiThread>({ method: 'POST', url: '/atlas-ai/threads/', data: title ? { title } : {} })
  },

  async deleteThread(threadId: string): Promise<void> {
    await request<void>({ method: 'DELETE', url: `/atlas-ai/threads/${encodeURIComponent(threadId)}/` })
  },

  async listMessages(threadId: string): Promise<AtlasAiStoredMessage[]> {
    const res = await request<{ thread: string; messages: AtlasAiStoredMessage[]}>({
      method: 'GET',
      url: `/atlas-ai/threads/${encodeURIComponent(threadId)}/messages/`,
    })
    return res.messages
  },

  async appendMessages(threadId: string, messages: AtlasAiMessage[]): Promise<AtlasAiStoredMessage[]> {
    const payload = Array.isArray(messages) ? messages : [messages]
    return request<AtlasAiStoredMessage[]>({
      method: 'POST',
      url: `/atlas-ai/threads/${encodeURIComponent(threadId)}/messages/`,
      data: { messages: payload },
    })
  },

  async confirm(action: PendingAction): Promise<{ ok: boolean; result: unknown }> {
    const { user, scope } = await whoAmI()
    const allowed = allowedToolsForRole(user.role)
    const name = action.name as keyof typeof tools

    if (!allowed.includes(name)) throw new Error('Tool not allowed')
    if (!mutatingTools.has(name)) throw new Error('Tool is not mutating')

    const res = await tools[name](scope, action.arguments as any)
    writeAudit({
      timestamp: new Date().toISOString(),
      user_id: user.id,
      username: user.username,
      role: user.role,
      action: `atlas-ai.tool.${name}`,
      status: 'ok',
      details: { args: action.arguments, mutating: true },
    })
    return { ok: true, result: res }
  },

  async keyStatus(): Promise<KeyStatus> {
    const { user } = await whoAmI()
    return ks(String(user.id))
  },

  async storeKey(provider: ProviderOption, apiKey: string, passphrase: string): Promise<{ ok: boolean }> {
    const { user } = await whoAmI()
    await storeApiKey(String(user.id), provider, apiKey, passphrase)
    writeAudit({
      timestamp: new Date().toISOString(),
      user_id: user.id,
      username: user.username,
      role: user.role,
      action: 'atlas-ai.key.store',
      status: 'ok',
      details: { provider },
    })
    return { ok: true }
  },

  async unlockKey(passphrase: string): Promise<{
    ok: boolean
    provider: ProviderOption
    apiKey: string
    key_status: KeyStatus
  }> {
    const { user } = await whoAmI()
    const plain = await unlockKey(String(user.id), passphrase)
    const status = ks(String(user.id))
    return { ok: true, provider: plain.provider, apiKey: plain.apiKey, key_status: status }
  },

  async lockKey(): Promise<{ ok: boolean; key_status: KeyStatus }> {
    const { user } = await whoAmI()
    lockKey(String(user.id))
    writeAudit({
      timestamp: new Date().toISOString(),
      user_id: user.id,
      username: user.username,
      role: user.role,
      action: 'atlas-ai.key.lock',
      status: 'ok',
      details: {},
    })
    const status = ks(String(user.id))
    return { ok: true, key_status: status }
  },
}

function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function buildSystemPrompt(username: string, role: string, page?: string) {
  return [
    'You are ATLAS-AI for the Beacon platform dashboard. You help users inspect and manage agents, telemetry, metrics, logs, and config while strictly honoring their role-based permissions.',
    `User: ${username} · Role: ${role}.`,
    page ? `Current page: ${page}.` : '',
    'If the user provides a SHA-like hash (sha256:..., hex id), treat it as an agent_id and use it directly with relevant tools.',
    'Use only allowed tools. For any mutating tool, ask for explicit confirmation and do not execute unless the user confirms.',
    'When suggesting actions, prefer the built-in tools (list/get agent, metrics/logs, config) before generic advice.',
    'If a tool is unavailable or returns an error, state that briefly and offer the next best available step.',
    'Keep answers concise; prefer bullet points; include short status/next-step notes when helpful.',
  ].filter(Boolean).join(' ')
}
