import React, { useMemo, useState, useCallback, useEffect } from 'react'
import {
  View,
  Text,
  TextInput,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  Alert,
  Modal,
  ScrollView,
  Switch,
} from 'react-native'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as Haptics from 'expo-haptics'
import { configApi } from '@/api/endpoints'
import { ServerConfig, RetentionPolicy } from '@/types'
import {
  Card,
  SectionHeader,
  LoadingState,
  ErrorState,
  EmptyState,
  MonoText,
  Divider,
} from '@/components/common'
import { formatTs } from '@/utils/format'
import { useTheme } from '@/theme'

type Mode = 'create' | 'edit'

function serializeValue(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

function parseValue(input: string): unknown {
  const trimmed = input.trim()
  if (!trimmed) return ''
  try {
    return JSON.parse(trimmed)
  } catch {
    return trimmed
  }
}

function ConfigModal({
  visible,
  mode,
  initial,
  onClose,
  onSubmit,
  submitting,
}: {
  visible: boolean
  mode: Mode
  initial?: ServerConfig
  submitting: boolean
  onClose: () => void
  onSubmit: (payload: { key: string; value: unknown; description?: string; encrypted?: boolean }) => void
}) {
  const { palette: c } = useTheme()
  const [keyName, setKeyName] = useState(initial?.key ?? '')
  const [value, setValue] = useState(() => serializeValue(initial?.value))
  const [description, setDescription] = useState(initial?.description ?? '')
  const [encrypted, setEncrypted] = useState(initial?.encrypted ?? false)

  useEffect(() => {
    setKeyName(initial?.key ?? '')
    setValue(serializeValue(initial?.value))
    setDescription(initial?.description ?? '')
    setEncrypted(initial?.encrypted ?? false)
  }, [initial, mode, visible])

  const isEdit = mode === 'edit'
  const canSubmit = keyName.trim().length > 0 && !submitting

  const handleSubmit = () => {
    onSubmit({
      key: keyName.trim(),
      value: parseValue(value),
      description: description.trim() || undefined,
      encrypted,
    })
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'center', padding: 18 }}>
        <TouchableOpacity style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }} activeOpacity={1} onPress={onClose} />
        <View style={{ backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.border, padding: 16 }}>
          <Text style={{ color: c.text, fontSize: 16, fontFamily: 'SpaceMono-Regular', fontWeight: '700', marginBottom: 12 }}>
            {isEdit ? 'Edit Config' : 'Add Config'}
          </Text>

          <View style={{ gap: 10 }}>
            <View>
              <Text style={{ color: c.textMuted, fontSize: 10, fontFamily: 'SpaceMono-Regular', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                Key
              </Text>
              <TextInput
                value={keyName}
                onChangeText={setKeyName}
                editable={!isEdit}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="BEACON__EXAMPLE"
                placeholderTextColor={c.textMuted}
                style={{
                  backgroundColor: c.inputBg,
                  borderWidth: 1,
                  borderColor: c.inputBorder,
                  borderRadius: 8,
                  padding: 10,
                  color: c.text,
                  fontSize: 12,
                  fontFamily: 'SpaceMono-Regular',
                }}
              />
            </View>

            <View>
              <Text style={{ color: c.textMuted, fontSize: 10, fontFamily: 'SpaceMono-Regular', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                Value (JSON or text)
              </Text>
              <TextInput
                value={value}
                onChangeText={setValue}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                placeholder={'{ "enabled": true }'}
                placeholderTextColor={c.textMuted}
                style={{
                  backgroundColor: c.inputBg,
                  borderWidth: 1,
                  borderColor: c.inputBorder,
                  borderRadius: 10,
                  padding: 10,
                  minHeight: 120,
                  color: c.text,
                  fontSize: 12,
                  fontFamily: 'SpaceMono-Regular',
                }}
              />
            </View>

            <View>
              <Text style={{ color: c.textMuted, fontSize: 10, fontFamily: 'SpaceMono-Regular', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                Description
              </Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="Optional"
                placeholderTextColor={c.textMuted}
                style={{
                  backgroundColor: c.inputBg,
                  borderWidth: 1,
                  borderColor: c.inputBorder,
                  borderRadius: 8,
                  padding: 10,
                  color: c.text,
                  fontSize: 12,
                  fontFamily: 'SpaceMono-Regular',
                }}
              />
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <MonoText size={12} color={c.text}>Encrypted</MonoText>
              <Switch
                value={encrypted}
                onValueChange={setEncrypted}
                thumbColor={encrypted ? c.success : c.textDim}
                trackColor={{ true: c.success + '33', false: c.border }}
              />
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <TouchableOpacity
                onPress={handleSubmit}
                disabled={!canSubmit}
                style={{
                  flex: 1,
                  backgroundColor: canSubmit ? c.primary : c.border,
                  borderRadius: 9,
                  padding: 12,
                  alignItems: 'center',
                }}
              >
                <MonoText size={13} color={canSubmit ? '#fff' : c.textMuted}>
                  {submitting ? 'Saving…' : isEdit ? 'Save' : 'Create'}
                </MonoText>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onClose}
                style={{
                  padding: 12,
                  borderRadius: 9,
                  borderWidth: 1,
                  borderColor: c.border,
                  alignItems: 'center',
                  minWidth: 90,
                }}
              >
                <MonoText size={13} color={c.text}>Cancel</MonoText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  )
}

function ConfigRow({ config, onEdit, onDelete }: { config: ServerConfig; onEdit: () => void; onDelete: () => void }) {
  const { palette: c } = useTheme()
  return (
    <Card style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <MonoText size={13} style={{ fontWeight: '700', flex: 1 }}>{config.key}</MonoText>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity
            onPress={onEdit}
            style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: c.border }}
          >
            <MonoText size={11} color={c.primary}>Edit</MonoText>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onDelete}
            style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.danger + '15' }}
          >
            <MonoText size={11} color={c.danger}>Delete</MonoText>
          </TouchableOpacity>
        </View>
      </View>

      <MonoText size={11} color={c.textMuted} style={{ marginBottom: 8 }}>
        {config.description || 'No description'}
      </MonoText>

      <View style={{ backgroundColor: c.surface2, borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 10 }}>
        <MonoText size={10} color={c.textMuted} style={{ marginBottom: 4 }}>Value</MonoText>
        <Text style={{ color: c.text, fontFamily: 'SpaceMono-Regular', fontSize: 12, lineHeight: 18 }}>
          {serializeValue(config.value)}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
        <MonoText size={10} color={c.textMuted}>{config.encrypted ? 'Encrypted' : 'Plaintext'}</MonoText>
        <MonoText size={10} color={c.textMuted}>Updated {formatTs(config.updated_at)}</MonoText>
      </View>
    </Card>
  )
}

