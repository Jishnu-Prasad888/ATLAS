import React, { useCallback, useMemo, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
} from 'react-native'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as Haptics from 'expo-haptics'
import { usersApi, agentsApi } from '@/api/endpoints'
import { useTheme } from '@/theme'
import { Card, MonoText, EmptyState, LoadingState, ErrorState, Badge } from '@/components/common'
import { Organization, Agent } from '@/types'

interface OrganizationForm {
  name: string
  description: string
  agentIds: string
}

const initialForm: OrganizationForm = {
  name: '',
  description: '',
  agentIds: '',
}

function parseAgentIds(input: string): string[] {
  return input
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function OrganizationCard({ org, onEdit, onDelete }: {
  org: Organization
  onEdit: () => void
  onDelete: () => void
}) {
  const { palette: c } = useTheme()

  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <View style={{ flex: 1, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: c.text, fontSize: 16, fontFamily: 'SpaceMono-Regular', fontWeight: '700' }}>
              {org.name}
            </Text>
            <Badge label={`ID ${org.id}`} />
          </View>
          {org.description ? (
            <MonoText size={11} color={c.textMuted}>{org.description}</MonoText>
          ) : null}
          <View style={{ flexWrap: 'wrap', gap: 6, flexDirection: 'row', marginTop: 4 }}>
            {org.agent_ids.length === 0 ? (
              <MonoText size={10} color={c.textMuted}>No agents linked</MonoText>
            ) : (
              org.agent_ids.map((id) => <Badge key={id} label={id} />)
            )}
          </View>
        </View>
        <View style={{ gap: 8 }}>
          <TouchableOpacity onPress={onEdit}>
            <MonoText size={11} color={c.primary}>Edit</MonoText>
          </TouchableOpacity>
          <TouchableOpacity onPress={onDelete}>
            <MonoText size={11} color={c.danger}>Delete</MonoText>
          </TouchableOpacity>
        </View>
      </View>
    </Card>
  )
}

