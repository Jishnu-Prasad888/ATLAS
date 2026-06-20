import React, { useCallback, useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ScrollView, Alert,
} from 'react-native'

import { Eye, EyeOff } from 'lucide-react-native'
import axios from 'axios'
import * as Haptics from 'expo-haptics'
import { useAuthStore } from '@/store/authStore'
import { useSettingsStore } from '@/store/settingsStore'
import { authApi } from '@/api/endpoints'
import { resetApiClient } from '@/api/client'

export function LoginScreen() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [showServerConfig, setShowServerConfig] = useState(false)
  const [pinging, setPinging] = useState(false)
  const { setTokens, setUser } = useAuthStore()
  const { settings, save } = useSettingsStore()
  const [serverUrl, setServerUrl] = useState(settings.apiBaseUrl)
  const [apiPrefix, setApiPrefix] = useState(settings.apiPrefix)
  const [showPassword, setShowPassword] = useState(false)
  const [capsWarning, setCapsWarning] = useState(false)

  const handlePasswordChange = useCallback((text: string) => {
    setPassword(text)
    const letters = text.replace(/[^a-zA-Z]/g, '')
    setCapsWarning(letters.length > 0 && letters === letters.toUpperCase())
  }, [])

  const handleLogin = async () => {
    console.log('[Login] handleLogin called')
    if (!username.trim() || !password.trim()) {
      console.log('[Login] Missing fields – aborting')
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
      Alert.alert('Missing Fields', 'Enter username and password.')
      return
    }
    setLoading(true)
    const user = username.trim()
    console.log(`[Login] Credentials OK – username="${user}"`)
    try {
      if (serverUrl !== settings.apiBaseUrl || apiPrefix !== settings.apiPrefix) {
        console.log(`[Login] Saving settings: baseUrl="${serverUrl}" prefix="${apiPrefix}"`)
        await save({ apiBaseUrl: serverUrl, apiPrefix })
      }
      resetApiClient()
      console.log(`[Login] POST /auth/login/ (baseUrl=${serverUrl || '(default)'}${apiPrefix})`)
      const res = await authApi.login(user, password)
      console.log('[Login] Token response received – storing tokens')
      await setTokens(res.data.access, res.data.refresh)
      resetApiClient()
      console.log('[Login] GET /auth/me/')
      const meRes = await authApi.whoami()
      console.log(`[Login] User data received – user="${meRes.data.username}" role="${meRes.data.role}"`)
      setUser(meRes.data)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      console.log('[Login] Login complete')
    } catch (err: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      const status = err?.response?.status ?? 'NO_RESPONSE'
      const detail = err?.response?.data?.detail ?? err?.message ?? ''
      console.log(`[Login] Failed – status=${status} detail="${detail}"`, err?.response?.data ?? '')
      let message: string
      if (!err?.response) {
        if (err?.code === 'ECONNABORTED') {
          message = 'Connection timed out. Check your server URL and network.'
        } else {
          message = 'Could not connect to the server. Verify the server URL above and your network connection.'
        }
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
    console.log('[Ping] handlePing called')
    setPinging(true)
    try {
      if (serverUrl !== settings.apiBaseUrl || apiPrefix !== settings.apiPrefix) {
        console.log(`[Ping] Saving settings: baseUrl="${serverUrl}" prefix="${apiPrefix}"`)
        await save({ apiBaseUrl: serverUrl, apiPrefix })
      }
      resetApiClient()
      const start = Date.now()
      const base = serverUrl ? serverUrl.replace(/\/+$/, '') : ''
      const url = `${base}/health/`
      console.log(`[Ping] GET ${url}`)
      await axios.get(url, { timeout: 10_000 })
      const ms = Date.now() - start
      console.log(`[Ping] Success – ${ms}ms`)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      Alert.alert('Connection OK', `Server responded in ${ms}ms.`)
    } catch (err: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      const status = err?.response?.status ?? 'NO_RESPONSE'
      const detail = err?.response?.data?.detail ?? err?.message ?? ''
      console.log(`[Ping] Failed – status=${status} detail="${detail}"`, err?.response?.data ?? '')
      let msg: string
      if (!err?.response) {
        msg = err?.code === 'ECONNABORTED'
          ? 'Connection timed out.'
          : 'Could not reach the server.'
      } else {
        msg = `Server returned ${err.response.status}.`
      }
      Alert.alert('Connection Failed', msg)
    } finally {
      setPinging(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#0b0d0f' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo */}
        <View style={{ alignItems: 'center', marginBottom: 48 }}>
          <View style={{
            width: 56, height: 56, borderRadius: 14,
            backgroundColor: '#1e3a5f', alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderColor: '#2a3340', marginBottom: 16,
          }}>
            <Text style={{ fontSize: 26 }}>◈</Text>
          </View>
          <Text style={{
            fontSize: 22, fontFamily: 'SpaceMono-Regular', color: '#d4dae3', fontWeight: '700',
          }}>
            beacon
          </Text>
          <Text style={{ fontSize: 11, color: '#5a6878', fontFamily: 'SpaceMono-Regular', marginTop: 4 }}>
            infrastructure monitor
          </Text>
        </View>

        {/* Form */}
        <View style={{ gap: 12 }}>
          <View>
            <Text style={{ fontSize: 10, color: '#5a6878', fontFamily: 'SpaceMono-Regular', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
              Username
            </Text>
            <TextInput
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
              style={{
                backgroundColor: '#111418',
                borderWidth: 1, borderColor: '#1e252e',
                borderRadius: 8, padding: 12,
                color: '#d4dae3', fontSize: 14,
                fontFamily: 'SpaceMono-Regular',
              }}
              placeholderTextColor="#3a4555"
              placeholder="admin"
            />
          </View>

          <View>
            <Text style={{ fontSize: 10, color: '#5a6878', fontFamily: 'SpaceMono-Regular', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
              Password
            </Text>
            <View style={{ position: 'relative' }}>
              <TextInput
                value={password}
                onChangeText={handlePasswordChange}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={handleLogin}
                style={{
                  backgroundColor: '#111418',
                  borderWidth: 1, borderColor: '#1e252e',
                  borderRadius: 8, padding: 12,
                  paddingRight: 44,
                  color: '#d4dae3', fontSize: 14,
                  fontFamily: 'SpaceMono-Regular',
                }}
                placeholderTextColor="#3a4555"
                placeholder="••••••••"
              />
              <TouchableOpacity
                onPress={() => setShowPassword(v => !v)}
                activeOpacity={0.7}
                style={{
                  position: 'absolute', right: 12, top: 0, bottom: 0,
                  justifyContent: 'center',
                }}
              >
                {showPassword
                  ? <EyeOff size={20} color="#5a6878" />
                  : <Eye size={20} color="#5a6878" />
                }
              </TouchableOpacity>
            </View>
            {capsWarning && (
              <Text style={{
                color: '#ff6b6b', fontSize: 10,
                fontFamily: 'SpaceMono-Regular', marginTop: 4,
                opacity: 0.8,
              }}>
                ⚠ Caps Lock may be enabled
              </Text>
            )}
          </View>

          <TouchableOpacity
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.8}
            style={{
              marginTop: 8,
              backgroundColor: loading ? '#1e3a5f' : '#3b82f6',
              borderRadius: 8, padding: 14, alignItems: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 14, fontFamily: 'SpaceMono-Regular', fontWeight: '700' }}>
              {loading ? 'Signing in…' : 'Sign in'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Server Configuration Toggle */}
        <TouchableOpacity
          onPress={() => setShowServerConfig(!showServerConfig)}
          activeOpacity={0.7}
          style={{ marginTop: 20, alignItems: 'center' }}
        >
          <Text style={{ color: '#5a6878', fontSize: 11, fontFamily: 'SpaceMono-Regular', textDecorationLine: 'underline' }}>
            {showServerConfig ? 'Hide server configuration' : 'Configure server'}
          </Text>
        </TouchableOpacity>

        {showServerConfig && (
          <View style={{ marginTop: 16, gap: 12 }}>
            <View>
              <Text style={{ fontSize: 10, color: '#5a6878', fontFamily: 'SpaceMono-Regular', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
                API Base URL
              </Text>
              <TextInput
                value={serverUrl}
                onChangeText={setServerUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="http://192.168.1.100:8000"
                style={{
                  backgroundColor: '#111418',
                  borderWidth: 1, borderColor: '#1e252e',
                  borderRadius: 8, padding: 12,
                  color: '#d4dae3', fontSize: 14,
                  fontFamily: 'SpaceMono-Regular',
                }}
                placeholderTextColor="#3a4555"
              />
            </View>
            <View>
              <Text style={{ fontSize: 10, color: '#5a6878', fontFamily: 'SpaceMono-Regular', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
                API Path Prefix
              </Text>
              <TextInput
                value={apiPrefix}
                onChangeText={setApiPrefix}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="/api/v1"
                style={{
                  backgroundColor: '#111418',
                  borderWidth: 1, borderColor: '#1e252e',
                  borderRadius: 8, padding: 12,
                  color: '#d4dae3', fontSize: 14,
                  fontFamily: 'SpaceMono-Regular',
                }}
                placeholderTextColor="#3a4555"
              />
            </View>
            <TouchableOpacity
              onPress={handlePing}
              disabled={pinging}
              activeOpacity={0.7}
              style={{
                borderWidth: 1, borderColor: '#1e252e', borderRadius: 8,
                padding: 12, alignItems: 'center', marginTop: 4,
              }}
            >
              <Text style={{
                color: pinging ? '#3a4555' : '#5a6878',
                fontSize: 11, fontFamily: 'SpaceMono-Regular',
              }}>
                {pinging ? 'Testing…' : 'Test Connection'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={{ textAlign: 'center', marginTop: 32, color: '#3a4555', fontSize: 10, fontFamily: 'SpaceMono-Regular' }}>
          beacon v1.0.0 · secure monitor
        </Text>
      </ScrollView>
      </View>
    </KeyboardAvoidingView>
  )
}