function RetentionCard({ policy, onSave, saving }: { policy: RetentionPolicy | undefined; onSave: (p: RetentionPolicy) => void; saving: boolean }) {
  const [draft, setDraft] = useState<RetentionPolicy>(policy ?? { raw_hours: 24, rollup_1m_days: 30, rollup_1h_days: 365 })
  const { palette: c } = useTheme()

  useEffect(() => {
    if (policy) setDraft(policy)
  }, [policy])

  const update = (key: keyof RetentionPolicy, value: number) => {
    setDraft(prev => ({ ...prev, [key]: Number.isNaN(value) ? 0 : value }))
  }

  const handleSave = () => onSave(draft)

  return (
    <Card>
      <SectionHeader title="Retention" />
      <MonoText size={11} color={c.textMuted} style={{ marginBottom: 10 }}>
        Match server-side retention used in the web console.
      </MonoText>

      {[
        ['Raw (hours)', 'raw_hours'],
        ['Rollup 1m (days)', 'rollup_1m_days'],
        ['Rollup 1h (days)', 'rollup_1h_days'],
      ].map(([label, key]) => (
        <View key={key} style={{ marginBottom: 12 }}>
          <MonoText size={10} color={c.textMuted} style={{ textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{label}</MonoText>
          <TextInput
            value={draft[key as keyof RetentionPolicy]?.toString() ?? ''}
            onChangeText={(t) => update(key as keyof RetentionPolicy, parseInt(t, 10))}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor={c.textMuted}
            style={{
              backgroundColor: c.inputBg,
              borderWidth: 1,
              borderColor: c.inputBorder,
              borderRadius: 8,
              padding: 10,
              color: c.text,
              fontSize: 12,
              fontFamily: 'SpaceMono-Regular',
            }}
          />
        </View>
      ))}

      <TouchableOpacity
        onPress={handleSave}
        disabled={saving}
        style={{
          backgroundColor: saving ? c.border : c.success,
          borderRadius: 9,
          padding: 12,
          alignItems: 'center',
        }}
      >
        <MonoText size={13} color={c.mode === 'dark' ? '#0b0d0f' : c.text}>{saving ? 'Saving…' : 'Save retention'}</MonoText>
      </TouchableOpacity>
    </Card>
  )
}

export function ConfigScreen() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [modalMode, setModalMode] = useState<Mode>('create')
  const [activeConfig, setActiveConfig] = useState<ServerConfig | undefined>(undefined)
  const [modalOpen, setModalOpen] = useState(false)

  const { palette: c } = useTheme()

  const configsQ = useQuery({
    queryKey: ['config'],
    queryFn: () => configApi.list().then(r => r.data),
    refetchInterval: 30_000,
  })

  const retentionQ = useQuery({
    queryKey: ['retention'],
    queryFn: () => configApi.retention().then(r => r.data),
    refetchInterval: 60_000,
  })

  const upsertMut = useMutation({
    mutationFn: ({ key, value, description, encrypted }: { key: string; value: unknown; description?: string; encrypted?: boolean }) => {
      const existing = configsQ.data?.find(c => c.key === key)
      if (existing) return configApi.update(key, { value, description, encrypted })
      return configApi.create({ key, value, description, encrypted })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['config'] })
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setModalOpen(false)
    },
    onError: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  })

  const deleteMut = useMutation({
    mutationFn: (key: string) => configApi.delete(key),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['config'] })
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    },
    onError: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  })

  const retentionMut = useMutation({
    mutationFn: (policy: RetentionPolicy) => configApi.updateRetention(policy),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['retention'] })
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    },
    onError: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  })

  const filtered = useMemo(() => {
    const list = configsQ.data ?? []
    if (!search.trim()) return list
    const term = search.toLowerCase()
    return list.filter(c => c.key.toLowerCase().includes(term) || (c.description ?? '').toLowerCase().includes(term))
  }, [configsQ.data, search])

  const onRefresh = useCallback(() => {
    configsQ.refetch()
    retentionQ.refetch()
  }, [configsQ, retentionQ])

  const openCreate = () => {
    setModalMode('create')
    setActiveConfig(undefined)
    setModalOpen(true)
    Haptics.selectionAsync()
  }

  const openEdit = (cfg: ServerConfig) => {
    setModalMode('edit')
    setActiveConfig(cfg)
    setModalOpen(true)
    Haptics.selectionAsync()
  }

  const handleDelete = (cfg: ServerConfig) => {
    Alert.alert('Delete config', `Delete ${cfg.key}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteMut.mutate(cfg.key) },
    ])
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ConfigModal
        visible={modalOpen}
        mode={modalMode}
        initial={activeConfig}
        submitting={upsertMut.isPending}
        onClose={() => setModalOpen(false)}
        onSubmit={(payload) => upsertMut.mutate(payload)}
      />

      <FlatList
        data={filtered}
        keyExtractor={(c) => c.key}
        ListHeaderComponent={(
          <View style={{ paddingHorizontal: 16, paddingTop: 14, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <MonoText size={16} style={{ fontWeight: '700', flex: 1 }}>config</MonoText>
              <TouchableOpacity
                onPress={openCreate}
                style={{
                  backgroundColor: c.primary,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: 10,
                }}
              >
                <MonoText size={12} color={c.mode === 'dark' ? '#0b0d0f' : '#fff'}>Add</MonoText>
              </TouchableOpacity>
            </View>

            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search config…"
              placeholderTextColor={c.textMuted}
              style={{
                backgroundColor: c.inputBg,
                borderWidth: 1,
                borderColor: c.inputBorder,
                borderRadius: 8,
                padding: 10,
                color: c.text,
                fontSize: 12,
                fontFamily: 'SpaceMono-Regular',
              }}
            />

            <RetentionCard
              policy={retentionQ.data}
              onSave={(p) => retentionMut.mutate(p)}
              saving={retentionMut.isPending}
            />

            <Divider style={{ marginTop: 8 }} />
            <SectionHeader title="Server Config" count={filtered.length} />
          </View>
        )}
        ListEmptyComponent={configsQ.isLoading ? null : <EmptyState label={search ? 'No config matches search' : 'No config keys set'} icon="⚙" />}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        refreshControl={(
          <RefreshControl
            refreshing={configsQ.isFetching || retentionQ.isFetching}
            onRefresh={onRefresh}
            tintColor="#3b82f6"
          />
        )}
        renderItem={({ item }) => (
          <ConfigRow
            config={item}
            onEdit={() => openEdit(item)}
            onDelete={() => handleDelete(item)}
          />
        )}
        ListFooterComponent={configsQ.isLoading ? <LoadingState label="Loading config…" /> : configsQ.isError ? <ErrorState message="Failed to load config" onRetry={configsQ.refetch} /> : null}
      />
    </View>
  )
}
