import React from 'react'
import { LineChart } from 'react-native-svg-charts'

interface SparklineProps {
  data: number[]
  color: string
  width?: number
  height?: number
}

export function Sparkline({ data, color, width = 120, height = 40 }: SparklineProps) {
  if (!data.length) return null

  return (
    <LineChart
      style={{ width, height }}
      data={data}
      svg={{ stroke: color, strokeWidth: 2 }}
      contentInset={{ top: 6, bottom: 6 }}
    />
  )
}
