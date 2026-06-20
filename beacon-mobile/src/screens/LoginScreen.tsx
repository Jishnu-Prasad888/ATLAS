import React, { useCallback, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  StyleSheet,
} from 'react-native'
import { Eye, EyeOff } from 'lucide-react-native'
import axios from 'axios'
import * as Haptics from 'expo-haptics'
import { useAuthStore } from '@/store/authStore'
import { useSettingsStore } from '@/store/settingsStore'
import { authApi } from '@/api/endpoints'
import { resetApiClient } from '@/api/client'
import { MonoText } from '@/components/common'
import { useTheme } from '@/theme'

const ACCENT = '#7dd3fc'
const BG = '#05070b'
const CARD = '#0b111b'
const BORDER = '#1c2735'
const BORDER_SOFT = '#111827'
const TEXT = '#e8edf5'
const MUTED = '#9aa7b8'
const INPUT_BG = '#0f1621'

export function LoginScreen() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const [showServerConfig, setShowServerConfig] = useState(false)
  const [pinging, setPinging] = useState(false)
  const { setTokens, setUser } = useAuthStore()
  const { settings, save } = useSettingsStore()
  const [serverUrl, setServerUrl] = useState(settings.apiBaseUrl)
  const [apiPrefix, setApiPrefix] = useState(settings.apiPrefix)
  const [showPassword, setShowPassword] = useState(false)
  const [capsWarning, setCapsWarning] = useState(false)
  const [mode, setMode] = useState<'login' | 'recover'>('login')
  const [recoveryKey, setRecoveryKey] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const { palette: c } = useTheme()

  const handlePasswordChange = useCallback((text: string) => {
    setPassword(text)
    const letters = text.replace(/[^a-zA-Z]/g, '')
    setCapsWarning(letters.length > 0 && letters === letters.toUpperCase())
  }, [])

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
      Alert.alert('Missing Fields', 'Enter username and password.')
      return
    }
    setLoading(true)
    const user = username.trim()
    try {
      if (serverUrl !== settings.apiBaseUrl || apiPrefix !== settings.apiPrefix) {
        await save({ apiBaseUrl: serverUrl, apiPrefix })
      }
      resetApiClient()
      const res = await authApi.login(user, password)
      await setTokens(res.data.access, res.data.refresh)
      resetApiClient()
      const meRes = await authApi.whoami()
      setUser(meRes.data)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } catch (err: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      let message: string
      if (!err?.response) {
        message = err?.code === 'ECONNABORTED'
          ? 'Connection timed out. Check your server URL and network.'
          : 'Could not connect to the server. Verify the server URL above and your network connection.'
      } else if (err.response.status === 401) {
        message = err?.response?.data?.detail || 'Invalid username or password.'
      } else {
        message = err?.response?.data?.detail || `Server error (${err.response.status}). Check your server URL and credentials.`
      }
      Alert.alert('Login Failed', message)
    } finally {
      setLoading(false)
    }
  }

  const handlePing = async () => {
    setPinging(true)
    try {
      if (serverUrl !== settings.apiBaseUrl || apiPrefix !== settings.apiPrefix) {
        await save({ apiBaseUrl: serverUrl, apiPrefix })
      }
      resetApiClient()
      const start = Date.now()
      const base = serverUrl ? serverUrl.replace(/\/+$/, '') : ''
      const url = `${base}/health/`
      await axios.get(url, { timeout: 10_000 })
      const ms = Date.now() - start
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      Alert.alert('Connection OK', `Server responded in ${ms}ms.`)
    } catch (err: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      const msg = !err?.response
        ? (err?.code === 'ECONNABORTED' ? 'Connection timed out.' : 'Could not reach the server.')
        : `Server returned ${err.response.status}.`
      Alert.alert('Connection Failed', msg)
    } finally {
      setPinging(false)
    }
  }

  const handleRecover = async () => {
    if (!username.trim() || !recoveryKey.trim() || !newPassword.trim()) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
      Alert.alert('Missing Fields', 'Enter username, recovery key, and a new password.')
      return
    }
    setRecovering(true)
    try {
      const res = await authApi.recover(username.trim(), recoveryKey.trim(), newPassword)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      Alert.alert(
        'Recovered',
        res.data?.new_recovery_key
          ? `Password reset. Save this new recovery key:\n${res.data.new_recovery_key}`
          : 'Password reset successfully.',
        [{ text: 'OK', onPress: () => setMode('login') }],
      )
      setRecoveryKey('')
      setNewPassword('')
      setPassword('')
    } catch (err: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      const message = err?.response?.data?.detail || 'Failed to recover account.'
      Alert.alert('Recovery Failed', message)
    } finally {
      setRecovering(false)
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.bgLayer} pointerEvents="none">
        <View style={[styles.blob, styles.blobTop]} />
        <View style={[styles.blob, styles.blobBottom]} />
        <View style={styles.bgOverlay} />
      </View>

      <KeyboardAvoidingView style={styles.foreground} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.headerTitle}>ATLAS</Text>
            <Text style={styles.headerSub}>Autonomous Telemetry, Logging, Analysis, and Surveillance</Text>
          </View>

          <View style={styles.cardWrap}>
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <MonoText size={10} color={MUTED} style={styles.eyebrow}>
                  {mode === 'login' ? 'Operator access' : 'Recovery'}
                </MonoText>
                <Text style={styles.cardTitle}>{mode === 'login' ? 'Welcome back' : 'Recover access'}</Text>
                <Text style={styles.cardBody}>
                  {mode === 'login'
                    ? 'Sign in to monitor and orchestrate Beacon.'
                    : 'Reset your credentials with a valid recovery key.'}
                </Text>
              </View>

              {mode === 'login' ? (
                <View style={styles.section}>
                  <View style={styles.field}>
                    <MonoText size={10} color={MUTED} style={styles.eyebrow}>Username</MonoText>
                    <TextInput
                      value={username}
                      onChangeText={setUsername}
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="next"
                      style={styles.input}
                      placeholderTextColor="#425066"
                      placeholder="admin"
                    />
                  </View>
                  <View style={styles.field}>
                    <MonoText size={10} color={MUTED} style={styles.eyebrow}>Password</MonoText>
                    <View style={{ position: 'relative' }}>
                      <TextInput
                        value={password}
                        onChangeText={handlePasswordChange}
                        secureTextEntry={!showPassword}
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="go"
                        onSubmitEditing={handleLogin}
                        style={[styles.input, { paddingRight: 44 }]}
                        placeholderTextColor="#425066"
                        placeholder="••••••••"
                      />
                      <TouchableOpacity
                        onPress={() => setShowPassword(v => !v)}
                        activeOpacity={0.7}
                        style={styles.eyeBtn}
                      >
                        {showPassword ? <EyeOff size={20} color={MUTED} /> : <Eye size={20} color={MUTED} />}
                      </TouchableOpacity>
                    </View>
                    {capsWarning && (
                      <Text style={[styles.warningText, { color: c.danger }]}>
                        ⚠ Caps Lock may be enabled
                      </Text>
                    )}
                  </View>
                  <TouchableOpacity
                    onPress={handleLogin}
                    disabled={loading}
                    activeOpacity={0.9}
                    style={[styles.primaryBtn, loading && { opacity: 0.65 }]}
                  >
                    <Text style={styles.primaryText}>{loading ? 'Signing in…' : 'Sign in'}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.section}>
                  <MonoText size={12} color={MUTED}>
                    Reset your password with your recovery key. A new recovery key will be issued after reset.
                  </MonoText>
                  <View style={styles.field}>
                    <MonoText size={10} color={MUTED} style={styles.eyebrow}>Username</MonoText>
                    <TextInput
                      value={username}
                      onChangeText={setUsername}
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder="admin"
                      placeholderTextColor="#425066"
                      style={styles.input}
                    />
                  </View>
                  <View style={styles.field}>
                    <MonoText size={10} color={MUTED} style={styles.eyebrow}>Recovery Key</MonoText>
                    <TextInput
                      value={recoveryKey}
                      onChangeText={setRecoveryKey}
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder="beacon-xxxx-xxxx"
                      placeholderTextColor="#425066"
                      style={styles.input}
                    />
                  </View>
                  <View style={styles.field}>
                    <MonoText size={10} color={MUTED} style={styles.eyebrow}>New Password</MonoText>
                    <TextInput
                      value={newPassword}
                      onChangeText={setNewPassword}
                      secureTextEntry
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder="••••••••"
                      placeholderTextColor="#425066"
                      style={styles.input}
                    />
                  </View>
                  <TouchableOpacity
                    onPress={handleRecover}
                    disabled={recovering}
                    activeOpacity={0.9}
                    style={[styles.primaryBtn, recovering && { opacity: 0.65 }]}
                  >
                    <Text style={styles.primaryText}>{recovering ? 'Submitting…' : 'Reset password'}</Text>
                  </TouchableOpacity>
                </View>
              )}

              <TouchableOpacity
                onPress={() => setMode(mode === 'login' ? 'recover' : 'login')}
                activeOpacity={0.75}
                style={styles.linkBtn}
              >
                <Text style={styles.linkText}>
                  {mode === 'login' ? 'Forgot password? Recover with key' : 'Back to sign in'}
                </Text>
              </TouchableOpacity>

              <View style={styles.sectionDivider} />

              <TouchableOpacity
                onPress={() => setShowServerConfig(!showServerConfig)}
                activeOpacity={0.75}
                style={styles.linkBtn}
              >
                <Text style={styles.linkText}>
                  {showServerConfig ? 'Hide server configuration' : 'Configure server'}
                </Text>
              </TouchableOpacity>

              {showServerConfig && (
                <View style={styles.section}>
                  <View style={styles.field}>
                    <MonoText size={10} color={MUTED} style={styles.eyebrow}>API Base URL</MonoText>
                    <TextInput
                      value={serverUrl}
                      onChangeText={setServerUrl}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      placeholder="http://192.168.1.100:8000"
                      style={styles.input}
                      placeholderTextColor="#425066"
                    />
                  </View>
                  <View style={styles.field}>
                    <MonoText size={10} color={MUTED} style={styles.eyebrow}>API Path Prefix</MonoText>
                    <TextInput
                      value={apiPrefix}
                      onChangeText={setApiPrefix}
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder="/api/v1"
                      style={styles.input}
                      placeholderTextColor="#425066"
                    />
                  </View>
                  <TouchableOpacity
                    onPress={handlePing}
                    disabled={pinging}
                    activeOpacity={0.85}
                    style={[styles.secondaryBtn, pinging && { opacity: 0.65 }]}
                  >
                    <Text style={styles.secondaryText}>{pinging ? 'Testing…' : 'Test connection'}</Text>
                  </TouchableOpacity>
                </View>
              )}

              <View style={styles.footer}>
                <MonoText size={10} color={MUTED}>TLS 1.3 · Encrypted channel</MonoText>
                <MonoText size={10} color={MUTED}>beacon mobile · v1.0.0</MonoText>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  bgLayer: { ...StyleSheet.absoluteFillObject },
  blob: { position: 'absolute', borderRadius: 999, backgroundColor: ACCENT, opacity: 0.08 },
  blobTop: { width: 360, height: 360, top: -40, right: -120, transform: [{ rotate: '-8deg' }] },
  blobBottom: { width: 420, height: 420, bottom: -120, left: -100, transform: [{ rotate: '14deg' }] },
  bgOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,7,11,0.68)' },

  foreground: { flex: 1 },
  scrollContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'flex-start', padding: 22, paddingTop: 52, paddingBottom: 52, gap: 22 },

  header: { width: '100%', maxWidth: 420, alignItems: 'center', gap: 4 },
  headerTitle: { color: TEXT, fontSize: 24, fontWeight: '800', letterSpacing: 1 },
  headerSub: { color: MUTED, fontSize: 12, textAlign: 'center', lineHeight: 18 },

  cardWrap: { width: '100%', maxWidth: 420, marginTop: 16 },
  card: { backgroundColor: CARD, borderRadius: 18, borderWidth: 1, borderColor: BORDER, padding: 20, gap: 14, shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
  cardHeader: { gap: 6 },
  cardTitle: { fontSize: 20, color: TEXT, fontWeight: '700' },
  cardBody: { color: MUTED, fontSize: 13, lineHeight: 18 },
  eyebrow: { letterSpacing: 1.2, textTransform: 'uppercase' },
  section: { gap: 12 },
  sectionDivider: { height: 1, backgroundColor: BORDER },
  field: { gap: 6 },

  input: { backgroundColor: INPUT_BG, borderWidth: 1, borderColor: BORDER, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 12, color: TEXT, fontSize: 14, fontFamily: 'SpaceMono-Regular' },
  eyeBtn: { position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center' },
  warningText: { fontSize: 10, fontFamily: 'SpaceMono-Regular', marginTop: 2 },

  primaryBtn: { marginTop: 4, backgroundColor: ACCENT, borderRadius: 11, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  primaryText: { color: '#041018', fontSize: 13, fontFamily: 'SpaceMono-Regular', fontWeight: '700', letterSpacing: 1 },
  secondaryBtn: { borderWidth: 1, borderColor: BORDER, borderRadius: 10, paddingVertical: 12, alignItems: 'center', backgroundColor: BORDER_SOFT },
  secondaryText: { color: MUTED, fontSize: 12, fontFamily: 'SpaceMono-Regular' },
  linkBtn: { alignItems: 'center', paddingVertical: 6 },
  linkText: { color: MUTED, fontSize: 12, fontFamily: 'SpaceMono-Regular', textDecorationLine: 'underline' },

  footer: { alignItems: 'center', gap: 4, marginTop: 6 },
})
