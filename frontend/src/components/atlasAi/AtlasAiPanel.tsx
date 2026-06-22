import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { MessageCircle, Send, ShieldCheck, X, TriangleAlert, LockKeyhole, UnlockKeyhole, KeyRound, Settings } from 'lucide-react'
import { env } from '@/config/env'
import { useAtlasAiStore } from '@/store/atlasAiStore'
import { useAuthStore } from '@/store/authStore'

export function AtlasAiPanel() {
  const location = useLocation()
  const { isAuthenticated } = useAuthStore()
  const {
    open,
    toggle,
    messages,
    pending,
    sending,
    error,
    keyStatus,
    keyLoading,
    keyWorking,
    refreshKeyStatus,
    storeKey,
    unlockKey,
    lockKey,
    send,
    confirm,
    reset,
    panelWidth,
    setPanelWidth,
  } = useAtlasAiStore()
  const [draft, setDraft] = useState('')
  const [provider, setProvider] = useState<'openai' | 'local'>('openai')
  const [apiKey, setApiKey] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [unlockPass, setUnlockPass] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const resizing = useRef(false)

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [open, messages])

  useEffect(() => {
    if (open) refreshKeyStatus()
  }, [open, refreshKeyStatus])

  useEffect(() => {
    if (keyStatus?.provider) setProvider(keyStatus.provider)
  }, [keyStatus?.provider])

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!resizing.current) return
      const desired = window.innerWidth - e.clientX
      setPanelWidth(desired)
      e.preventDefault()
    }
    function onUp() {
      resizing.current = false
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [setPanelWidth])

  if (!env.atlasAiEnabled || !isAuthenticated) return null

  const handleSend = () => {
    const content = draft.trim()
    if (!content) return
    send(content, location.pathname, {})
    setDraft('')
  }

  return (
    <div>
      <button
        onClick={toggle}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-[--color-surface] border border-[--color-border] px-3 py-2 text-xs font-mono text-[--color-text] shadow-lg hover:border-[--color-border-strong]"
        aria-label="Toggle ATLAS-AI"
      >
        <MessageCircle size={16} />
        ATLAS-AI
        {pending.length > 0 && (
          <span className="ml-1 rounded-full bg-amber-500/20 text-amber-300 px-2 py-0.5 text-[10px] border border-amber-500/30">
            {pending.length}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed top-0 bottom-0 right-0 z-40 border-l border-[--color-border] bg-[--color-bg] shadow-2xl flex flex-col"
          style={{ width: panelWidth, maxWidth: 'min(640px, 100vw - 48px)' }}
        >
          <div
            className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize bg-[--color-border]/50 hover:bg-[--color-border]"
            onMouseDown={(e) => { resizing.current = true; e.preventDefault() }}
            aria-label="Resize ATLAS-AI panel"
          />

          <div className="flex items-center justify-between px-3 py-3 border-b border-[--color-border] pl-4">
            <div className="flex items-center gap-2 text-xs font-mono text-[--color-text]">
              <ShieldCheck size={16} />
              ATLAS-AI (role-aware)
              {keyLoading && <span className="text-[10px] text-[--color-text-dim]">loading key…</span>}
            </div>
            <div className="flex items-center gap-2 text-[--color-text-dim]">
              <button
                onClick={() => reset()}
                aria-label="Clear chat"
                className="hover:text-[--color-text] text-[11px] font-mono"
              >
                Clear
              </button>
              <button
                onClick={() => setShowSettings((v) => !v)}
                aria-label="API key settings"
                className="hover:text-[--color-text]"
              >
                <Settings size={14} />
              </button>
              <button onClick={toggle} aria-label="Close" className="hover:text-[--color-text]">
                <X size={14} />
              </button>
            </div>
          </div>

          {showSettings && (
            <div className="border-b border-[--color-border] p-3 pb-4 bg-[--color-surface]">
              <div className="flex items-center justify-between gap-2 text-xs font-mono text-[--color-text] mb-2">
                <span className="flex items-center gap-2 text-[--color-text]"><KeyRound size={14} /> API Key</span>
                {keyStatus?.unlocked ? (
                  <span className="text-[10px] uppercase text-green-400">Unlocked</span>
                ) : keyStatus?.hasKey ? (
                  <span className="text-[10px] uppercase text-amber-300">Locked</span>
                ) : (
                  <span className="text-[10px] uppercase text-red-300">Missing</span>
                )}
              </div>
              <div className="text-[10px] text-[--color-text-dim] mb-2">
                Provider: {keyStatus?.provider ?? 'not set'}
                {keyStatus?.unlock_expires_at && keyStatus.unlocked && (
                  <span className="ml-2">expires {new Date(keyStatus.unlock_expires_at).toLocaleTimeString()}</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div className="space-y-1">
                  <label className="text-[--color-text-dim]">Provider</label>
                  <select
                    className="w-full rounded border border-[--color-border] bg-[--color-bg] px-2 py-1 text-[--color-text]"
                    value={provider}
                    onChange={(e) => setProvider(e.target.value as 'openai' | 'local')}
                    disabled={keyWorking}
                  >
                    <option value="openai">OpenAI</option>
                    <option value="local">Local</option>
                  </select>
                  <label className="text-[--color-text-dim]">API Key</label>
                  <input
                    className="w-full rounded border border-[--color-border] bg-[--color-bg] px-2 py-1 text-[--color-text]"
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    disabled={keyWorking}
                    placeholder="sk-..."
                  />
                  <label className="text-[--color-text-dim]">Set Passphrase</label>
                  <input
                    className="w-full rounded border border-[--color-border] bg-[--color-bg] px-2 py-1 text-[--color-text]"
                    type="password"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    disabled={keyWorking}
                    placeholder="Passphrase"
                  />
                  <button
                    className="mt-2 w-full rounded bg-[--color-text] text-[--color-bg] py-1 text-[10px] font-semibold disabled:opacity-60"
                    onClick={() => { if (apiKey && passphrase) { storeKey(provider, apiKey, passphrase); setApiKey(''); setPassphrase('') } }}
                    disabled={keyWorking || !apiKey || !passphrase}
                  >
                    Save & Encrypt
                  </button>
                </div>
                <div className="space-y-1">
                  <label className="text-[--color-text-dim]">Unlock Passphrase</label>
                  <input
                    className="w-full rounded border border-[--color-border] bg-[--color-bg] px-2 py-1 text-[--color-text]"
                    type="password"
                    value={unlockPass}
                    onChange={(e) => setUnlockPass(e.target.value)}
                    disabled={keyWorking}
                    placeholder="Enter to unlock"
                  />
                  <div className="flex gap-2 mt-1">
                    <button
                      className="flex-1 rounded bg-emerald-500 text-black py-1 text-[10px] font-semibold disabled:opacity-60"
                      onClick={() => { if (unlockPass) { unlockKey(unlockPass); setUnlockPass('') } }}
                      disabled={keyWorking || !unlockPass}
                    >
                      <UnlockKeyhole size={12} className="inline mr-1" /> Unlock
                    </button>
                    <button
                      className="flex-1 rounded bg-amber-500 text-black py-1 text-[10px] font-semibold disabled:opacity-60"
                      onClick={() => lockKey()}
                      disabled={keyWorking}
                    >
                      <LockKeyhole size={12} className="inline mr-1" /> Lock
                    </button>
                  </div>
                  <div className="text-[10px] text-[--color-text-dim] mt-2">
                    Keys are encrypted locally; passphrase is never stored.
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2">
            {messages.length === 0 && (
              <div className="text-[11px] font-mono text-[--color-text-dim]">
                Ask anything about the current page. Mutating actions will ask for confirmation.
              </div>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={`rounded-md border px-3 py-2 text-xs font-mono ${m.role === 'user' ? 'border-[--color-border] bg-[--color-surface]' : 'border-[--color-border] bg-[--color-surface-2]'}`}
              >
                <div className="text-[10px] uppercase tracking-wide text-[--color-text-dim] mb-1">{m.role}</div>
                <div className="text-[--color-text] whitespace-pre-wrap leading-relaxed">{m.content}</div>
              </div>
            ))}
          </div>

          {pending.length > 0 && (
            <div className="border-t border-[--color-border] px-3 py-2">
              <div className="flex items-center gap-2 text-[11px] font-mono text-amber-200 mb-2">
                <TriangleAlert size={14} /> Pending actions (confirmation required)
              </div>
              <div className="space-y-2">
                {pending.map((p, idx) => (
                  <div key={`${p.name}-${idx}`} className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-mono text-[--color-text]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="uppercase tracking-wide text-[10px]">{p.name}</span>
                      <button
                        className="text-[10px] uppercase px-2 py-1 rounded bg-amber-500 text-black font-semibold"
                        onClick={() => confirm(p)}
                        disabled={sending}
                      >
                        Confirm
                      </button>
                    </div>
                    <pre className="mt-1 text-[10px] text-[--color-text-dim] whitespace-pre-wrap">
                      {JSON.stringify(p.arguments, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && <div className="border-t border-[--color-border] px-3 py-2 text-[11px] font-mono text-red-300">{error}</div>}

          <div className="flex items-center gap-2 border-t border-[--color-border] px-3 py-2">
            <input
              className="flex-1 rounded border border-[--color-border] bg-[--color-surface] px-2 py-1 text-xs font-mono text-[--color-text] focus:outline-none focus:border-[--color-border-strong]"
              placeholder="Ask ATLAS-AI..."
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              disabled={sending}
            />
            <button
              onClick={handleSend}
              disabled={sending}
              className="rounded bg-[--color-text] text-[--color-bg] px-2 py-1 text-xs font-mono hover:opacity-90 disabled:opacity-50"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
