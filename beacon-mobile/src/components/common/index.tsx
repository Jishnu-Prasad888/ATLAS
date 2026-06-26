import React from 'react'
import { View, Text, ActivityIndicator, TouchableOpacity, ViewStyle } from 'react-native'
import { clamp } from '@/utils/format'
import { useTheme } from '@/theme'

// ─── StatusDot ────────────────────────────────────────────────────────────────

interface StatusDotProps {
  color: string
  size?: number
}
export function StatusDot({ color, size = 7 }: StatusDotProps) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
      }}
    />
  )
}

// ─── Badge ────────────────────────────────────────────────────────────────────

interface BadgeProps {
  label: string
  color?: string
  bg?: string
}
export function Badge({ label, color, bg }: BadgeProps) {
  const { palette: c } = useTheme()
  return (
    <View style={{ backgroundColor: bg ?? c.chipBg, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 }}>
      <Text style={{ fontSize: 10, color: color ?? c.chipText, fontFamily: 'SpaceMono-Regular', fontWeight: '600' }}>
        {label}
      </Text>
    </View>
  )
}

// ─── MetricBar ────────────────────────────────────────────────────────────────

interface MetricBarProps {
  value: number          // 0–100
  color?: string
  height?: number
  style?: ViewStyle
}
export function MetricBar({ value, color = '#3b82f6', height = 3, style }: MetricBarProps) {
  const pct = clamp(value, 0, 100)
  const { palette: c } = useTheme()
  return (
    <View style={[{ height, backgroundColor: c.border, borderRadius: 999, overflow: 'hidden' }, style]}>
      <View
        style={{
          position: 'absolute',
          left: 0, top: 0, bottom: 0,
          width: `${pct}%`,
          backgroundColor: color,
          borderRadius: 999,
        }}
      />
    </View>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────

interface CardProps {
  children: React.ReactNode
  style?: ViewStyle
  onPress?: () => void
}
export function Card({ children, style, onPress }: CardProps) {
  const { palette: c } = useTheme()
  if (onPress) {
    return (
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.7}
        style={[{
          backgroundColor: c.surface,
          borderWidth: 1,
          borderColor: c.border,
          borderRadius: 10,
          padding: 14,
        }, style]}
      >
        {children}
      </TouchableOpacity>
    )
  }
  return (
    <View
      style={[{
        backgroundColor: c.surface,
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: 10,
        padding: 14,
      }, style]}
    >
      {children}
    </View>
  )
}

// ─── SectionHeader ────────────────────────────────────────────────────────────

interface SectionHeaderProps {
  title: string
  count?: number | string
  right?: React.ReactNode
  color?: string
  description?: string
}
export function SectionHeader({ title, count, right, color, description }: SectionHeaderProps) {
  const { palette: c } = useTheme()
  return (
    <View style={{ marginBottom: description ? 12 : 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{
          fontSize: 10, color: color || c.textDim, fontFamily: 'SpaceMono-Regular',
          textTransform: 'uppercase', letterSpacing: 1.2, fontWeight: '700',
        }}>
          {title}
        </Text>
        {count != null && (
          <View style={{
            marginLeft: 8, backgroundColor: c.surface2, borderWidth: 1,
            borderColor: c.border, borderRadius: 20, paddingHorizontal: 6, paddingVertical: 1,
          }}>
            <Text style={{ fontSize: 9, color: c.textMuted, fontFamily: 'SpaceMono-Regular' }}>{count}</Text>
          </View>
        )}
        {right && <View style={{ marginLeft: 'auto' }}>{right}</View>}
      </View>
      {description && (
        <Text style={{ fontSize: 11, color: c.textMuted, fontFamily: 'SpaceMono-Regular', marginTop: 4 }}>
          {description}
        </Text>
      )}
    </View>
  )
}

// ─── LoadingState ─────────────────────────────────────────────────────────────

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  const { palette: c } = useTheme()
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <ActivityIndicator color={c.primary} />
      <Text style={{ color: c.textMuted, fontSize: 12, fontFamily: 'SpaceMono-Regular' }}>{label}</Text>
    </View>
  )
}

// ─── EmptyState ───────────────────────────────────────────────────────────────

export function EmptyState({ label = 'No data', detail, icon = '○' }: { label?: string; detail?: string; icon?: string }) {
  const { palette: c } = useTheme()
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 32 }}>
      <Text style={{ fontSize: 28, color: c.textMuted }}>{icon}</Text>
      <Text style={{ color: c.textMuted, fontSize: 12, fontFamily: 'SpaceMono-Regular' }}>{label}</Text>
      {detail && (
        <Text style={{ color: c.textDim, fontSize: 10, fontFamily: 'SpaceMono-Regular', textAlign: 'center', paddingHorizontal: 12 }}>
          {detail}
        </Text>
      )}
    </View>
  )
}

// ─── ErrorState ───────────────────────────────────────────────────────────────

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const { palette: c } = useTheme()
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
      <Text style={{ fontSize: 24, color: c.danger }}>⚠</Text>
      <Text style={{ color: c.danger, fontSize: 12, fontFamily: 'SpaceMono-Regular', textAlign: 'center' }}>
        {message || 'Something went wrong'}
      </Text>
      {onRetry && (
        <TouchableOpacity
          onPress={onRetry}
          style={{
            marginTop: 4,
            borderWidth: 1, borderColor: c.border, borderRadius: 8,
            paddingHorizontal: 16, paddingVertical: 8,
          }}
        >
          <Text style={{ color: c.text, fontSize: 12, fontFamily: 'SpaceMono-Regular' }}>Retry</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

// ─── Mono Label ───────────────────────────────────────────────────────────────

interface MonoTextProps {
  children: React.ReactNode
  size?: number
  color?: string
  style?: object
  numberOfLines?: number
}
export function MonoText({ children, size = 12, color, style, numberOfLines }: MonoTextProps) {
  const { palette: c } = useTheme()
  return (
    <Text
      style={[{ fontSize: size, color: color ?? c.text, fontFamily: 'SpaceMono-Regular' }, style]}
      numberOfLines={numberOfLines}
    >
      {children}
    </Text>
  )
}

// ─── Toggle ─────────────────────────────────────────────────────────────────

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const { palette: c } = useTheme()
  return (
    <TouchableOpacity
      onPress={() => onChange(!checked)}
      activeOpacity={0.8}
      disabled={disabled}
      style={{
        width: 44,
        height: 24,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: checked ? c.primary : c.border,
        backgroundColor: checked ? c.primary + '33' : c.surface2,
        justifyContent: 'center',
        paddingHorizontal: 4,
      }}
    >
      <View
        style={{
          width: 18,
          height: 18,
          borderRadius: 9,
          backgroundColor: checked ? c.primary : c.textMuted,
          alignSelf: checked ? 'flex-end' : 'flex-start',
        }}
      />
    </TouchableOpacity>
  )
}

// ─── Divider ─────────────────────────────────────────────────────────────────

export function Divider({ style }: { style?: ViewStyle }) {
  const { palette: c } = useTheme()
  return <View style={[{ height: 1, backgroundColor: c.border }, style]} />
}
