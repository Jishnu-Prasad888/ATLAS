declare module 'react-native-svg-charts' {
  import { ComponentType } from 'react'
  import { ViewProps } from 'react-native'

  export interface ChartProps extends ViewProps {
    data: number[]
    contentInset?: {
      top?: number
      bottom?: number
      left?: number
      right?: number
    }
    svg?: { [key: string]: any }
  }

  export const ProgressCircle: ComponentType<{
    progress?: number
    startAngle?: number
    endAngle?: number
    strokeWidth?: number
    progressColor?: string
    backgroundColor?: string
    style?: ViewProps['style']
  } & ViewProps>

  export const LineChart: ComponentType<ChartProps>
  export const AreaChart: ComponentType<ChartProps>
  export const Grid: ComponentType<ViewProps & { svg?: { [key: string]: any } }>
}
