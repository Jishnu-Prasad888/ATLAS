function get(key: string, fallback: string): string {
  const value = (import.meta.env as Record<string, string>)[key]
  return value ?? fallback
}

export const config = {
  llmProvider: get('VITE_ATLAS_AI_LLM_PROVIDER', 'openai') as 'openai' | 'local',
  openaiApiKey: get('VITE_ATLAS_AI_OPENAI_API_KEY', ''),
  openaiModel: get('VITE_ATLAS_AI_OPENAI_MODEL', 'gpt-4o'),
  localLlmBaseUrl: get('VITE_ATLAS_AI_LOCAL_LLM_BASE_URL', 'http://localhost:11434/v1'),
  localLlmModel: get('VITE_ATLAS_AI_LOCAL_LLM_MODEL', 'qwen2.5-coder:14b'),
}
