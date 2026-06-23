import React, { useState, useCallback, useMemo } from 'react'
import {
  View, FlatList, TextInput, RefreshControl,
  TouchableOpacity, Alert, Modal, Pressable,
} from 'react-native'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as Haptics from 'expo-haptics'
import { usersApi } from '@/api/endpoints'
import { User, Role } from '@/types'
import { Card, SectionHeader, LoadingState, ErrorState, EmptyState, MonoText, Badge } from '@/components/common'
import { timeAgo } from '@/utils/format'
import { useAuthStore } from '@/store/authStore'
import { useTheme } from '@/theme'

const ROLE_COLORS: Record<Role, string> = {
  administrator: '#a855f7',
  moderator: '#38bdf8',
  viewer: '#6b7280',
  guest: '#94a3b8',
}

function UserCard({ user, onAction }: { user: User; onAction: (u: User) => void }) {
  const color = user.is_active ? '#22c55e' : '#ef4444'
  const roleColor = ROLE_COLORS[user.role] ?? '#6b7280'

  return (
    <Card style={{ marginBottom: 10 }} onPress={() => onAction(user)}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{
          width: 38, height: 38, borderRadius: 19,
          backgroundColor: roleColor + '22', borderWidth: 1, borderColor: roleColor + '40',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <MonoText size={16} color={roleColor}>{user.username[0]?.toUpperCase()}</MonoText>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <MonoText size={14} style={{ fontWeight: '700' }}>{user.username}</MonoText>
            {!user.is_active && (
              <View style={{ backgroundColor: '#2a0f0f', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 }}>
                <MonoText size={9} color="#ef4444">inactive</MonoText>
              </View>
            )}
          </View>
          <MonoText size={11} color="#5a6878">{user.email}</MonoText>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
            <Badge label={user.role} color={roleColor} bg={roleColor + '20'} />
          </View>
          <MonoText size={9} color="#3a4555" style={{ marginTop: 4 }}>
            joined {timeAgo(user.created_at)}
            {user.last_login ? ` · last login ${timeAgo(user.last_login)}` : ''}
          </MonoText>
        </View>
      </View>
    </Card>
  )
}

export function UsersScreen() {
  const [search, setSearch] = useState('')
  const { role: myRole, user: currentUser } = useAuthStore()
  const qc = useQueryClient()
  const isAdmin = myRole === 'administrator'
  const [actionUser, setActionUser] = useState<User | null>(null)
  const { palette: c } = useTheme()

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list().then(r => r.data),
    placeholderData: (prev) => prev,
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => usersApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    },
    onError: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<User> }) => usersApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    },
    onError: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  })

  const roleMut = useMutation({
    mutationFn: ({ id, role }: { id: number; role: Role }) => usersApi.assignRole(id, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    },
    onError: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  })

  const handleAction = useCallback((user: User) => {
    if (!isAdmin) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setActionUser(user)
  }, [isAdmin])

  const closeActions = useCallback(() => {
    setActionUser(null)
  }, [])

  const handleToggleActive = useCallback(() => {
    if (!actionUser) return
    const target = actionUser
    const nextActive = !target.is_active
    if (!nextActive && currentUser && target.id === currentUser.id) {
      return
    }
    closeActions()
    updateMut.mutate({ id: target.id, data: { is_active: nextActive } })
  }, [actionUser, currentUser, closeActions, updateMut])

  const handleChangeRole = useCallback(() => {
    if (!actionUser) return
    const target = actionUser
    closeActions()
    const roles: Role[] = ['administrator', 'moderator', 'viewer', 'guest']
    Alert.alert('Change Role', `Current: ${target.role}`, [
      ...roles.map(r => ({
        text: r,
        onPress: () => roleMut.mutate({ id: target.id, role: r }),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ])
  }, [actionUser, closeActions, roleMut])

  const handleDelete = useCallback(() => {
    if (!actionUser) return
    const target = actionUser
    closeActions()
    Alert.alert('Delete User', `Permanently delete ${target.username}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => deleteMut.mutate(target.id),
      },
    ])
  }, [actionUser, closeActions, deleteMut])

  const onRefresh = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    refetch()
  }, [refetch])

  const users = data ?? []
  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim()
    return users.filter(u =>
      !term
      || u.username.toLowerCase().includes(term)
      || u.email.toLowerCase().includes(term)
      || u.role.toLowerCase().includes(term)
    )
  }, [users, search])

  const selectedUser = actionUser
  const isSelf = selectedUser && currentUser ? selectedUser.id === currentUser.id : false
  const toggleDisabled = !!(selectedUser && selectedUser.is_active && isSelf)
  const toggleLabel = selectedUser ? (selectedUser.is_active ? 'Deactivate' : 'Activate') : ''
  const toggleColor = selectedUser && selectedUser.is_active ? '#f97316' : '#34d399'

  return (
    <>
      {selectedUser && (
        <Modal
          transparent
          animationType="fade"
          visible
          onRequestClose={closeActions}
        >
          <View style={{ flex: 1, backgroundColor: '#00000099', justifyContent: 'flex-end' }}>
            <Pressable style={{ flex: 1 }} onPress={closeActions} />
            <View style={{
              backgroundColor: '#111418',
              paddingHorizontal: 16,
              paddingTop: 18,
              paddingBottom: 26,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              gap: 16,
            }}>
              <View style={{ alignItems: 'center', gap: 4 }}>
                <MonoText size={15} style={{ fontWeight: '700' }}>{selectedUser.username}</MonoText>
                <MonoText size={11} color="#64748b">{selectedUser.email}</MonoText>
              </View>

              <View style={{ gap: 10 }}>
                <TouchableOpacity
                  activeOpacity={toggleDisabled ? 1 : 0.75}
                  disabled={toggleDisabled}
                  onPress={handleToggleActive}
                  style={{
                    paddingVertical: 12,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: '#1e252e',
                    backgroundColor: '#161b23',
                    opacity: toggleDisabled ? 0.4 : 1,
                  }}
                >
                  <MonoText size={13} color={toggleColor} style={{ textAlign: 'center', fontWeight: '600' }}>
                    {toggleLabel}
                  </MonoText>
                </TouchableOpacity>
                {toggleDisabled && (
                  <MonoText size={10} color="#f97316" style={{ textAlign: 'center' }}>
                    You can’t deactivate yourself
                  </MonoText>
                )}

                <TouchableOpacity
                  activeOpacity={0.75}
                  onPress={handleChangeRole}
                  style={{
                    paddingVertical: 12,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: '#1e252e',
                    backgroundColor: '#161b23',
                  }}
                >
                  <MonoText size={13} color="#60a5fa" style={{ textAlign: 'center', fontWeight: '600' }}>
                    Change Role…
                  </MonoText>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.75}
                  onPress={handleDelete}
                  style={{
                    paddingVertical: 12,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: c.border,
                    backgroundColor: c.danger + '15',
                  }}
                >
                  <MonoText size={13} color={c.danger} style={{ textAlign: 'center', fontWeight: '600' }}>
                    Delete User
                  </MonoText>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                activeOpacity={0.75}
                onPress={closeActions}
                style={{
                  paddingVertical: 12,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: c.border,
                  backgroundColor: c.surface,
                }}
              >
                <MonoText size={13} color={c.text} style={{ textAlign: 'center', fontWeight: '600' }}>
                  Cancel
                </MonoText>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ padding: 16, paddingBottom: 8 }}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search users…"
          placeholderTextColor={c.textMuted}
          style={{
            backgroundColor: c.inputBg, borderWidth: 1, borderColor: c.inputBorder,
            borderRadius: 8, padding: 10, color: c.text,
            fontSize: 13, fontFamily: 'SpaceMono-Regular',
          }}
        />
      </View>

      {isLoading ? (
        <LoadingState label="Loading users…" />
      ) : isError ? (
        <ErrorState message="Failed to load users" onRetry={refetch} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={u => u.id.toString()}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
          ListHeaderComponent={<SectionHeader title="Users" count={filtered.length} />}
          ListEmptyComponent={<EmptyState label="No users found" icon="◈" />}
          refreshControl={
            <RefreshControl refreshing={isFetching} onRefresh={onRefresh} tintColor="#3b82f6" />
          }
          renderItem={({ item }) => (
            <UserCard user={item} onAction={handleAction} />
          )}
        />
      )}
      </View>
    </>
  )
}
