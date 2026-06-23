import React from 'react'
import { View, Text } from 'react-native'
import { useTheme } from '@/theme'
import { Card, MonoText } from '@/components/common'

export function AwaitingApprovalScreen() {
  const { palette: c } = useTheme()

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Card style={{ width: '100%', maxWidth: 360, alignItems: 'center', gap: 14 }}>
        <Text style={{ color: c.text, fontSize: 24, fontFamily: 'SpaceMono-Regular' }}>⏳</Text>
        <MonoText size={14} style={{ textAlign: 'center', fontWeight: '700' }}>Awaiting approval</MonoText>
        <MonoText size={11} color={c.textMuted} style={{ textAlign: 'center' }}>
          Your account is pending review. An administrator will notify you once access is granted.
        </MonoText>
      </Card>
    </View>
  )
}

export default AwaitingApprovalScreen
