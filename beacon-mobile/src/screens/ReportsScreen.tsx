import React from 'react'
import { View, Text, TouchableOpacity } from 'react-native'
import { useTheme } from '@/theme'
import { Card, MonoText, EmptyState } from '@/components/common'
import { useAuthStore } from '@/store/authStore'

export function ReportsScreen() {
  const { palette: c } = useTheme()
  const { role } = useAuthStore()

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, padding: 16, gap: 16 }}>
      <Card>
        <View style={{ gap: 10 }}>
          <Text style={{ color: c.text, fontSize: 18, fontFamily: 'SpaceMono-Regular', fontWeight: '700' }}>
            reports
          </Text>
          <MonoText size={11} color={c.textMuted}>
            Export compliance-ready summaries tailored to your assigned organizations and agents. Administrators can schedule recurring digests.
          </MonoText>
          <MonoText size={10} color={c.textMuted}>
            Role: {role ?? 'unknown'}
          </MonoText>
          <TouchableOpacity
            style={{
              alignSelf: 'flex-start',
              borderRadius: 10,
              borderWidth: 1,
              borderColor: c.border,
              paddingHorizontal: 12,
              paddingVertical: 8,
              backgroundColor: c.surface2,
            }}
          >
            <MonoText size={11} color={c.textMuted}>Browse templates</MonoText>
          </TouchableOpacity>
        </View>
      </Card>

      <Card>
        <EmptyState label="Reporting data unavailable" detail="Connect the analytics backend or schedule your first export from the web console." />
      </Card>
    </View>
  )
}

export default ReportsScreen
