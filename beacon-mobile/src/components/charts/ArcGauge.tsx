import React from 'react'
import { View, Text } from 'react-native'
import { ProgressCircle, LineChart, Grid } from 'react-native-svg-charts'
import { useTheme } from '@/theme'

interface ArcGaugeProps {
  value: number
  label: string
  detail?: string
  history?: number[]
}

function gaugeColor(value: number) {
  if (value >= 90) return '#ef4444'
  if (value >= 70) return '#f97316'
  if (value >= 50) return '#eab308'
  return '#22c55e'
}

export function ArcGauge({ value, label, detail, history }: ArcGaugeProps) {
  const { palette: c } = useTheme()
  const clamped = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0
  const color = gaugeColor(clamped)

  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ height: 120, width: 120, alignItems: 'center', justifyContent: 'center' , marginBottom:-26 }}>
        <ProgressCircle
          style={{ height: 120, width: 120, transform: [{ rotate: '-90deg' }] , marginBottom:-15 }}
          progress={clamped / 100}
          startAngle={0}
          endAngle={Math.PI}
          strokeWidth={12}
          progressColor={color}
          backgroundColor={c.border}
        />
        <Text style={{ position: 'absolute', top: 30, fontSize: 22, fontFamily: 'SpaceMono-Regular', fontWeight: '700', color }}>
          {Math.round(clamped)}%
        </Text>
      </View>
      {detail && (
        <Text style={{ fontSize: 11, fontFamily: 'SpaceMono-Regular', color: c.text, marginTop: -4 }}>{detail}</Text>
      )}
      <Text style={{ fontSize: 11, fontFamily: 'SpaceMono-Regular', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginTop: 6 , marginBottom: 10 }}>{label}</Text>
      {history && history.length > 1 && (
        <LineChart
          style={{ height: 50, width: 120, marginTop: 16 }}
          data={history}
          svg={{ stroke: color, strokeWidth: 2 }}
          contentInset={{ top: 6, bottom: 6 }}
        >
          <Grid svg={{ stroke: color + '20' }} />
        </LineChart>
      )}
    </View>
  )
}
