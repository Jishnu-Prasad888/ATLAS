import React from 'react'
import {
  View,
  Text,
  Pressable,
  ScrollView,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/theme'

export interface BottomTabItem<T extends string = string> {
  id: T
  label: string
  icon?: string
  renderIcon?: (color: string) => React.ReactNode
}

interface BottomTabBarProps<T extends string = string> {
  tabs: BottomTabItem<T>[]
  active: T
  onSelect: (id: T) => void
}

export function BottomTabBar<T extends string = string>({
  tabs,
  active,
  onSelect,
}: BottomTabBarProps<T>) {
  const insets = useSafeAreaInsets()
  const { palette: c } = useTheme()
  const [containerWidth, setContainerWidth] = React.useState(0)
  const [contentWidth, setContentWidth] = React.useState(0)
  const [scrollX, setScrollX] = React.useState(0)

  const canScroll = contentWidth - containerWidth > 1
  const trackInset = 4
  const trackWidth = Math.max(containerWidth - trackInset * 2, 0)
  const indicatorWidth = canScroll
    ? Math.min(
        trackWidth,
        Math.max((containerWidth / contentWidth) * trackWidth, 24)
      )
    : trackWidth
  const maxTranslate = Math.max(trackWidth - indicatorWidth, 0)
  const scrollableRange = Math.max(contentWidth - containerWidth, 0)
  const clampedScrollX = Math.min(Math.max(scrollX, 0), scrollableRange)
  const indicatorTranslate = canScroll && scrollableRange > 0
    ? (clampedScrollX / scrollableRange) * maxTranslate
    : 0

  return (
    <View
      style={{
        backgroundColor: c.bg,
        paddingTop: 4,
        paddingBottom: Math.max(insets.bottom + 10, 0),
      }}
    >
      <View
        style={{
          marginHorizontal: 4,
          backgroundColor: c.surface,
          borderRadius: 24,
          paddingVertical: 4,
          position: 'relative',
          shadowColor: '#000',
          shadowOpacity: 0.2,
          shadowRadius: 20,
          shadowOffset: {
            width: 0,
            height: -4,
          },
          elevation: 10,
          overflow: 'hidden',
        }}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          bounces
          scrollEventThrottle={16}
          onLayout={event => {
            const width = event.nativeEvent.layout.width
            if (width !== containerWidth) {
              setContainerWidth(width)
            }
          }}
          onContentSizeChange={(width: number, _height: number) => {
            if (width !== contentWidth) {
              setContentWidth(width)
            }
          }}
          onScroll={({ nativeEvent }) => {
            const offsetX = nativeEvent.contentOffset.x
            if (offsetX !== scrollX) {
              setScrollX(offsetX)
            }
          }}
          contentContainerStyle={{
            paddingHorizontal: 4,
            alignItems: 'center',
          }}
        >
          {tabs.map(tab => {
            const isActive = tab.id === active
            const iconColor = isActive ? '#FFFFFF' : c.textMuted
            const iconElement = tab.renderIcon
              ? tab.renderIcon(iconColor)
              : (
                <Text
                  style={{
                    fontSize: 16,
                    color: iconColor,
                  }}
                >
                  {tab.icon}
                </Text>
              )

            return (
              <Pressable
                key={tab.id}
                onPress={() => {
                  Haptics.selectionAsync()
                  onSelect(tab.id)
                }}
                style={{
                  marginHorizontal: 2,
                }}
              >
                <View
                  style={{
                    minWidth: 56,
                    maxWidth: 80,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 8,
                    paddingVertical: 6,
                    borderRadius: 14,
                    backgroundColor: isActive
                      ? c.primary
                      : 'transparent',
                  }}
                >
                  {iconElement}

                  <Text
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    style={{
                      marginTop: 2,
                      fontSize: 10,
                      fontWeight: '500',
                      color: isActive
                        ? '#FFFFFF'
                        : c.textMuted,
                      textAlign: 'center',
                    }}
                  >
                    {tab.label}
                  </Text>
                </View>
              </Pressable>
            )
          })}
        </ScrollView>

        {canScroll ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: trackInset,
              right: trackInset,
              bottom: 2,
              height: 2,
              borderRadius: 1,
              backgroundColor: c.border,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: indicatorWidth,
                borderRadius: 1,
                backgroundColor: c.textDim,
                transform: [
                  {
                    translateX: indicatorTranslate,
                  },
                ],
              }}
            />
          </View>
        ) : null}
      </View>
    </View>
  )
}
