import React, { useState, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  Alert, Switch, KeyboardAvoidingView, Platform,
} from 'react-native'

import * as Haptics from 'expo-haptics'
import { useSettingsStore } from '@/store/settingsStore'
import { useAuthStore } from '@/store/authStore'
import { resetApiClient } from '@/api/client'
import { authApi } from '@/api/endpoints'
import { AppSettings } from '@/types'
import { Card, SectionHeader, MonoText, Divider } from '@/components/common'

function SettingField({
  label, value, onChangeText, placeholder, secureTextEntry = false,
  hint, keyboard = 'default',
}: {
  label: string
  value: string
  onChangeText: (v: string) => void
  placeholder?: string
  secureTextEntry?: boolean
  hint?: string
  keyboard?: 'default' | 'url' | 'email-address'
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{
        fontSize: 10, color: '#5a6878', fontFamily: 'SpaceMono-Regular',
        textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5,
      }}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#3a4555"
        secureTextEntry={secureTextEntry}
        keyboardType={keyboard as any}
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          backgroundColor: '#111418', borderWidth: 1, borderColor: '#1e252e',
          borderRadius: 8, padding: 10, color: '#d4dae3',
          fontSize: 12, fontFamily: 'SpaceMono-Regular',
        }}
      />
      {hint && (
        <Text style={{ fontSize: 9, color: '#3a4555', fontFamily: 'SpaceMono-Regular', marginTop: 4 }}>
          {hint}
        </Text>
      )}
    </View>
  )
}

export function SettingsScreen() {
  const { settings, save, reset } = useSettingsStore()
  const { user, role, logout } = useAuthStore()

  const [form, setForm] = useState<AppSettings>(settings)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  // Password change state
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [changingPwd, setChangingPwd] = useState(false)

  useEffect(() => {
    setForm(settings)
  }, [settings])

  const field = (key: keyof AppSettings) => ({
    value: form[key],
    onChangeText: (v: string) => {
      setForm(prev => ({ ...prev, [key]: v }))
      setDirty(true)
    },
  })

  const handleSave = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setSaving(true)
    try {
      await save(form)
      resetApiClient()
      setDirty(false)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      Alert.alert('Saved', 'Settings saved. The API client will use the new values.')
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      Alert.alert('Error', 'Failed to save settings.')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    Alert.alert('Reset Settings', 'Reset all settings to defaults?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          await reset()
          resetApiClient()
          setDirty(false)
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
        },
      },
    ])
  }

  const handleLogout = async () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
          await logout()
        },
      },
    ])
  }

  const handleChangePassword = async () => {
    if (!oldPwd || !newPwd) {
      Alert.alert('Missing Fields', 'Enter both old and new passwords.')
      return
    }
    setChangingPwd(true)
    try {
      await authApi.changePassword(oldPwd, newPwd)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setOldPwd('')
      setNewPwd('')
      Alert.alert('Success', 'Password changed successfully.')
    } catch (err: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      const detail = err?.response?.data?.detail || 'Failed to change password.'
      Alert.alert('Error', detail)
    } finally {
      setChangingPwd(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#0b0d0f' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}>

        {/* Account info */}
        <Card>
          <SectionHeader title="Account" />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={{
              width: 44, height: 44, borderRadius: 22,
              backgroundColor: '#1e3a5f', alignItems: 'center', justifyContent: 'center',
              borderWidth: 1, borderColor: '#2a3340',
            }}>
              <MonoText size={18} color="#3b82f6">{user?.username?.[0]?.toUpperCase() ?? '?'}</MonoText>
            </View>
            <View style={{ flex: 1 }}>
              <MonoText size={15} style={{ fontWeight: '700' }}>{user?.username ?? '—'}</MonoText>
              <MonoText size={11} color="#5a6878">{user?.email ?? ''}</MonoText>
              <View style={{
                marginTop: 4, alignSelf: 'flex-start',
                backgroundColor: '#1e2e42', borderRadius: 20,
                paddingHorizontal: 8, paddingVertical: 2,
              }}>
                <MonoText size={10} color="#3b82f6">{role ?? 'unknown'}</MonoText>
              </View>
            </View>
          </View>
        </Card>

        {/* Connection settings */}
        <Card>
          <SectionHeader title="Connection" />
          <SettingField
            label="API Base URL"
            placeholder="http://localhost:8000"
            hint="Leave empty to use the same host. e.g. https://beacon.example.com"
            keyboard="url"
            {...field('apiBaseUrl')}
          />
          <SettingField
            label="WebSocket Base URL"
            placeholder="ws://localhost:8000"
            hint="Leave empty to auto-derive. e.g. wss://beacon.example.com"
            keyboard="url"
            {...field('wsBaseUrl')}
          />
          <SettingField
            label="API Path Prefix"
            placeholder="/api/v1"
            hint="Default: /api/v1"
            {...field('apiPrefix')}
          />
          <SettingField
            label="WebSocket Path"
            placeholder="/ws/subscribe/"
            hint="Default: /ws/subscribe/"
            {...field('wsPath')}
          />

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
            <TouchableOpacity
              onPress={handleSave}
              disabled={!dirty || saving}
              style={{
                flex: 1, backgroundColor: dirty ? '#3b82f6' : '#1e252e',
                borderRadius: 8, padding: 12, alignItems: 'center',
              }}
            >
              <MonoText size={13} color={dirty ? '#fff' : '#3a4555'}>
                {saving ? 'Saving…' : 'Save'}
              </MonoText>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleReset}
              style={{
                borderWidth: 1, borderColor: '#1e252e', borderRadius: 8,
                padding: 12, paddingHorizontal: 18, alignItems: 'center',
              }}
            >
              <MonoText size={13} color="#5a6878">Reset</MonoText>
            </TouchableOpacity>
          </View>
        </Card>

        {/* Change password */}
        <Card>
          <SectionHeader title="Change Password" />
          <SettingField
            label="Current Password"
            placeholder="••••••••"
            secureTextEntry
            value={oldPwd}
            onChangeText={setOldPwd}
          />
          <SettingField
            label="New Password"
            placeholder="••••••••"
            secureTextEntry
            value={newPwd}
            onChangeText={setNewPwd}
          />
          <TouchableOpacity
            onPress={handleChangePassword}
            disabled={changingPwd}
            style={{
              backgroundColor: '#181c22', borderWidth: 1, borderColor: '#2a3340',
              borderRadius: 8, padding: 12, alignItems: 'center', marginTop: 2,
            }}
          >
            <MonoText size={13} color="#d4dae3">
              {changingPwd ? 'Updating…' : 'Update Password'}
            </MonoText>
          </TouchableOpacity>
        </Card>

        {/* App info */}
        <Card>
          <SectionHeader title="About" />
          <View style={{ gap: 8 }}>
            {[
              ['App', 'Beacon Monitor'],
              ['Version', '1.0.0'],
              ['API Prefix', settings.apiPrefix],
              ['WS Path', settings.wsPath],
            ].map(([k, v]) => (
              <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <MonoText size={11} color="#5a6878">{k}</MonoText>
                <MonoText size={11} color="#3a4555">{v}</MonoText>
              </View>
            ))}
          </View>
        </Card>

        {/* Sign out */}
        <TouchableOpacity
          onPress={handleLogout}
          style={{
            borderWidth: 1, borderColor: '#ef444430', borderRadius: 10,
            padding: 14, alignItems: 'center', backgroundColor: '#2a0f0f',
          }}
        >
          <MonoText size={14} color="#ef4444">Sign Out</MonoText>
        </TouchableOpacity>
      </ScrollView>
      </View>
    </KeyboardAvoidingView>
  )
}
