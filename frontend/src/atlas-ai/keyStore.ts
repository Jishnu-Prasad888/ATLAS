const STORAGE_KEY = 'atlas_ai_keys'
const UNLOCK_TTL_MS = 10 * 60 * 1000

type Provider = 'openai' | 'local'

interface EncryptedRecord {
  provider: Provider
  salt: string
  iv: string
  encrypted: string
  created_at: string
}

interface StoreShape {
  users: Record<string, EncryptedRecord>
}

interface PlainKey {
  provider: Provider
  apiKey: string
}

const unlockedMeta = new Map<string, { provider: Provider; expiresAt: number }>()

function readStore(): StoreShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { users: {} }
    const parsed = JSON.parse(raw) as StoreShape
    return parsed.users ? parsed : { users: {} }
  } catch {
    return { users: {} }
  }
}

function writeStore(store: StoreShape) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

function base64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf.buffer as ArrayBuffer
}

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

async function deriveKey(passphrase: string, salt: ArrayBuffer): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 120_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function storeApiKey(userId: string, provider: Provider, apiKey: string, passphrase: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(passphrase, salt.buffer as ArrayBuffer)
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    new TextEncoder().encode(apiKey).buffer as ArrayBuffer,
  )

  const record: EncryptedRecord = {
    provider,
    salt: btoa(String.fromCharCode(...salt)),
    iv: btoa(String.fromCharCode(...iv)),
    encrypted: bufToBase64(encrypted),
    created_at: new Date().toISOString(),
  }

  const store = readStore()
  store.users[userId] = record
  writeStore(store)
  unlockedMeta.delete(userId)
}

export function hasStoredKey(userId: string): boolean {
  const store = readStore()
  return Boolean(store.users[userId])
}

export async function unlockKey(userId: string, passphrase: string): Promise<PlainKey> {
  const store = readStore()
  const record = store.users[userId]
  if (!record) throw new Error('No key stored')

  const salt = base64ToBuf(record.salt)
  const iv = base64ToBuf(record.iv)
  const encrypted = base64ToBuf(record.encrypted)
  const key = await deriveKey(passphrase, salt)

  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted)
  const apiKey = new TextDecoder().decode(plaintext)

  const plain: PlainKey = { provider: record.provider, apiKey }
  unlockedMeta.set(userId, { provider: record.provider, expiresAt: Date.now() + UNLOCK_TTL_MS })
  return plain
}

export function lockKey(userId: string) {
  unlockedMeta.delete(userId)
}

export function keyStatus(userId: string) {
  const store = readStore()
  const record = store.users[userId]
  const meta = unlockedMeta.get(userId)
  if (meta && Date.now() > meta.expiresAt) {
    unlockedMeta.delete(userId)
  }
  const active = meta && Date.now() < meta.expiresAt ? meta : null
  return {
    hasKey: Boolean(record),
    provider: (active?.provider ?? record?.provider) as Provider | undefined,
    created_at: record?.created_at,
    unlocked: Boolean(active),
    unlock_expires_at: active ? new Date(active.expiresAt).toISOString() : null,
  }
}