export function OrganizationsScreen() {
  const { palette: c } = useTheme()
  const qc = useQueryClient()
  const [form, setForm] = useState<OrganizationForm>(initialForm)
  const [editing, setEditing] = useState<Organization | null>(null)

  const organizationsQuery = useQuery({
    queryKey: ['organizations'],
    queryFn: () => usersApi.organizations().then((res) => res.data),
  })

  const agentsQuery = useQuery({
    queryKey: ['agents-lite'],
    queryFn: () => agentsApi.list().then((res) => res.data ?? []),
  })

  const createMutation = useMutation({
    mutationFn: async (payload: OrganizationForm) => {
      const agent_ids = parseAgentIds(payload.agentIds)
      const response = await usersApi.createOrganization({
        name: payload.name.trim(),
        description: payload.description.trim() || undefined,
        agent_ids,
      })
      return response.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organizations'] })
      setForm(initialForm)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Failed to create organization'
      Alert.alert('Create failed', message)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    },
  })

  const updateMutation = useMutation({
    mutationFn: async ({ org, payload }: { org: Organization; payload: OrganizationForm }) => {
      const agent_ids = parseAgentIds(payload.agentIds)
      const response = await usersApi.updateOrganization(org.id, {
        name: payload.name.trim(),
        description: payload.description.trim() || undefined,
        agent_ids,
      })
      return response.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organizations'] })
      setEditing(null)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Failed to update organization'
      Alert.alert('Update failed', message)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (org: Organization) => {
      await usersApi.deleteOrganization(org.id)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organizations'] })
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Failed to delete organization'
      Alert.alert('Delete failed', message)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    },
  })

  const handleSubmit = useCallback(() => {
    if (!form.name.trim()) {
      Alert.alert('Validation', 'Name is required')
      return
    }

    if (editing) {
      updateMutation.mutate({ org: editing, payload: form })
    } else {
      createMutation.mutate(form)
    }
  }, [createMutation, editing, form, updateMutation])

  const handleEdit = useCallback((org: Organization) => {
    setEditing(org)
    setForm({
      name: org.name,
      description: org.description ?? '',
      agentIds: org.agent_ids.join(', '),
    })
    Haptics.selectionAsync()
  }, [])

  const handleDelete = useCallback((org: Organization) => {
    Alert.alert(
      'Delete organization',
      `Are you sure you want to remove ${org.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteMutation.mutate(org),
        },
      ],
    )
  }, [deleteMutation])

  const resetForm = useCallback(() => {
    setForm(initialForm)
    setEditing(null)
    Haptics.selectionAsync()
  }, [])

  const agentsLookup = useMemo(() => {
    const agents = agentsQuery.data ?? []
    const map = new Map<string, Agent>()
    agents.forEach((agent) => {
      map.set(agent.agent_id, agent as Agent)
    })
    return map
  }, [agentsQuery.data])

  const organizations = organizationsQuery.data ?? []

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16, backgroundColor: c.bg }}>
      <Card>
        <View style={{ gap: 10 }}>
          <Text style={{ color: c.text, fontSize: 18, fontFamily: 'SpaceMono-Regular', fontWeight: '700' }}>
            organizations
          </Text>
          <MonoText size={11} color={c.textMuted}>
            Group agents for scoped access and reporting. Assign IDs as a comma-separated list.
          </MonoText>

          <View style={{ gap: 6 }}>
            <MonoText size={10} color={c.textMuted} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>Name</MonoText>
            <TextInput
              value={form.name}
              onChangeText={(text) => setForm((prev) => ({ ...prev, name: text }))}
              placeholder="Finance cluster"
              placeholderTextColor={c.textMuted}
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
            <MonoText size={10} color={c.textMuted} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>Description</MonoText>
            <TextInput
              value={form.description}
              onChangeText={(text) => setForm((prev) => ({ ...prev, description: text }))}
              placeholder="Optional summary"
              placeholderTextColor={c.textMuted}
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
            <MonoText size={10} color={c.textMuted} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>Agent IDs</MonoText>
            <TextInput
              value={form.agentIds}
              onChangeText={(text) => setForm((prev) => ({ ...prev, agentIds: text }))}
              placeholder="agent-a, agent-b"
              placeholderTextColor={c.textMuted}
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
            <MonoText size={10} color={c.textMuted}>
              {agentsLookup.size ? `${agentsLookup.size} agents available` : 'Agents sync in background'}
            </MonoText>
          </View>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity
              onPress={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
              style={{
                flex: 1,
                borderRadius: 12,
                backgroundColor: c.primary,
                paddingVertical: 14,
                alignItems: 'center',
                borderWidth: 1,
                borderColor: c.primary,
              }}
            >
              <Text style={{ color: '#0b111b', fontFamily: 'SpaceMono-Regular', fontSize: 13, fontWeight: '700' }}>
                {editing ? 'Save changes' : 'Create organization'}
              </Text>
            </TouchableOpacity>
            {editing ? (
              <TouchableOpacity
                onPress={resetForm}
                style={{
                  minWidth: 90,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: c.border,
                  paddingVertical: 14,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: c.textMuted, fontFamily: 'SpaceMono-Regular', fontSize: 12 }}>Cancel</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </Card>

      {organizationsQuery.isLoading ? (
        <LoadingState label="Loading organizations…" />
      ) : organizationsQuery.isError ? (
        <ErrorState message="Failed to load organizations" onRetry={organizationsQuery.refetch} />
      ) : organizations.length === 0 ? (
        <Card>
          <EmptyState label="No organizations created" detail="Add one to scope access quickly." />
        </Card>
      ) : (
        <View style={{ gap: 12 }}>
          {organizations.map((org) => (
            <OrganizationCard
              key={org.id}
              org={org}
              onEdit={() => handleEdit(org)}
              onDelete={() => handleDelete(org)}
            />
          ))}
        </View>
      )}
    </ScrollView>
  )
}

export default OrganizationsScreen
