import React from 'react'
import { View, Text } from 'react-native'
import { useTheme } from '@/theme'
import { Card, MonoText } from '@/components/common'

export function ForbiddenScreen() {
  const { palette: c } = useTheme()

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Card style={{ width: '100%', maxWidth: 360, alignItems: 'center', gap: 14 }}>
        <Text style={{ color: c.danger, fontSize: 24, fontFamily: 'SpaceMono-Regular' }}>✕</Text>
        <MonoText size={14} style={{ textAlign: 'center', fontWeight: '700' }}>Access denied</MonoText>
        <MonoText size={11} color={c.textMuted} style={{ textAlign: 'center' }}>
          You do not have permission to view this area. Contact an administrator to request additional roles.
        </MonoText>
      </Card>
    </View>
  )
}

export default ForbiddenScreen
