import React, { useCallback, useMemo, useRef, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ListRenderItemInfo,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import * as SecureStore from 'expo-secure-store'
import { Send, Settings as SettingsIcon } from 'lucide-react-native'
import {
  commanderApi,
  type CommanderMessage,
  type CommanderMessageRole,
  type CommanderResponse,
} from '@/api/endpoints'
import { useTheme } from '@/theme'
import { Card, MonoText, EmptyState } from '@/components/common'

type CommanderTurn = CommanderResponse['transcript'][number]

interface ChatItem {
  id: string
  role: CommanderMessageRole
  content?: string
}

const SYSTEM_PROMPT: CommanderMessage = {
  role: 'system',
  content:
    'You are ATLAS-AI, a role-aware assistant for Beacon mobile. Provide concise answers, surface anomalies, and reference agents or logs precisely. When unsure, state the limitation.',
}

const ROLE_LABEL: Record<CommanderMessageRole, string> = {
  system: 'system',
  user: 'you',
  assistant: 'atlas-ai',
  tool: 'tool',
}

const SETTINGS_KEY = 'atlas_ai_settings_v1'

interface StoredSettings {
  provider: 'openai' | 'local'
  apiKey: string
  baseUrl?: string
  model?: string
  passphrase?: string
}

function toCommanderMessages(transcript: CommanderTurn[]): CommanderMessage[] {
  return transcript
    .filter((turn) => turn.role === 'user' || turn.role === 'assistant' || turn.role === 'tool')
    .map((turn) => ({
      role: turn.role as CommanderMessageRole,
      content: turn.content ?? undefined,
      name: turn.name,
      tool_call_id: turn.tool_call_id,
      tool_calls: turn.tool_calls,
    }))
}

function renderBubble(role: CommanderMessageRole, content: string | undefined, palette: ReturnType<typeof useTheme>['palette']) {
  const isUser = role === 'user'
  const background = isUser ? palette.primary : palette.surface
  const border = isUser ? palette.primary : palette.border
  const color = isUser ? '#0b111b' : palette.text

  return {
    container: {
      alignSelf: isUser ? 'flex-end' as const : 'flex-start' as const,
      maxWidth: '85%' as const,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 14,
      borderWidth: 1,
      backgroundColor: `${background}${isUser ? '' : ''}`,
      borderColor: border,
    },
    textStyle: {
      color,
      fontSize: 13,
      lineHeight: 18,
      fontFamily: 'SpaceMono-Regular',
    },
  }
}

export function AiAnalystScreen() {
  const { palette: c } = useTheme()
  const listRef = useRef<FlatList<ChatItem>>(null)
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<CommanderMessage[]>([])
  const [transcript, setTranscript] = useState<ChatItem[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settingsVisible, setSettingsVisible] = useState(false)
  const [storedSettings, setStoredSettings] = useState<StoredSettings | null>(null)
  const [isUnlocked, setIsUnlocked] = useState(false)
  const [runtimeKey, setRuntimeKey] = useState<string | null>(null)
  const [providerInput, setProviderInput] = useState<StoredSettings['provider']>('openai')
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [modelInput, setModelInput] = useState('')
  const [baseUrlInput, setBaseUrlInput] = useState('')
  const [passphraseInput, setPassphraseInput] = useState('')
  const [unlockInput, setUnlockInput] = useState('')

  React.useEffect(() => {
    let cancelled = false
    SecureStore.getItemAsync(SETTINGS_KEY)
      .then((raw) => {
        if (!raw || cancelled) return
        try {
          const parsed = JSON.parse(raw) as StoredSettings
          setStoredSettings(parsed)
          setProviderInput(parsed.provider)
          setModelInput(parsed.model ?? '')
          setBaseUrlInput(parsed.baseUrl ?? '')
        } catch {
          // ignore parse errors
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [])

  const scrollToEnd = useCallback(() => {
    setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true })
    }, 120)
  }, [])

  const handleStoreCredentials = useCallback(async () => {
    const key = apiKeyInput.trim()
    if (!key) {
      Alert.alert('Missing API key', 'Enter an API key before storing.')
      return
    }
    if (providerInput === 'local' && !baseUrlInput.trim()) {
      Alert.alert('Base URL required', 'Local providers require an inference base URL.')
      return
    }

    const payload: StoredSettings = {
      provider: providerInput,
      apiKey: key,
      model: modelInput.trim() || undefined,
      baseUrl: baseUrlInput.trim() || undefined,
      passphrase: passphraseInput.trim() || undefined,
    }

    try {
      await SecureStore.setItemAsync(SETTINGS_KEY, JSON.stringify(payload))
      setStoredSettings(payload)
      setIsUnlocked(false)
      setRuntimeKey(null)
      setApiKeyInput('')
      setPassphraseInput('')
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      Alert.alert('Saved', 'API key stored securely.')
      setSettingsVisible(false)
    } catch (err) {
      Alert.alert('Save failed', err instanceof Error ? err.message : 'Unable to store API key.')
    }
  }, [apiKeyInput, baseUrlInput, modelInput, passphraseInput, providerInput])

  const handleUnlockKey = useCallback(async () => {
    if (!storedSettings) {
      Alert.alert('No key stored', 'Store an API key first.')
      return
    }
    if (storedSettings.passphrase) {
      if (storedSettings.passphrase !== unlockInput.trim()) {
        Alert.alert('Incorrect passphrase', 'The provided passphrase does not match.')
        return
      }
    }
    setRuntimeKey(storedSettings.apiKey)
    setIsUnlocked(true)
    setUnlockInput('')
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    setSettingsVisible(false)
  }, [storedSettings, unlockInput])

  const handleLockKey = useCallback(() => {
    setRuntimeKey(null)
    setIsUnlocked(false)
    Haptics.selectionAsync()
  }, [])

  const handleClearCredentials = useCallback(async () => {
    await SecureStore.deleteItemAsync(SETTINGS_KEY)
    setStoredSettings(null)
    setIsUnlocked(false)
    setRuntimeKey(null)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
    Alert.alert('Cleared', 'Stored API credentials removed.')
    setSettingsVisible(false)
  }, [])

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed || sending) return

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setInput('')
    setSending(true)
    setError(null)

    const optimisticHistory: CommanderMessage[] = [...history, { role: 'user', content: trimmed }]
    const optimisticTranscript: ChatItem[] = [...transcript, {
      id: `${Date.now()}-user`,
      role: 'user',
      content: trimmed,
    }]
    setHistory(optimisticHistory)
    setTranscript(optimisticTranscript)
    scrollToEnd()

    try {
      const { data: response } = await commanderApi.chat({
        messages: [SYSTEM_PROMPT, ...optimisticHistory],
        provider: storedSettings?.provider,
        apiKey: isUnlocked ? (runtimeKey ?? storedSettings?.apiKey) : undefined,
        model: storedSettings?.model,
        baseUrl: storedSettings?.baseUrl,
      })
      const turns = response.transcript.filter((turn) => turn.role !== 'system')
      const nextHistory = toCommanderMessages(response.transcript)
      setHistory(nextHistory)
      const mapped: ChatItem[] = turns.map((turn: CommanderTurn, index: number) => ({
        id: `turn-${index}-${Date.now()}`,
        role: turn.role as CommanderMessageRole,
        content: turn.content ?? undefined,
      }))
      setTranscript(mapped)
      scrollToEnd()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Commander request failed'
      setError(message)
      Alert.alert('Commander Error', message)
      // rollback optimistic user message
      setTranscript((prev) => prev.slice(0, Math.max(0, prev.length - 1)))
      setHistory((prev) => prev.slice(0, Math.max(0, prev.length - 1)))
    } finally {
      setSending(false)
    }
  }, [history, input, scrollToEnd, sending, storedSettings, isUnlocked, runtimeKey, transcript])

  const handleReset = useCallback(() => {
    setHistory([])
    setTranscript([])
    setError(null)
    Haptics.selectionAsync()
  }, [])

  const renderItem = useCallback(({ item }: ListRenderItemInfo<ChatItem>) => {
    const styles = renderBubble(item.role, item.content, c)
    const label = ROLE_LABEL[item.role] ?? item.role
    return (
      <View style={{ marginBottom: 12 }}>
        <MonoText size={10} color={c.textMuted} style={{ marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
          {label}
        </MonoText>
        <View style={styles.container}>
          <Text style={styles.textStyle}>
            {item.content || '…'}
          </Text>
        </View>
      </View>
    )
  }, [c])

  const headerContent = useMemo(() => (
    <View style={{ gap: 12 }}>
      <Text style={{ color: c.text, fontSize: 18, fontFamily: 'SpaceMono-Regular', fontWeight: '700' }}>
        atlas-ai analyst
      </Text>
      <MonoText size={11} color={c.textMuted}>
        Ask about agents, telemetry, or incidents. Responses stay on-device unless you provide an external API key.
      </MonoText>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <MonoText size={10} color={c.textMuted}>
          {storedSettings ? (isUnlocked ? 'Key unlocked' : 'Key locked') : 'No key stored'}
        </MonoText>
        <TouchableOpacity onPress={() => setSettingsVisible(true)} style={{ padding: 4 }}>
          <SettingsIcon size={16} color={c.textMuted} />
        </TouchableOpacity>
      </View>
      {error && (
        <Text style={{ color: c.danger, fontSize: 11, fontFamily: 'SpaceMono-Regular' }}>
          {error}
        </Text>
      )}
    </View>
  ), [c, error, isUnlocked, storedSettings])

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={{ flex: 1 }}>
        <FlatList
          ref={listRef}
          contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
          data={transcript}
          extraData={transcript.length}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ListHeaderComponent={
            <Card>
              {headerContent}
            </Card>
          }
          ListEmptyComponent={
            <View style={{ marginTop: 32 }}>
              <EmptyState label="No conversations yet" detail="Ask a question to get started." />
            </View>
          }
        />

        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            paddingHorizontal: 16,
            paddingVertical: 12,
            backgroundColor: c.surface,
            borderTopWidth: 1,
            borderTopColor: c.border,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Ask Atlas-AI…"
              placeholderTextColor={c.textMuted}
              multiline
              style={{
                flex: 1,
                minHeight: 44,
                maxHeight: 120,
                paddingHorizontal: 12,
                paddingVertical: 10,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: c.inputBorder,
                backgroundColor: c.inputBg,
                color: c.text,
                fontFamily: 'SpaceMono-Regular',
                fontSize: 13,
              }}
              onSubmitEditing={sendMessage}
              returnKeyType="send"
              blurOnSubmit={false}
            />
            <TouchableOpacity
              onPress={sendMessage}
              disabled={sending}
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                backgroundColor: sending ? c.border : c.primary,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {sending ? (
                <ActivityIndicator color={c.text} />
              ) : (
                <Send size={18} color="#0b111b" />
              )}
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
            <TouchableOpacity onPress={handleReset}>
              <MonoText size={10} color={c.textMuted}>
                Reset conversation
              </MonoText>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <Modal
        visible={settingsVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSettingsVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: '#00000099', justifyContent: 'flex-end' }}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setSettingsVisible(false)} />
          <View style={{ backgroundColor: c.surface, padding: 16, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: c.border, gap: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <MonoText size={14} color={c.text} style={{ fontWeight: '700' }}>AI Settings</MonoText>
              <TouchableOpacity onPress={() => setSettingsVisible(false)}>
                <MonoText size={11} color={c.textMuted}>Dismiss</MonoText>
              </TouchableOpacity>
            </View>

            <View style={{ gap: 8 }}>
              <MonoText size={11} color={c.textMuted} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>Provider</MonoText>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(['openai', 'local'] as const).map((provider) => {
                  const active = providerInput === provider
                  return (
                    <TouchableOpacity
                      key={provider}
                      onPress={() => setProviderInput(provider)}
                      style={{
                        flex: 1,
                        paddingVertical: 10,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: active ? c.primary : c.border,
                        backgroundColor: active ? c.primary + '22' : c.surface2,
                        alignItems: 'center',
                      }}
                    >
                      <MonoText size={12} color={active ? c.primary : c.text}>{provider.toUpperCase()}</MonoText>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </View>

            <View style={{ gap: 8 }}>
              <MonoText size={11} color={c.textMuted} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>API key</MonoText>
              <TextInput
                value={apiKeyInput}
                onChangeText={setApiKeyInput}
                placeholder={storedSettings ? '••••••••••••••••' : 'sk-...'}
                placeholderTextColor={c.textMuted}
                secureTextEntry
                style={{
                  borderWidth: 1,
                  borderColor: c.inputBorder,
                  backgroundColor: c.inputBg,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: 12,
                  color: c.text,
                  fontFamily: 'SpaceMono-Regular',
                  fontSize: 13,
                }}
              />
            </View>

            <View style={{ gap: 8 }}>
              <MonoText size={11} color={c.textMuted} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>Model</MonoText>
              <TextInput
                value={modelInput}
                onChangeText={setModelInput}
                placeholder="gpt-4o-mini"
                placeholderTextColor={c.textMuted}
                style={{
                  borderWidth: 1,
                  borderColor: c.inputBorder,
                  backgroundColor: c.inputBg,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: 12,
                  color: c.text,
                  fontFamily: 'SpaceMono-Regular',
                  fontSize: 13,
                }}
              />
            </View>

            {providerInput === 'local' && (
              <View style={{ gap: 8 }}>
                <MonoText size={11} color={c.textMuted} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>Base URL</MonoText>
                <TextInput
                  value={baseUrlInput}
                  onChangeText={setBaseUrlInput}
                  placeholder="http://localhost:11434"
                  placeholderTextColor={c.textMuted}
                  autoCapitalize="none"
                  style={{
                    borderWidth: 1,
                    borderColor: c.inputBorder,
                    backgroundColor: c.inputBg,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    borderRadius: 12,
                    color: c.text,
                    fontFamily: 'SpaceMono-Regular',
                    fontSize: 13,
                  }}
                />
              </View>
            )}

            <View style={{ gap: 8 }}>
              <MonoText size={11} color={c.textMuted} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>Passphrase (optional)</MonoText>
              <TextInput
                value={passphraseInput}
                onChangeText={setPassphraseInput}
                placeholder="Enter a passphrase to require unlock"
                placeholderTextColor={c.textMuted}
                secureTextEntry
                style={{
                  borderWidth: 1,
                  borderColor: c.inputBorder,
                  backgroundColor: c.inputBg,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: 12,
                  color: c.text,
                  fontFamily: 'SpaceMono-Regular',
                  fontSize: 13,
                }}
              />
            </View>

            <TouchableOpacity
              onPress={handleStoreCredentials}
              style={{
                paddingVertical: 12,
                borderRadius: 12,
                backgroundColor: c.primary,
                alignItems: 'center',
              }}
            >
              <MonoText size={13} color="#0b111b" style={{ fontWeight: '700' }}>Store credentials</MonoText>
            </TouchableOpacity>

            {storedSettings && (
              <View style={{ gap: 12 }}>
                <View style={{ gap: 6 }}>
                  <MonoText size={11} color={c.textMuted} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>Unlock with passphrase</MonoText>
                  <TextInput
                    value={unlockInput}
                    onChangeText={setUnlockInput}
                    placeholder="Enter passphrase"
                    placeholderTextColor={c.textMuted}
                    secureTextEntry
                    style={{
                      borderWidth: 1,
                      borderColor: c.inputBorder,
                      backgroundColor: c.inputBg,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      borderRadius: 12,
                      color: c.text,
                      fontFamily: 'SpaceMono-Regular',
                      fontSize: 13,
                    }}
                  />
                </View>

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity
                    onPress={handleUnlockKey}
                    style={{ flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: c.success, backgroundColor: c.success + '22', alignItems: 'center' }}
                  >
                    <MonoText size={12} color={c.success}>Unlock</MonoText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleLockKey}
                    style={{ flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: c.warning, backgroundColor: c.warning + '22', alignItems: 'center' }}
                  >
                    <MonoText size={12} color={c.warning}>Lock</MonoText>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  onPress={handleClearCredentials}
                  style={{ paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: c.danger, backgroundColor: c.danger + '22', alignItems: 'center' }}
                >
                  <MonoText size={12} color={c.danger}>Remove stored key</MonoText>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  )
}

export default AiAnalystScreen
