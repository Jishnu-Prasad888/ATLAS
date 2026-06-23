import React, { useCallback, useMemo, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import { aiApi, type AiRunPayload, type AiRunResponse } from '@/api/endpoints'
import { useTheme } from '@/theme'
import { Card, MonoText } from '@/components/common'

function parseJson<T>(label: string, value: string): T | undefined {
  if (!value.trim()) return undefined
  try {
    return JSON.parse(value) as T
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Invalid JSON'
    throw new Error(`${label}: ${msg}`)
  }
}

export function AiWorkbenchScreen() {
  const { palette: c } = useTheme()
  const [url, setUrl] = useState('')
  const [params, setParams] = useState('')
  const [payload, setPayload] = useState('')
  const [code, setCode] = useState('# process incoming data\nresult = {"ok": True, "items": []}')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AiRunResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const formValid = url.trim().length > 0 && code.trim().length > 0

  const handleRun = useCallback(async () => {
    if (!formValid || loading) return
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const parsedParams = parseJson<Record<string, unknown>>('Params', params)
      const parsedPayload = parseJson<Record<string, unknown>>('Input data', payload)

      const body: AiRunPayload = {
        fetch: {
          url: url.trim(),
          params: parsedParams,
        },
        code,
        input_data: parsedPayload,
      }

      const { data: response } = await aiApi.runGraph(body)
      setResult(response)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to execute graph'
      setError(message)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      Alert.alert('Workbench Error', message)
    } finally {
      setLoading(false)
    }
  }, [code, formValid, loading, params, payload, url])

  const resultInfo = useMemo(() => {
    if (!result) return null
    return (
      <Card>
        <MonoText size={11} color={c.textMuted}>Duration</MonoText>
        <MonoText size={14} style={{ marginBottom: 12 }}>{result.duration_ms} ms</MonoText>
        <MonoText size={11} color={c.textMuted}>Fetch Result</MonoText>
        <ScrollView style={{ maxHeight: 200, marginBottom: 12 }}>
          <Text style={{ color: c.text, fontFamily: 'SpaceMono-Regular', fontSize: 12 }}>
            {JSON.stringify(result.fetch_result, null, 2)}
          </Text>
        </ScrollView>
        <MonoText size={11} color={c.textMuted}>Execution Result</MonoText>
        <ScrollView style={{ maxHeight: 240 }}>
          <Text style={{ color: c.text, fontFamily: 'SpaceMono-Regular', fontSize: 12 }}>
            {JSON.stringify(result.exec_result, null, 2)}
          </Text>
        </ScrollView>
      </Card>
    )
  }, [c, result])

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}>
        <Card>
          <View style={{ gap: 12 }}>
            <View style={{ gap: 4 }}>
              <Text style={{ color: c.text, fontSize: 18, fontFamily: 'SpaceMono-Regular', fontWeight: '700' }}>
                ai workbench
              </Text>
              <MonoText size={11} color={c.textMuted}>
                Fetch remote data, run sandboxed Python, and inspect the output securely from your device.
              </MonoText>
            </View>

            {error && (
              <Text style={{ color: c.danger, fontFamily: 'SpaceMono-Regular', fontSize: 12 }}>
                {error}
              </Text>
            )}

            <View style={{ gap: 6 }}>
              <MonoText size={10} color={c.textMuted} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>Fetch URL</MonoText>
              <TextInput
                value={url}
                onChangeText={setUrl}
                placeholder="https://beacon.example.com/api"
                placeholderTextColor={c.textMuted}
                autoCapitalize="none"
                keyboardType="url"
                style={{
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: c.inputBorder,
                  backgroundColor: c.inputBg,
                  color: c.text,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  fontFamily: 'SpaceMono-Regular',
                  fontSize: 13,
                }}
              />
            </View>

            <View style={{ gap: 6 }}>
              <MonoText size={10} color={c.textMuted} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>Params JSON</MonoText>
              <TextInput
                value={params}
                onChangeText={setParams}
                placeholder='{"limit": 25}'
                placeholderTextColor={c.textMuted}
                autoCapitalize="none"
                multiline
                style={{
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: c.inputBorder,
                  backgroundColor: c.inputBg,
                  color: c.text,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  fontFamily: 'SpaceMono-Regular',
                  fontSize: 13,
                  minHeight: 80,
                }}
              />
            </View>

            <View style={{ gap: 6 }}>
              <MonoText size={10} color={c.textMuted} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>Input Data JSON</MonoText>
              <TextInput
                value={payload}
                onChangeText={setPayload}
                placeholder='{"agent_id": "..."}'
                placeholderTextColor={c.textMuted}
                autoCapitalize="none"
                multiline
                style={{
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: c.inputBorder,
                  backgroundColor: c.inputBg,
                  color: c.text,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  fontFamily: 'SpaceMono-Regular',
                  fontSize: 13,
                  minHeight: 80,
                }}
              />
            </View>

            <View style={{ gap: 6 }}>
              <MonoText size={10} color={c.textMuted} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>Python Code</MonoText>
              <TextInput
                value={code}
                onChangeText={setCode}
                placeholder="# use result variable"
                placeholderTextColor={c.textMuted}
                autoCapitalize="none"
                multiline
                style={{
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: c.inputBorder,
                  backgroundColor: c.inputBg,
                  color: c.text,
                  paddingHorizontal: 12,
                  paddingVertical: 12,
                  fontFamily: 'SpaceMono-Regular',
                  fontSize: 13,
                  minHeight: 160,
                }}
              />
            </View>

            <TouchableOpacity
              onPress={handleRun}
              disabled={!formValid || loading}
              style={{
                marginTop: 6,
                borderRadius: 12,
                backgroundColor: !formValid || loading ? c.border : c.primary,
                paddingVertical: 14,
                alignItems: 'center',
                borderWidth: 1,
                borderColor: !formValid || loading ? c.border : c.primary,
              }}
            >
              <Text style={{
                color: !formValid || loading ? c.textMuted : '#0b111b',
                fontFamily: 'SpaceMono-Regular',
                fontSize: 13,
                fontWeight: '700',
                letterSpacing: 1,
              }}>
                {loading ? 'Running...' : 'Run graph'}
              </Text>
            </TouchableOpacity>
          </View>
        </Card>

        {resultInfo}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

export default AiWorkbenchScreen
