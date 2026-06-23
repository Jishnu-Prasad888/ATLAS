import React from 'react'
import { View, Text } from 'react-native'
import { useTheme } from '@/theme'
import { Card, MonoText } from '@/components/common'

export function NotFoundScreen() {
  const { palette: c } = useTheme()

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Card style={{ width: '100%', maxWidth: 360, alignItems: 'center', gap: 14 }}>
        <Text style={{ color: c.textMuted, fontSize: 24, fontFamily: 'SpaceMono-Regular' }}>404</Text>
        <MonoText size={14} style={{ textAlign: 'center', fontWeight: '700' }}>Screen not found</MonoText>
        <MonoText size={11} color={c.textMuted} style={{ textAlign: 'center' }}>
          The requested screen is unavailable on mobile. Return to the dashboard to continue.
        </MonoText>
      </Card>
    </View>
  )
}

export default NotFoundScreen
