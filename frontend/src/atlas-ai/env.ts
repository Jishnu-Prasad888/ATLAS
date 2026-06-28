import { readEnv } from '@/config/env'

export const config = {
  llmProvider: readEnv('VITE_ATLAS_AI_LLM_PROVIDER', 'openai') as 'openai' | 'local',
  openaiApiKey: readEnv('VITE_ATLAS_AI_OPENAI_API_KEY', ''),
  openaiModel: readEnv('VITE_ATLAS_AI_OPENAI_MODEL', 'gpt-4o'),
  localLlmBaseUrl: readEnv('VITE_ATLAS_AI_LOCAL_LLM_BASE_URL', 'http://localhost:11434/v1'),
  localLlmModel: readEnv('VITE_ATLAS_AI_LOCAL_LLM_MODEL', 'qwen2.5-coder:14b'),
}
