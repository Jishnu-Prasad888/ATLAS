'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import {
  Button,
  Input,
  Textarea,
  LoadingState,
  ErrorState,
  CopyButton,
} from '@/components/common'
import { AtlasAiMarkdown } from '@/components/atlasAi/Markdown'
import { useAtlasAiStore, type ChatEntry } from '@/store/atlasAiStore'
import { useShallow } from 'zustand/react/shallow'
import { timeAgo } from '@/utils'
import type { AtlasAiThread } from '@/api'
import {
  Bot,
  CheckCircle2,
  ChevronLeft,
  Lock,
  Loader2,
  Menu,
  Plus,
  Search,
  Send,
  Settings,
  Trash2,
  Unlock,
  User,
  X,
  PenLine,
  RefreshCw,
  KeyRound,
} from 'lucide-react'
import { useUiStore } from '@/store/uiStore'

export function AiAnalystPage() {
  const {
    threads,
    activeThreadId,
    messages,
    pending,
    sending,
    error,
    keyStatus,
    keyLoading,
    keyWorking,
    loadingThreads,
    loadingMessages,
    threadRenameLoading,
    provider,
    model,
    baseUrl,
    loadThreads,
    selectThread,
    startThread,
    deleteThread,
    renameThread,
    refreshKeyStatus,
    storeKey,
    unlockKey,
    lockKey,
    send,
    confirm,
    setProvider,
    setModel,
    setBaseUrl,
    panelOpen,
    panelWidth,
  } = useAtlasAiStore(
    useShallow((state) => ({
      threads: state.threads,
      activeThreadId: state.activeThreadId,
      messages: state.messages,
      pending: state.pending,
      sending: state.sending,
      error: state.error,
      keyStatus: state.keyStatus,
      keyLoading: state.keyLoading,
      keyWorking: state.keyWorking,
      loadingThreads: state.loadingThreads,
      loadingMessages: state.loadingMessages,
      threadRenameLoading: state.threadRenameLoading,
      provider: state.provider,
      model: state.model,
      baseUrl: state.baseUrl,
      loadThreads: state.loadThreads,
      selectThread: state.selectThread,
      startThread: state.startThread,
      deleteThread: state.deleteThread,
      renameThread: state.renameThread,
      refreshKeyStatus: state.refreshKeyStatus,
      storeKey: state.storeKey,
      unlockKey: state.unlockKey,
      lockKey: state.lockKey,
      send: state.send,
      confirm: state.confirm,
      setProvider: state.setProvider,
      setModel: state.setModel,
      setBaseUrl: state.setBaseUrl,
      panelOpen: state.open,
      panelWidth: state.panelWidth,
    }))
  )

  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState('')
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [passphraseInput, setPassphraseInput] = useState('')
  const [unlockInput, setUnlockInput] = useState('')
  const [keyFormError, setKeyFormError] = useState<string | null>(null)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const [isMounted, setIsMounted] = useState(false)
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed)

  const openSettings = useCallback(() => {
    setKeyFormError(null)
    setSettingsOpen(true)
  }, [setKeyFormError, setSettingsOpen])

  const closeSettings = useCallback(() => {
    setSettingsOpen(false)
    setKeyFormError(null)
  }, [setKeyFormError, setSettingsOpen])

  useEffect(() => {
    refreshKeyStatus().catch(() => undefined)
    loadThreads().catch(() => undefined)
  }, [refreshKeyStatus, loadThreads])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, sending])

  useEffect(() => {
    setIsMounted(true)
    return () => setIsMounted(false)
  }, [])

  useEffect(() => {
    if (!settingsOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [settingsOpen])

  useEffect(() => {
    if (!settingsOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeSettings()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [settingsOpen, closeSettings])

  const filteredThreads = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return threads
    return threads.filter((thread) =>
      (thread.title || 'untitled thread').toLowerCase().includes(term)
    )
  }, [threads, search])

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? null,
    [threads, activeThreadId]
  )

  const hasStoredKey = Boolean(keyStatus?.hasKey)
  const isUnlocked = Boolean(keyStatus?.unlocked)
  const unlockExpiresAt = keyStatus?.unlock_expires_at

  const beginRename = (thread: AtlasAiThread) => {
    setRenameError(null)
    setEditingThreadId(thread.id)
    setEditingTitle(thread.title || '')
  }

  const abortRename = () => {
    setEditingThreadId(null)
    setEditingTitle('')
    setRenameError(null)
  }

  const submitRename = async () => {
    if (!editingThreadId) return
    const nextTitle = editingTitle.trim()
    const original = threads.find((t) => t.id === editingThreadId)
    if (!original) {
      abortRename()
      return
    }
    if (!nextTitle) {
      setRenameError('Thread title cannot be empty.')
      return
    }
    if (nextTitle === (original.title || '')) {
      abortRename()
      return
    }
    setRenameError(null)
    await renameThread(editingThreadId, nextTitle)
    abortRename()
  }

  const handleDeleteThread = async (threadId: string) => {
    if (!window.confirm('Delete this thread? This cannot be undone.')) return
    await deleteThread(threadId)
    if (editingThreadId === threadId) {
      abortRename()
    }
  }

  const handleNewThread = async () => {
    abortRename()
    const id = await startThread()
    if (id) {
      await selectThread(id)
      setDraft('')
    }
  }

  const handleSelectThread = async (threadId: string) => {
    abortRename()
    await selectThread(threadId)
  }

  const handleStoreKey = async () => {
    setKeyFormError(null)
    const trimmedKey = apiKeyInput.trim()
    const trimmedPass = passphraseInput.trim()
    if (!trimmedKey) {
      setKeyFormError('API key is required to store credentials.')
      return
    }
    if (!trimmedPass) {
      setKeyFormError('Passphrase is required to encrypt the key.')
      return
    }
    if (provider === 'local' && !baseUrl.trim()) {
      setKeyFormError('Local models require an inference base URL.')
      return
    }
    await storeKey(provider, trimmedKey, trimmedPass, {
      model: model.trim() || undefined,
      baseUrl: baseUrl.trim() || undefined,
    })
    setApiKeyInput('')
    setPassphraseInput('')
    closeSettings()
  }

  const handleUnlock = async () => {
    setKeyFormError(null)
    if (!unlockInput.trim()) {
      setKeyFormError('Enter the passphrase you used when storing the key.')
      return
    }
    await unlockKey(unlockInput.trim())
    setUnlockInput('')
  }

  const handleSend = async () => {
    const next = draft.trim()
    if (!next) return
    await send(
      next,
      'ai-analyst',
      activeThread ? { threadId: activeThread.id } : undefined
    )
    setDraft('')
  }

  const handleDraftKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void handleSend()
    }
  }

  const isComposerDisabled = sending || !isUnlocked
  const layoutLeft = sidebarCollapsed ? 48 : 176
  const layoutRight = panelOpen ? panelWidth + 24 : 0

  if (!isMounted) return null

  return createPortal(
    <div
      className="fixed inset-y-0 z-30 flex overflow-hidden bg-zinc-950"
      style={{ left: layoutLeft, right: layoutRight }}
    >
      {/* Sidebar */}
      <div
        className={clsx(
          'flex flex-col border-r border-zinc-800 bg-zinc-900 transition-all duration-300 ease-out overflow-hidden',
          sidebarOpen ? 'w-64' : 'w-0'
        )}
      >
        {/* Sidebar Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-4 flex-shrink-0">
          <h1 className="text-sm font-semibold text-white">Conversations</h1>
          <button
            onClick={() => setSidebarOpen(false)}
            className="text-zinc-400 hover:text-zinc-200"
            aria-label="Close sidebar"
          >
            <ChevronLeft size={18} />
          </button>
        </div>

        {/* New Thread Button */}
        <div className="border-b border-zinc-800 px-3 py-3 flex-shrink-0">
          <button
            onClick={() => void handleNewThread()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-800 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-700"
          >
            <Plus size={16} /> New chat
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-zinc-800 px-3 py-3 flex-shrink-0">
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 py-2 pl-9 pr-3 text-sm text-white placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
            />
          </div>
        </div>

        {/* Threads List */}
        <div className="flex-1 overflow-y-auto">
          {loadingThreads ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={18} className="animate-spin text-zinc-500" />
            </div>
          ) : filteredThreads.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-zinc-500">
              {search ? 'No conversations found.' : 'No conversations yet.'}
            </div>
          ) : (
            <div className="space-y-2 p-3">
              {filteredThreads.map((thread) => {
                const isActive = thread.id === activeThreadId
                const isEditing = editingThreadId === thread.id

                return (
                  <div key={thread.id}>
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editingTitle}
                          autoFocus
                          onChange={(e) => {
                            setRenameError(null)
                            setEditingTitle(e.target.value)
                          }}
                          onBlur={() => {
                            if (!threadRenameLoading) void submitRename()
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              void submitRename()
                            } else if (e.key === 'Escape') {
                              abortRename()
                            }
                          }}
                          className="flex-1 rounded-lg border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs text-white focus:outline-none"
                        />
                        <button
                          onClick={() => void submitRename()}
                          disabled={threadRenameLoading}
                          className="text-zinc-400 hover:text-white disabled:opacity-50"
                        >
                          {threadRenameLoading ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <CheckCircle2 size={14} />
                          )}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => void handleSelectThread(thread.id)}
                        className={clsx(
                          'group relative w-full overflow-hidden rounded-lg px-3 py-2 text-left text-sm transition',
                          isActive
                            ? 'bg-zinc-700 text-white'
                            : 'text-zinc-300 hover:bg-zinc-800'
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">
                              {thread.title?.trim() || 'Untitled conversation'}
                            </p>
                            <p className="truncate text-xs text-zinc-500">
                              {thread.message_count} messages
                            </p>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                beginRename(thread)
                              }}
                              className="rounded p-1 hover:bg-zinc-600"
                              aria-label="Rename"
                            >
                              <PenLine size={12} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                void handleDeleteThread(thread.id)
                              }}
                              className="rounded p-1 hover:bg-red-500/20 hover:text-red-400"
                              aria-label="Delete"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                        {renameError && isEditing && (
                          <p className="mt-1 text-xs text-red-400">{renameError}</p>
                        )}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-6 py-4 flex-shrink-0">
          <div className="flex items-center gap-4 min-w-0">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="text-zinc-400 hover:text-white flex-shrink-0"
                aria-label="Open sidebar"
              >
                <Menu size={20} />
              </button>
            )}
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-white truncate">
                {activeThread?.title?.trim() || 'AI Analyst'}
              </h1>
              <p className="text-xs text-zinc-500 truncate">
                {activeThread
                  ? `Last activity ${timeAgo(activeThread.updated_at)}`
                  : 'Select a conversation or start a new one'}
              </p>
            </div>
          </div>
          <button
            onClick={openSettings}
            className="text-zinc-400 transition hover:text-white flex-shrink-0 ml-4"
            aria-label="Settings"
          >
            <Settings size={20} />
          </button>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto px-6 py-6 min-h-0" ref={scrollRef}>
          {error && (
            <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              <p className="font-semibold">Error</p>
              <p className="mt-1">{error}</p>
            </div>
          )}

          {(!hasStoredKey || !isUnlocked) && (
            <div
              className={clsx(
                'mb-4 rounded-lg border px-4 py-3 text-sm',
                hasStoredKey
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                  : 'border-red-500/40 bg-red-500/10 text-red-300'
              )}
            >
              <div className="flex items-center gap-2">
                <KeyRound size={16} />
                <span>
                  {hasStoredKey
                    ? 'Unlock your key in settings to send messages.'
                    : 'Store an API key in settings to start chatting.'}
                </span>
              </div>
            </div>
          )}

          {pending.length > 0 && (
            <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
              <div className="mb-3 flex items-center justify-between">
                <span className="font-semibold text-amber-300">Pending Actions</span>
                <span className="text-xs text-amber-300">({pending.length})</span>
              </div>
              <div className="space-y-2">
                {pending.map((action, idx) => (
                  <div
                    key={`${action.name}-${idx}`}
                    className="rounded-lg border border-amber-500/20 bg-black/20 p-3"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-amber-200">
                        {action.name}
                      </span>
                      <button
                        onClick={() => void confirm(action)}
                        disabled={sending}
                        className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Confirm
                      </button>
                    </div>
                    <pre className="max-h-32 overflow-auto rounded bg-black/40 px-2 py-1 text-[10px] text-amber-100">
                      {JSON.stringify(action.arguments, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          )}

          {loadingMessages ? (
            <div className="flex h-96 items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <Loader2
                  size={28}
                  className="animate-spin text-zinc-500"
                />
                <p className="text-sm text-zinc-500">Loading conversation...</p>
              </div>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-96 items-center justify-center rounded-lg border border-dashed border-zinc-700 bg-zinc-800/50">
              <div className="text-center">
                <p className="text-sm font-medium text-zinc-300">
                  {activeThread
                    ? 'No messages yet'
                    : 'Select a conversation to get started'}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {activeThread && 'Say hello to start chatting'}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((entry) => (
                <ChatMessage key={entry.id} entry={entry} />
              ))}
              {sending && <TypingIndicator />}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-zinc-800 px-6 py-4 bg-zinc-900 flex-shrink-0">
          <div className="space-y-2">
            <div className="relative rounded-xl border border-zinc-700 bg-zinc-800">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleDraftKeyDown}
                placeholder={
                  isUnlocked
                    ? 'Ask anything about your fleet…'
                    : 'Unlock your key to chat'
                }
                disabled={isComposerDisabled}
                rows={3}
                className="w-full resize-none border-none bg-transparent px-4 py-3 pr-24 text-sm text-white placeholder-zinc-500 focus:outline-none disabled:opacity-50"
                spellCheck={false}
              />
              <button
                onClick={() => void handleSend()}
                disabled={isComposerDisabled || !draft.trim()}
                className="absolute bottom-3 right-3 flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-40"
              >
                {sending ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send size={16} />
                    Send
                  </>
                )}
              </button>
            </div>
            <p className="text-xs text-zinc-500">
              <span className="rounded bg-zinc-800 px-1.5 py-0.5">Shift</span> +{' '}
              <span className="rounded bg-zinc-800 px-1.5 py-0.5">Enter</span> for new line
            </p>
          </div>
        </div>
      </div>
      {settingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={closeSettings}
        >
          <div
            className="relative w-full max-w-3xl overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-white">ATLAS-AI Settings</h2>
                <p className="mt-1 text-xs text-zinc-500">Manage encrypted keys and runtime options.</p>
              </div>
              <button
                onClick={closeSettings}
                className="rounded-full p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
                aria-label="Close settings"
              >
                <X size={18} />
              </button>
            </div>
            <div className="max-h-[80vh] overflow-y-auto px-6 py-6 space-y-6">
              <section className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Key Status</p>
                <div className="flex flex-wrap items-center gap-3">
                  {keyLoading ? (
                    <span className="flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300">
                      <Loader2 size={14} className="animate-spin" />
                      Checking...
                    </span>
                  ) : isUnlocked ? (
                    <span className="flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300">
                      <CheckCircle2 size={14} />
                      Unlocked
                    </span>
                  ) : hasStoredKey ? (
                    <span className="flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300">
                      <Lock size={14} />
                      Locked
                    </span>
                  ) : (
                    <span className="flex items-center gap-2 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs text-red-300">
                      <KeyRound size={14} />
                      No Key
                    </span>
                  )}
                  <button
                    onClick={() => void refreshKeyStatus()}
                    className="flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-700"
                  >
                    <RefreshCw size={14} /> Refresh
                  </button>
                </div>
              </section>

              {keyFormError && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {keyFormError}
                </div>
              )}

              <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
                <div className="flex items-center justify-between gap-4">
                  <h3 className="text-sm font-semibold text-white">Unlock Key</h3>
                  {unlockExpiresAt && (
                    <span className="text-xs text-zinc-400">
                      Expires {new Date(unlockExpiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
                <div className="space-y-3">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Passphrase
                  </label>
                  <input
                    type="password"
                    value={unlockInput}
                    onChange={(e) => setUnlockInput(e.target.value)}
                    placeholder="Enter passphrase"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
                  />
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      onClick={() => void handleUnlock()}
                      disabled={keyWorking || !hasStoredKey}
                      className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {keyWorking ? (
                        <span className="flex items-center justify-center gap-2">
                          <Loader2 size={14} className="animate-spin" />
                          Working...
                        </span>
                      ) : (
                        <span className="flex items-center justify-center gap-2">
                          <Unlock size={14} /> Unlock
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => void lockKey()}
                      disabled={keyWorking || !isUnlocked}
                      className="flex-1 rounded-lg bg-zinc-800 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-50"
                    >
                      <span className="flex items-center justify-center gap-2">
                        <Lock size={14} /> Lock
                      </span>
                    </button>
                  </div>
                </div>
              </section>

              <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
                <h3 className="text-sm font-semibold text-white">Store API Key</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      Provider
                    </label>
                    <select
                      value={provider}
                      onChange={(e) => setProvider(e.target.value as typeof provider)}
                      className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:border-zinc-600 focus:outline-none"
                    >
                      <option value="openai">OpenAI</option>
                      <option value="local">Local</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      Model
                    </label>
                    <input
                      type="text"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder={provider === 'openai' ? 'e.g. gpt-4o-mini' : 'e.g. llama-3'}
                      className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
                    />
                  </div>
                </div>
                {provider === 'local' && (
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      Base URL
                    </label>
                    <input
                      type="text"
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      placeholder="https://model-host/v1"
                      className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
                    />
                  </div>
                )}
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      API Key
                    </label>
                    <input
                      type="password"
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder="sk-..."
                      className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      Passphrase (to encrypt key)
                    </label>
                    <input
                      type="password"
                      value={passphraseInput}
                      onChange={(e) => setPassphraseInput(e.target.value)}
                      placeholder="Enter a secure passphrase"
                      className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
                    />
                  </div>
                  <button
                    onClick={() => void handleStoreKey()}
                    disabled={
                      keyWorking ||
                      !apiKeyInput.trim() ||
                      !passphraseInput.trim() ||
                      (provider === 'local' && !baseUrl.trim())
                    }
                    className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
                  >
                    {keyWorking ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 size={14} className="animate-spin" />
                        Storing...
                      </span>
                    ) : (
                      'Store Key'
                    )}
                  </button>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}

function ChatMessage({ entry }: { entry: ChatEntry }) {
  const isUser = entry.role === 'user'
  const createdAt = entry.created_at ? timeAgo(entry.created_at) : null

  return (
    <div className={clsx('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={clsx(
          'max-w-2xl rounded-lg px-4 py-3',
          isUser
            ? 'rounded-br-none bg-blue-600 text-white'
            : 'rounded-bl-none border border-zinc-700 bg-zinc-800 text-zinc-100'
        )}
      >
        <div className="mb-2 flex items-center gap-2 text-xs text-zinc-400">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-700">
            {isUser ? (
              <User size={12} />
            ) : (
              <Bot size={12} className="text-blue-400" />
            )}
          </span>
          <span className="capitalize">{entry.role}</span>
          {createdAt && <span className="text-zinc-500">{createdAt}</span>}
        </div>
        {entry.content && (
          <div className="prose prose-invert max-w-none space-y-2 text-sm">
            <AtlasAiMarkdown>{entry.content}</AtlasAiMarkdown>
          </div>
        )}
        {entry.role === 'assistant' && entry.content && (
          <div className="mt-2 flex justify-end">
            <CopyButton
              variant="ghost"
              size="sm"
              iconSize={14}
              text={entry.content}
              aria-label="Copy"
              className="text-zinc-400 hover:text-white"
            />
          </div>
        )}
      </div>
    </div>
  )
}

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800">
        <Bot size={14} className="text-blue-400" />
      </div>
      <div className="flex gap-1 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3">
        <div className="h-2 w-2 animate-bounce rounded-full bg-zinc-500" />
        <div
          className="h-2 w-2 animate-bounce rounded-full bg-zinc-500"
          style={{ animationDelay: '0.1s' }}
        />
        <div
          className="h-2 w-2 animate-bounce rounded-full bg-zinc-500"
          style={{ animationDelay: '0.2s' }}
        />
      </div>
    </div>
  )
}

export default AiAnalystPage
