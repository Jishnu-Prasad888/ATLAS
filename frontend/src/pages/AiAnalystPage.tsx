import { useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { PageHeader } from '@/components/layout/AppLayout'
import {
  Button,
  Card,
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
  Clock,
  KeyRound,
  Loader2,
  Lock,
  PenLine,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Unlock,
  User,
} from 'lucide-react'

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
  } = useAtlasAiStore(useShallow((state) => ({
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
  })))

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

  useEffect(() => {
    refreshKeyStatus().catch(() => undefined)
    loadThreads().catch(() => undefined)
  }, [refreshKeyStatus, loadThreads])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, sending])

  const filteredThreads = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return threads
    return threads.filter((thread) => (thread.title || 'untitled thread').toLowerCase().includes(term))
  }, [threads, search])

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? null,
    [threads, activeThreadId],
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
    if (!passphraseInput.trim()) {
      setKeyFormError('Passphrase is required to encrypt the key.')
      return
    }
    if (provider === 'local' && !baseUrl.trim()) {
      setKeyFormError('Local models require an inference base URL.')
      return
    }
    await storeKey(provider, apiKeyInput.trim(), passphraseInput.trim(), {
      model: model.trim() || undefined,
      baseUrl: baseUrl.trim() || undefined,
    })
    setApiKeyInput('')
    setPassphraseInput('')
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
    await send(next, 'ai-analyst', activeThread ? { threadId: activeThread.id } : undefined)
    setDraft('')
  }

  const handleDraftKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void handleSend()
    }
  }

  const keyStatusBadge = keyLoading ? (
    <span className="inline-flex items-center gap-2 rounded-full border border-[--color-border] px-2 py-1 text-[10px] uppercase tracking-wide text-[--color-text-muted]">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…
    </span>
  ) : isUnlocked ? (
    <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] uppercase tracking-wide text-emerald-200">
      <CheckCircle2 className="h-3.5 w-3.5" /> Unlocked
    </span>
  ) : hasStoredKey ? (
    <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] uppercase tracking-wide text-amber-200">
      <Lock className="h-3.5 w-3.5" /> Locked
    </span>
  ) : (
    <span className="inline-flex items-center gap-2 rounded-full border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] uppercase tracking-wide text-red-200">
      <KeyRound className="h-3.5 w-3.5" /> Key Missing
    </span>
  )

  const isComposerDisabled = sending || !isUnlocked

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <ShieldCheck size={16} /> AI Analyst
          </span>
        }
        subtitle="Claude-inspired conversational analyst with full Atlas context"
      />

      {error && <ErrorState error={error} />}

      <div className="relative overflow-hidden rounded-3xl border border-[--color-border]/70 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.12),transparent_45%),radial-gradient(circle_at_bottom_right,rgba(167,139,250,0.12),transparent_40%)] shadow-[0_30px_120px_-60px_rgba(59,130,246,0.65)]">
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(15,23,42,0.85),rgba(17,24,39,0.6))] backdrop-blur-[2px]" />
        <div className="relative flex flex-col gap-6 p-6 lg:flex-row">
          <div className="w-full space-y-4 lg:w-80">
            <Card className="space-y-4 border-[--color-border]/80 bg-[--color-surface-2]/70 backdrop-blur">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-mono uppercase tracking-[0.4em] text-[--color-text-dim]">Access Control</p>
                  <h2 className="text-sm font-mono font-semibold text-[--color-text]">Model & API Key</h2>
                </div>
                {keyStatusBadge}
              </div>

              <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-wide text-[--color-text-muted]">Provider</label>
                    <div className="relative mt-1">
                      <select
                        value={provider}
                        onChange={(event) => setProvider(event.target.value as typeof provider)}
                        className="h-9 w-full rounded-lg border border-[--color-border] bg-[--color-surface] px-3 text-xs font-mono text-[--color-text] focus:border-blue-500 focus:outline-none"
                      >
                        <option value="openai">OpenAI</option>
                        <option value="local">Local</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-wide text-[--color-text-muted]">Model</label>
                    <Input
                      value={model}
                      onChange={(event) => setModel(event.target.value)}
                      placeholder={provider === 'openai' ? 'e.g. gpt-4o-mini' : 'e.g. llama-3'}
                      className="mt-1 h-9 text-xs"
                    />
                  </div>
                  {provider === 'local' && (
                    <div className="md:col-span-2">
                      <label className="text-[10px] font-mono uppercase tracking-wide text-[--color-text-muted]">Base URL</label>
                      <Input
                        value={baseUrl}
                        onChange={(event) => setBaseUrl(event.target.value)}
                        placeholder="https://model-host/v1"
                        className="mt-1 h-9 text-xs"
                      />
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-[10px] font-mono uppercase tracking-wide text-[--color-text-muted]">API Key</label>
                  <Input
                    type="password"
                    value={apiKeyInput}
                    onChange={(event) => setApiKeyInput(event.target.value)}
                    placeholder={provider === 'local' ? 'Optional for local deployments' : 'sk-...'}
                    className="mt-1 h-9 text-xs"
                  />
                </div>

                <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-wide text-[--color-text-muted]">Passphrase</label>
                    <Input
                      type="password"
                      value={passphraseInput}
                      onChange={(event) => setPassphraseInput(event.target.value)}
                      placeholder="Used to encrypt locally"
                      className="mt-1 h-9 text-xs"
                    />
                  </div>
                  <Button
                    variant="primary"
                    onClick={() => void handleStoreKey()}
                    disabled={keyWorking}
                    className="mt-4 md:mt-[22px]"
                  >
                    {keyWorking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Store key
                  </Button>
                </div>

                {keyFormError && (
                  <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] font-mono text-red-200">
                    {keyFormError}
                  </div>
                )}

                <div className="flex flex-col gap-3 rounded-lg border border-[--color-border] bg-[--color-surface]/70 p-3">
                  <div className="flex items-center justify-between text-[11px] font-mono text-[--color-text-muted]">
                    <span>Runtime unlock</span>
                    {unlockExpiresAt && (
                      <span className="text-[--color-text-dim]">Expires {new Date(unlockExpiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    )}
                  </div>
                  <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
                    <Input
                      type="password"
                      value={unlockInput}
                      onChange={(event) => setUnlockInput(event.target.value)}
                      placeholder="Enter passphrase to unlock"
                      className="h-9 text-xs"
                    />
                    <Button
                      variant="secondary"
                      onClick={() => void handleUnlock()}
                      disabled={keyWorking}
                      className="flex items-center justify-center gap-2"
                    >
                      <Unlock size={14} /> Unlock
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => void lockKey()}
                      disabled={keyWorking || !isUnlocked}
                      className="flex items-center justify-center gap-2 text-[--color-text-muted] hover:text-[--color-text]"
                    >
                      <Lock size={14} /> Lock
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-[--color-text-dim]">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void refreshKeyStatus()}
                      className="flex items-center gap-2 text-[--color-text-muted] hover:text-[--color-text]"
                    >
                      <RefreshCw size={14} /> Refresh status
                    </Button>
                    {keyStatus?.created_at && (
                      <span>Stored {timeAgo(keyStatus.created_at)}</span>
                    )}
                    {isUnlocked && !unlockExpiresAt && <span>Session stays unlocked until you lock it.</span>}
                  </div>
                </div>
              </div>
            </Card>

            <Card className="space-y-3 border-[--color-border]/70 bg-[--color-surface-2]/70 backdrop-blur">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.4em] text-[--color-text-dim]">Threads</p>
                  <h2 className="text-sm font-mono font-semibold text-[--color-text]">Your conversations</h2>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => loadThreads().catch(() => undefined)}
                    className="flex items-center gap-2 text-[--color-text-muted] hover:text-[--color-text]"
                  >
                    <RefreshCw size={14} />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void handleNewThread()} className="flex items-center gap-2">
                    <Plus size={14} /> New
                  </Button>
                </div>
              </div>

              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[--color-text-dim]" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search threads"
                  className="pl-9 text-xs"
                />
              </div>

              <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
                {loadingThreads ? (
                  <LoadingState label="Loading threads..." />
                ) : filteredThreads.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[--color-border] bg-[--color-surface]/60 px-3 py-6 text-center text-xs font-mono text-[--color-text-muted]">
                    No threads yet. Start a new conversation.
                  </div>
                ) : (
                  filteredThreads.map((thread) => {
                    const isActive = thread.id === activeThreadId
                    const isEditing = editingThreadId === thread.id
                    const lastUpdated = thread.updated_at ? timeAgo(thread.updated_at) : 'just now'
                    return (
                      <button
                        key={thread.id}
                        type="button"
                        onClick={() => void handleSelectThread(thread.id)}
                        className={clsx(
                          'w-full rounded-2xl border px-3 py-3 text-left transition hover:border-blue-500/60 hover:bg-[--color-surface]/60',
                          isActive
                            ? 'border-blue-500/60 bg-[linear-gradient(135deg,rgba(59,130,246,0.20),rgba(14,23,42,0.75))]' : 'border-[--color-border]/70 bg-[--color-surface-2]/60',
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          {isEditing ? (
                            <Input
                              value={editingTitle}
                              autoFocus
                              onChange={(event) => {
                                setRenameError(null)
                                setEditingTitle(event.target.value)
                              }}
                              onBlur={() => { if (!threadRenameLoading) void submitRename() }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault()
                                  void submitRename()
                                } else if (event.key === 'Escape') {
                                  abortRename()
                                }
                              }}
                              className="h-8 text-xs"
                            />
                          ) : (
                            <div className="flex flex-col">
                              <span className="text-sm font-medium text-[--color-text]">
                                {thread.title?.trim() || 'Untitled conversation'}
                              </span>
                              <span className="text-[10px] font-mono uppercase tracking-wide text-[--color-text-dim]">
                                {thread.message_count} messages · {lastUpdated}
                              </span>
                            </div>
                          )}
                          <div className="flex items-center gap-2 text-[--color-text-muted]">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 rounded-full p-0 hover:text-[--color-text]"
                              onClick={(event) => {
                                event.stopPropagation()
                                isEditing ? void submitRename() : beginRename(thread)
                              }}
                              disabled={threadRenameLoading && isEditing}
                              aria-label="Rename thread"
                            >
                              {threadRenameLoading && isEditing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PenLine size={14} />}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 rounded-full p-0 hover:text-red-400"
                              onClick={(event) => {
                                event.stopPropagation()
                                void handleDeleteThread(thread.id)
                              }}
                              aria-label="Delete thread"
                            >
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        </div>
                        {isEditing && renameError && (
                          <p className="mt-2 text-[10px] font-mono text-red-300">{renameError}</p>
                        )}
                      </button>
                    )
                  })
                )}
              </div>
            </Card>
          </div>

          <Card padding={false} className="flex min-h-[520px] flex-1 flex-col overflow-hidden rounded-3xl border-[--color-border]/70 bg-[--color-surface]/70 backdrop-blur">
            <div className="border-b border-[--color-border] px-6 py-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-[0.4em] text-[--color-text-dim]">
                    <MessageHeaderIcon />
                    <span>Conversation</span>
                  </div>
                  <h2 className="mt-1 text-lg font-mono font-semibold text-[--color-text]">
                    {activeThread?.title?.trim() || 'Untitled conversation'}
                  </h2>
                  <p className="text-[11px] font-mono text-[--color-text-muted]">
                    {activeThread ? `Last activity ${timeAgo(activeThread.updated_at)}` : 'Start by creating a thread on the left.'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void refreshKeyStatus()}
                    className="flex items-center gap-2 text-[--color-text-muted] hover:text-[--color-text]"
                  >
                    <RefreshCw size={14} /> Refresh
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleNewThread()}
                    className="flex items-center gap-2 text-[--color-text-muted] hover:text-[--color-text]"
                  >
                    <Plus size={14} /> New thread
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4" ref={scrollRef}>
              {(!hasStoredKey || !isUnlocked) && (
                <div
                  className={clsx(
                    'mb-4 rounded-2xl border px-4 py-3 text-xs font-mono',
                    hasStoredKey ? 'border-amber-500/40 bg-amber-500/10 text-amber-100' : 'border-red-500/40 bg-red-500/10 text-red-100',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <KeyRound size={14} />
                    <span>
                      {hasStoredKey
                        ? 'Unlock your key in the sidebar to send new messages.'
                        : 'Store an API key or local model credentials to start chatting.'}
                    </span>
                  </div>
                </div>
              )}

              {pending.length > 0 && (
                <div className="mb-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs font-mono text-amber-100">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="uppercase tracking-[0.3em]">Pending actions</span>
                    <span>{pending.length}</span>
                  </div>
                  <div className="space-y-2">
                    {pending.map((action, index) => (
                      <div key={`${action.name}-${index}`} className="rounded-xl border border-amber-500/30 bg-black/10 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="font-semibold text-amber-100">{action.name}</span>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void confirm(action)}
                            disabled={sending}
                            className="flex items-center gap-2"
                          >
                            <CheckCircle2 size={14} /> Confirm
                          </Button>
                        </div>
                        <pre className="max-h-40 overflow-auto rounded bg-black/20 px-2 py-1 text-[10px] text-amber-200">
                          {JSON.stringify(action.arguments, null, 2)}
                        </pre>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {loadingMessages ? (
                <LoadingState label="Loading conversation..." />
              ) : messages.length === 0 ? (
                <div className="flex h-full min-h-[280px] items-center justify-center rounded-2xl border border-dashed border-[--color-border] bg-[--color-surface-2]/40 p-8 text-center text-sm font-mono text-[--color-text-muted]">
                  {activeThread
                    ? 'No messages yet. Say hello to your analyst assistant.'
                    : 'Select a thread or create a new one to begin.'}
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {messages.map((entry) => (
                    <MessageBubble key={entry.id} entry={entry} />
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-[--color-border] bg-[--color-surface] px-6 py-4">
              <div className="rounded-2xl border border-[--color-border] bg-[--color-surface-2] p-3 shadow-inner">
                <Textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleDraftKeyDown}
                  placeholder={isUnlocked ? 'Ask Atlas anything about your fleet…' : 'Unlock your key to enable the composer.'}
                  rows={3}
                  className="resize-none border-none bg-transparent text-sm focus:outline-none"
                  spellCheck={false}
                  disabled={isComposerDisabled}
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-[10px] font-mono text-[--color-text-dim]">
                    Press <span className="rounded bg-[--color-surface] px-1">Shift</span> + <span className="rounded bg-[--color-surface] px-1">Enter</span> for a newline
                  </div>
                  <Button
                    variant="primary"
                    onClick={() => void handleSend()}
                    disabled={isComposerDisabled || !draft.trim()}
                    className="flex items-center gap-2"
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send size={16} />}
                    Send
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ entry }: { entry: ChatEntry }) {
  const isUser = entry.role === 'user'
  const createdAt = entry.created_at ? timeAgo(entry.created_at) : null

  return (
    <div className={clsx('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={clsx(
          'max-w-[min(85%,720px)] rounded-3xl border px-4 py-4 shadow-lg transition',
          isUser
            ? 'border-[--color-border]/70 bg-[linear-gradient(135deg,rgba(59,130,246,0.18),rgba(12,17,23,0.85))] text-[--color-text]'
            : 'border-[#2c3448] bg-[linear-gradient(135deg,rgba(12,19,35,0.92),rgba(20,27,43,0.88))] text-[--color-text] backdrop-blur-sm',
        )}
      >
        <div className="mb-2 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.3em] text-[--color-text-dim]">
          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[--color-border] bg-black/20 text-[--color-text]">
            {isUser ? <User size={14} /> : <Bot size={14} />}
          </span>
          <span>{entry.role}</span>
          {createdAt && <span className="lowercase text-[--color-text-muted]">{createdAt}</span>}
        </div>
        {entry.content && (
          <AtlasAiMarkdown className="space-y-3 text-sm leading-relaxed text-[--color-text]">
            {entry.content}
          </AtlasAiMarkdown>
        )}
        {entry.role === 'assistant' && entry.content && (
          <div className="mt-3 flex justify-end">
            <CopyButton
              variant="ghost"
              size="sm"
              iconSize={14}
              text={entry.content}
              aria-label="Copy assistant response"
            />
          </div>
        )}
      </div>
    </div>
  )
}

function MessageHeaderIcon() {
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full border border-[--color-border] bg-[--color-surface] text-[--color-text]">
      <Clock size={14} />
    </span>
  )
}

export default AiAnalystPage
