import { whoAmI, tools, allowedToolsForRole, mutatingTools } from '@/atlas-ai/beacon'
import { toOpenAITools } from '@/atlas-ai/tooling'
import { runChat } from '@/atlas-ai/model'
import { keyStatus as ks, storeApiKey, unlockKey, lockKey, getUnlockedKey } from '@/atlas-ai/keyStore'
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

export type ProviderOption = 'openai' | 'local'

export const atlasAiApi = {
  async chat(payload: { messages: AtlasAiMessage[]; page?: string; context?: Record<string, unknown>; provider?: 'openai' | 'local' }): Promise<AtlasAiChatResponse> {
    const { user, scope } = await whoAmI()
    const key = getUnlockedKey(String(user.id))
    const kStatus = ks(String(user.id))

    if (!kStatus.hasKey) {
      const err = new Error('No API key stored') as Error & { needs_key: boolean; key_status: KeyStatus }
      err.needs_key = true
      err.key_status = kStatus
      throw err
    }
    if (!key) {
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
      provider: key.provider,
      apiKeyOverride: key.apiKey,
    })
    const choice = result.choices[0]

    writeAudit({
      timestamp: new Date().toISOString(),
      user_id: user.id,
      username: user.username,
      role: user.role,
      action: 'atlas-ai.chat',
      status: 'ok',
      details: { page: payload.page, messages: payload.messages.length, provider: key.provider },
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
        provider: key.provider,
        apiKeyOverride: key.apiKey,
      })
      assistantMessage = followUp.choices[0].message.content ?? assistantMessage
    }

    return { message: assistantMessage, pending_actions: pending }
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

  async unlockKey(passphrase: string): Promise<{ ok: boolean; provider: ProviderOption }> {
    const { user } = await whoAmI()
    const plain = await unlockKey(String(user.id), passphrase)
    return { ok: true, provider: plain.provider }
  },

  async lockKey(): Promise<{ ok: boolean }> {
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
    return { ok: true }
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
    'You are ATLAS-AI. Mirror the user permissions. Do not guess.',
    `User: ${username} · Role: ${role}.`,
    page ? `Current page: ${page}.` : '',
    'Only use tools that are allowed. For any mutating tool, ask for confirmation and do not execute unless the user explicitly confirms.',
    'Keep answers concise; prefer bullet points.',
    'If a tool is unavailable, say so briefly.',
  ].filter(Boolean).join(' ')
}
