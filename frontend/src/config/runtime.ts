type RawRuntimeConfig = Partial<{
  VITE_API_BASE_URL: string
  VITE_WS_BASE_URL: string
  VITE_API_PREFIX: string
  VITE_WS_PATH: string
  VITE_ATLAS_AI_ENABLED: string | boolean
  VITE_ATLAS_AI_BASE_URL: string
  VITE_ATLAS_AI_LLM_PROVIDER: string
  VITE_ATLAS_AI_OPENAI_API_KEY: string
  VITE_ATLAS_AI_OPENAI_MODEL: string
  VITE_ATLAS_AI_LOCAL_LLM_BASE_URL: string
  VITE_ATLAS_AI_LOCAL_LLM_MODEL: string
  VITE_GOOGLE_CLIENT_ID: string
  VITE_ENABLE_MOCKS: string | boolean
  VITE_DEBUG_HTTP: string | boolean
  VITE_DEBUG_WS: string | boolean
}>

export type RuntimeConfig = Record<string, string>

declare global {
  interface Window {
    __BEACON_CONFIG__?: RawRuntimeConfig
  }
}

let runtimeConfig: RuntimeConfig = {}
let initPromise: Promise<RuntimeConfig> | null = null
let initialized = false

function normaliseValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value === true) return 'true'
  if (value === false) return 'false'
  return undefined
}

function normaliseConfig(raw: RawRuntimeConfig | undefined): RuntimeConfig {
  if (!raw) return {}
  const entries = Object.entries(raw)
    .map(([key, value]) => {
      const normalised = normaliseValue(value)
      return normalised !== undefined ? [key, normalised] : null
    })
    .filter((entry): entry is [string, string] => entry !== null)
  return Object.fromEntries(entries)
}

async function fetchConfig(): Promise<RuntimeConfig> {
  try {
    const response = await fetch('/app-config.json', { cache: 'no-store' })
    if (response.ok) {
      const json = (await response.json()) as RawRuntimeConfig
      return normaliseConfig(json)
    }
    if (response.status !== 404 && import.meta.env.DEV) {
      console.warn('app-config.json responded with', response.status)
    }
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('Unable to load runtime config', error)
    }
  }
  return {}
}

export async function initRuntimeConfig(): Promise<RuntimeConfig> {
  if (initialized) return runtimeConfig
  if (initPromise) return initPromise

  initPromise = (async () => {
    const inlineConfig = normaliseConfig(window.__BEACON_CONFIG__)
    if (Object.keys(inlineConfig).length > 0) {
      runtimeConfig = inlineConfig
    } else {
      runtimeConfig = await fetchConfig()
    }
    initialized = true
    initPromise = null
    return runtimeConfig
  })()

  return initPromise
}

export function getRuntimeConfig(): RuntimeConfig {
  return runtimeConfig
}

export function runtimeValue(key: string): string | undefined {
  return runtimeConfig[key]
}
