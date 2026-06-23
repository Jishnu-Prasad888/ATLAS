import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import { useLocation } from 'react-router-dom'
import {
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  MessageCircle,
  Maximize2,
  Minimize2,
  Send,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  LockKeyhole,
  UnlockKeyhole,
  KeyRound,
  Settings,
  Plus,
  Loader2,
  User,
  X,
  XCircle,
} from 'lucide-react'
import { CopyButton } from '@/components/common'
import { env } from '@/config/env'
import { useAtlasAiStore } from '@/store/atlasAiStore'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import { AtlasAiMarkdown } from './Markdown'

const MIN_PANEL_WIDTH = 320
const DEFAULT_MAX_PANEL_WIDTH = 720
const PANEL_EDGE_MARGIN = 48
const RESIZE_STEP = 16
const RESIZE_STEP_LARGE = 64

function getMaxPanelWidth() {
  if (typeof window === 'undefined') return DEFAULT_MAX_PANEL_WIDTH
  return Math.min(DEFAULT_MAX_PANEL_WIDTH, window.innerWidth - PANEL_EDGE_MARGIN)
}

function clampPanelWidth(value: number) {
  return Math.min(Math.max(value, MIN_PANEL_WIDTH), getMaxPanelWidth())
}

export function AtlasAiPanel() {
  const location = useLocation()
  const { isAuthenticated } = useAuthStore()
  const selectedAgentId = useUiStore((s) => s.selectedAgentId)
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
    threads,
    activeThreadId,
    loadThreads,
    selectThread,
    startThread,
    deleteThread,
    loadingThreads,
    loadingMessages,
    panelWidth,
    setPanelWidth,
  } = useAtlasAiStore()

  const [draft, setDraft] = useState('')
  const [provider, setProvider] = useState<'openai' | 'local'>('openai')
  const [apiKey, setApiKey] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [unlockPass, setUnlockPass] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [showPassphrase, setShowPassphrase] = useState(false)
  const [showUnlockPass, setShowUnlockPass] = useState(false)
  const [modalEnabled, setModalEnabled] = useState(false)
  const [threadsCollapsed, setThreadsCollapsed] = useState(false)
  const modalMode = open && modalEnabled

  const requestContext = useMemo(() => {
    const ctx: Record<string, unknown> = {}
    if (selectedAgentId) ctx.agentId = selectedAgentId
    return ctx
  }, [selectedAgentId])

  const scrollRef = useRef<HTMLDivElement>(null)
  const isResizingRef = useRef(false)

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [open, messages])

  useEffect(() => {
    if (open) void refreshKeyStatus()
  }, [open, refreshKeyStatus])

  useEffect(() => {
    if (open) void loadThreads()
  }, [open, loadThreads])

  useEffect(() => {
    const nextProvider = keyStatus?.provider
    if (!nextProvider) return
    if (provider === nextProvider) return
    const raf = requestAnimationFrame(() => setProvider(nextProvider))
    return () => cancelAnimationFrame(raf)
  }, [keyStatus?.provider, provider])

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!isResizingRef.current) return
      setPanelWidth(clampPanelWidth(window.innerWidth - e.clientX))
      e.preventDefault()
    }
    function onUp() {
      isResizingRef.current = false
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [setPanelWidth])

  useEffect(() => {
    if (!open || modalMode || typeof window === 'undefined') return
    const handleResize = () => {
      const next = clampPanelWidth(panelWidth)
      if (next !== panelWidth) setPanelWidth(next)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [open, modalMode, panelWidth, setPanelWidth])

  useEffect(() => {
    if (!modalMode) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [modalMode])

  if (!env.atlasAiEnabled || !isAuthenticated) return null

  const activeThread = threads.find((t) => t.id === activeThreadId)

  const handleSend = () => {
    const content = draft.trim()
    if (!content || sending) return
    send(content, location.pathname, requestContext)
    setDraft('')
  }

  const handleDeleteThread = (threadId: string, e: ReactMouseEvent) => {
    e.stopPropagation()
    deleteThread(threadId)
  }

  const formatTime = (iso?: string | null) => {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } catch {
      return iso
    }
  }

  const toggleThreads = () => {
    setThreadsCollapsed((value) => !value)
  }

  const handleNewThread = () => {
    const hasActiveThread = Boolean(activeThread)
    const isCurrentBlank = hasActiveThread && messages.length === 0 && pending.length === 0
    if (isCurrentBlank) {
      setDraft('')
      return
    }
    setThreadsCollapsed(false)
    startThread()
  }

  const handleModalToggle = () => {
    setModalEnabled((value) => {
      const next = !value
      if (next) setThreadsCollapsed(false)
      return next
    })
  }

  const handleDraftKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    isResizingRef.current = true
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    e.preventDefault()
  }

  const handleResizeKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? RESIZE_STEP_LARGE : RESIZE_STEP
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      setPanelWidth(clampPanelWidth(panelWidth + step))
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      setPanelWidth(clampPanelWidth(panelWidth - step))
    } else if (e.key === 'Home') {
      e.preventDefault()
      setPanelWidth(MIN_PANEL_WIDTH)
    } else if (e.key === 'End') {
      e.preventDefault()
      setPanelWidth(getMaxPanelWidth())
    }
  }

  const modalToggleLabel = modalMode ? 'Dock ATLAS-AI panel' : 'Expand ATLAS-AI panel'
  const threadsToggleLabel = threadsCollapsed ? 'Expand thread list' : 'Collapse thread list'
  const panelStyle = modalMode
    ? {
        width: 'min(90vw, 1100px)',
        maxWidth: 'min(1100px, 100vw - 32px)',
        height: 'min(88vh, 960px)',
        maxHeight: 'min(960px, 100vh - 32px)',
      }
    : {
        width: panelWidth,
        maxWidth: 'min(720px, 100vw - 48px)',
      }
  const panelClassName = modalMode
    ? 'relative flex h-full w-full flex-col overflow-hidden rounded-xl border border-[--color-border] bg-[--color-bg] text-[--color-text] shadow-2xl'
    : 'fixed top-0 bottom-0 right-0 z-40 flex flex-col border-l border-[--color-border] bg-[--color-bg] text-[--color-text] shadow-2xl'
  const panelWrapperClass = modalMode
    ? 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4'
    : undefined

  const keyStatusBadge = keyStatus?.unlocked ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
      <CheckCircle2 size={12} aria-hidden="true" /> Unlocked
    </span>
  ) : keyStatus?.hasKey ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
      <LockKeyhole size={12} aria-hidden="true" /> Locked
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-300">
      <XCircle size={12} aria-hidden="true" /> Missing
    </span>
  )

  const hideToggle = location.pathname.startsWith('/ai-analyst')

  const panelInner = (
    <div
      id="atlas-ai-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="atlas-ai-title"
      style={panelStyle}
      className={panelClassName}
    >
      {!modalMode && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize ATLAS-AI panel"
          aria-valuemin={MIN_PANEL_WIDTH}
          aria-valuemax={getMaxPanelWidth()}
          aria-valuenow={panelWidth}
          tabIndex={0}
          onPointerDown={handleResizePointerDown}
          onKeyDown={handleResizeKeyDown}
          className="group absolute left-0 top-0 bottom-0 w-2 cursor-col-resize bg-[--color-border]/50 hover:bg-[--color-border] focus:outline-none"
        />
      )}

      <div className="flex items-center justify-between border-b border-[--color-border] px-3 py-3 pl-4">
        <div className="flex min-w-0 items-center gap-3 text-xs font-mono text-[--color-text]">
          <ShieldCheck size={16} />
          <span id="atlas-ai-title" className="font-semibold">
            ATLAS-AI (role-aware)
          </span>
          {activeThread ? (
            <span className="truncate text-[10px] uppercase tracking-wide text-[--color-text-dim]">
              Thread: {activeThread.title || 'Untitled'}
            </span>
          ) : (
            <span className="text-[10px] uppercase tracking-wide text-[--color-text-dim]">No thread</span>
          )}
          {keyLoading && <span className="text-[10px] text-[--color-text-dim]">loading key…</span>}
        </div>
        <div className="flex items-center gap-2 text-[--color-text-dim]">
          {keyStatusBadge}
          <button
            type="button"
            onClick={handleNewThread}
            aria-label="Start new thread"
            className="hover:text-[--color-text] text-[11px] font-mono flex items-center gap-1"
          >
            <Plus size={14} /> New
          </button>
          <button
            type="button"
            onClick={() => setShowSettings((v) => !v)}
            aria-label="API key settings"
            className="hover:text-[--color-text]"
          >
            <Settings size={14} />
          </button>
          <button
            type="button"
            onClick={handleModalToggle}
            aria-label={modalToggleLabel}
            aria-pressed={modalMode}
            className="hover:text-[--color-text]"
          >
            {modalMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button type="button" onClick={toggle} aria-label="Close" className="hover:text-[--color-text]">
            <X size={14} />
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="border-b border-[--color-border] bg-[--color-surface] p-3 pb-4">
          <div className="mb-2 flex items-center justify-between gap-2 text-xs font-mono text-[--color-text]">
            <span className="flex items-center gap-2">
              <KeyRound size={14} /> API Key
            </span>
            {keyStatusBadge}
          </div>
          <div className="mb-2 text-[10px] text-[--color-text-dim]">
            Provider: {keyStatus?.provider ?? 'not set'}
            {keyStatus?.unlock_expires_at && keyStatus.unlocked && (
              <span className="ml-2">expires {new Date(keyStatus.unlock_expires_at).toLocaleTimeString()}</span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 text-[10px]">
            <div className="space-y-2">
              <label htmlFor="atlas-ai-provider" className="text-[--color-text-dim]">
                Provider
              </label>
              <select
                id="atlas-ai-provider"
                className="mt-1 w-full rounded border border-[--color-border] bg-[--color-bg] px-2 py-1 text-[--color-text]"
                value={provider}
                onChange={(e) => setProvider(e.target.value as 'openai' | 'local')}
                disabled={keyWorking}
              >
                <option value="openai">OpenAI</option>
                <option value="local">Local</option>
              </select>
              <label htmlFor="atlas-ai-apikey" className="text-[--color-text-dim]">
                API Key
              </label>
              <div className="relative mt-1">
                <input
                  id="atlas-ai-apikey"
                  className="w-full rounded border border-[--color-border] bg-[--color-bg] px-2 py-1 pr-7 text-[--color-text]"
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  disabled={keyWorking}
                  placeholder="sk-..."
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((v) => !v)}
                  aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                  className="absolute inset-y-0 right-1 flex items-center px-1 text-[--color-text-dim] hover:text-[--color-text]"
                >
                  {showApiKey ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>
              <label htmlFor="atlas-ai-passphrase" className="text-[--color-text-dim]">
                Set Passphrase
              </label>
              <div className="relative mt-1">
                <input
                  id="atlas-ai-passphrase"
                  className="w-full rounded border border-[--color-border] bg-[--color-bg] px-2 py-1 pr-7 text-[--color-text]"
                  type={showPassphrase ? 'text' : 'password'}
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  disabled={keyWorking}
                  placeholder="Passphrase"
                />
                <button
                  type="button"
                  onClick={() => setShowPassphrase((v) => !v)}
                  aria-label={showPassphrase ? 'Hide passphrase' : 'Show passphrase'}
                  className="absolute inset-y-0 right-1 flex items-center px-1 text-[--color-text-dim] hover:text-[--color-text]"
                >
                  {showPassphrase ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>
              <button
                type="button"
                className="w-full rounded bg-[--color-text] py-1 text-[10px] font-semibold text-[--color-bg] disabled:opacity-60"
                onClick={() => {
                  if (apiKey && passphrase) {
                    storeKey(provider, apiKey, passphrase)
                    setApiKey('')
                    setPassphrase('')
                  }
                }}
                disabled={keyWorking || !apiKey || !passphrase}
              >
                Save &amp; Encrypt
              </button>
            </div>
            <div className="space-y-2">
              <label htmlFor="atlas-ai-unlock" className="text-[--color-text-dim]">
                Unlock Passphrase
              </label>
              <div className="relative mt-1">
                <input
                  id="atlas-ai-unlock"
                  className="w-full rounded border border-[--color-border] bg-[--color-bg] px-2 py-1 pr-7 text-[--color-text]"
                  type={showUnlockPass ? 'text' : 'password'}
                  value={unlockPass}
                  onChange={(e) => setUnlockPass(e.target.value)}
                  disabled={keyWorking}
                  placeholder="Enter to unlock"
                />
                <button
                  type="button"
                  onClick={() => setShowUnlockPass((v) => !v)}
                  aria-label={showUnlockPass ? 'Hide passphrase' : 'Show passphrase'}
                  className="absolute inset-y-0 right-1 flex items-center px-1 text-[--color-text-dim] hover:text-[--color-text]"
                >
                  {showUnlockPass ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="flex-1 rounded bg-emerald-500 py-1 text-[10px] font-semibold text-black disabled:opacity-60"
                  onClick={() => {
                    if (unlockPass) {
                      unlockKey(unlockPass)
                      setUnlockPass('')
                    }
                  }}
                  disabled={keyWorking || !unlockPass}
                >
                  <UnlockKeyhole size={12} className="inline mr-1" /> Unlock
                </button>
                <button
                  type="button"
                  className="flex-1 rounded bg-amber-500 py-1 text-[10px] font-semibold text-black disabled:opacity-60"
                  onClick={() => lockKey()}
                  disabled={keyWorking}
                >
                  <LockKeyhole size={12} className="inline mr-1" /> Lock
                </button>
              </div>
              <p className="text-[10px] text-[--color-text-dim]">
                Keys are encrypted locally; passphrase is never stored.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {threadsCollapsed ? (
          <div className="flex w-12 flex-col items-center justify-start border-r border-[--color-border] bg-[--color-surface] py-3">
            <button
              type="button"
              onClick={toggleThreads}
              aria-label={threadsToggleLabel}
              aria-expanded={!threadsCollapsed}
              className="flex flex-col items-center gap-1 rounded border border-[--color-border] bg-[--color-bg] px-1.5 py-1 text-[10px] font-mono text-[--color-text] hover:border-[--color-border-strong]"
            >
              <ChevronRight size={14} />
              <span className="text-center text-[9px] uppercase tracking-[0.2em]">Threads</span>
            </button>
          </div>
        ) : (
          <aside className="flex w-64 min-w-[16rem] flex-col border-r border-[--color-border] bg-[--color-surface] p-3">
            <div className="mb-3 flex items-center justify-between text-xs font-mono text-[--color-text]">
              <div className="flex items-center gap-2">
                <span>Threads</span>
                <button
                  type="button"
                  onClick={toggleThreads}
                  aria-label={threadsToggleLabel}
                  aria-expanded={!threadsCollapsed}
                  className="flex h-6 w-6 items-center justify-center rounded border border-[--color-border] bg-[--color-bg] text-[--color-text] hover:border-[--color-border-strong]"
                >
                  <ChevronLeft size={12} />
                </button>
              </div>
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-[--color-text-dim]">
                <span>{threads.length} total</span>
                <button
                  type="button"
                  onClick={handleNewThread}
                  className="flex items-center gap-1 rounded border border-[--color-border] bg-[--color-bg] px-2 py-1 text-[10px] font-semibold text-[--color-text] hover:border-[--color-border-strong]"
                >
                  <Plus size={12} /> New
                </button>
              </div>
            </div>
            {loadingThreads ? (
              <div className="flex items-center gap-2 text-[11px] text-[--color-text-dim]">
                <Loader2 size={14} className="animate-spin" /> Loading threads…
              </div>
            ) : threads.length === 0 ? (
              <div className="text-[11px] text-[--color-text-dim] font-mono">
                No threads yet. Start a conversation.
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-1">
                {threads.map((t) => {
                  const isActive = t.id === activeThreadId
                  return (
                    <div
                      key={t.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => selectThread(t.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          selectThread(t.id)
                        }
                      }}
                      className={`w-full rounded border px-2 py-2 cursor-pointer outline-none ${
                        isActive
                          ? 'border-[--color-border-strong] bg-[--color-bg]'
                          : 'border-[--color-border] bg-[--color-surface]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[11px] font-mono text-[--color-text] truncate">{t.title || 'Untitled'}</div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-[--color-text-dim]">{t.message_count}</span>
                          <button
                            type="button"
                            aria-label="Delete thread"
                            onClick={(e) => handleDeleteThread(t.id, e)}
                            className="text-[--color-text-dim] hover:text-red-400"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                      <div className="text-[10px] text-[--color-text-dim] mt-1">Updated {formatTime(t.updated_at)}</div>
                    </div>
                  )
                })}
              </div>
            )}
          </aside>
        )}

        <div className="flex-1 flex flex-col">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2">
            {loadingMessages && (
              <div className="text-[11px] font-mono text-[--color-text-dim]">Loading conversation…</div>
            )}
            {!loadingMessages && messages.length === 0 && (
              <div className="text-[11px] font-mono text-[--color-text-dim]">
                Start a new thread or select an existing one. Mutating actions will ask for confirmation.
              </div>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={`rounded-md border px-3 py-2 text-xs font-mono ${
                  m.role === 'user'
                    ? 'border-[--color-border] bg-[--color-surface]'
                    : 'border-[--color-border] bg-[--color-surface-2]'
                }`}
              >
                <div className="text-[10px] uppercase tracking-wide text-[--color-text-dim] mb-1">
                  {m.role}
                  {m.created_at && (
                    <span className="ml-2 lowercase text-[--color-text-muted]">{formatTime(m.created_at)}</span>
                  )}
                </div>
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[--color-border] bg-[--color-surface] text-[--color-text-dim]">
                    {m.role === 'user' ? <User size={12} /> : <Bot size={12} />}
                  </span>
                  <AtlasAiMarkdown className="whitespace-pre-wrap leading-relaxed text-[--color-text]">
                    {m.content ?? ''}
                  </AtlasAiMarkdown>
                </div>
                {m.content && m.role === 'assistant' && (
                  <div className="mt-2 flex justify-end">
                    <CopyButton
                      variant="ghost"
                      size="xs"
                      iconSize={13}
                      text={m.content}
                      aria-label="Copy assistant response"
                    />
                  </div>
                )}
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
                  <div
                    key={`${p.name}-${idx}`}
                    className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-mono text-[--color-text]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="uppercase tracking-wide text-[10px]">{p.name}</span>
                      <button
                        type="button"
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
            <textarea
              className="flex-1 rounded border border-[--color-border] bg-[--color-surface] px-2 py-1 text-xs font-mono text-[--color-text] focus:outline-none focus:border-[--color-border-strong]"
              placeholder="Ask ATLAS-AI..."
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleDraftKeyDown}
              disabled={sending}
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || !draft.trim()}
              className="rounded bg-[--color-text] text-[--color-bg] px-2 py-1 text-xs font-mono hover:opacity-90 disabled:opacity-50"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div>
      {!hideToggle && (
        <button
          type="button"
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
      )}

      {open && (modalMode ? <div className={panelWrapperClass}>{panelInner}</div> : panelInner)}
    </div>
  )
}
