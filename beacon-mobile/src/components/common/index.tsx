import React from 'react'
import { View, Text, ActivityIndicator, TouchableOpacity, ViewStyle } from 'react-native'
import { clamp } from '@/utils/format'

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
export function Badge({ label, color = '#d4dae3', bg = '#1e252e' }: BadgeProps) {
  return (
    <View style={{ backgroundColor: bg, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 }}>
      <Text style={{ fontSize: 10, color, fontFamily: 'SpaceMono-Regular', fontWeight: '600' }}>
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
  return (
    <View style={[{ height, backgroundColor: '#1e252e', borderRadius: 999, overflow: 'hidden' }, style]}>
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
  if (onPress) {
    return (
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.7}
        style={[{
          backgroundColor: '#111418',
          borderWidth: 1,
          borderColor: '#1e252e',
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
        backgroundColor: '#111418',
        borderWidth: 1,
        borderColor: '#1e252e',
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
}
export function SectionHeader({ title, count, right, color = '#3a4555' }: SectionHeaderProps) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
      <Text style={{
        fontSize: 10, color, fontFamily: 'SpaceMono-Regular',
        textTransform: 'uppercase', letterSpacing: 1.2, fontWeight: '700',
      }}>
        {title}
      </Text>
      {count != null && (
        <View style={{
          marginLeft: 8, backgroundColor: '#181c22', borderWidth: 1,
          borderColor: '#1e252e', borderRadius: 20, paddingHorizontal: 6, paddingVertical: 1,
        }}>
          <Text style={{ fontSize: 9, color: '#3a4555', fontFamily: 'SpaceMono-Regular' }}>{count}</Text>
        </View>
      )}
      {right && <View style={{ marginLeft: 'auto' }}>{right}</View>}
    </View>
  )
}

// ─── LoadingState ─────────────────────────────────────────────────────────────

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <ActivityIndicator color="#3b82f6" />
      <Text style={{ color: '#5a6878', fontSize: 12, fontFamily: 'SpaceMono-Regular' }}>{label}</Text>
    </View>
  )
}

// ─── EmptyState ───────────────────────────────────────────────────────────────

export function EmptyState({ label = 'No data', icon = '○' }: { label?: string; icon?: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 32 }}>
      <Text style={{ fontSize: 28, color: '#3a4555' }}>{icon}</Text>
      <Text style={{ color: '#5a6878', fontSize: 12, fontFamily: 'SpaceMono-Regular' }}>{label}</Text>
    </View>
  )
}

// ─── ErrorState ───────────────────────────────────────────────────────────────

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
      <Text style={{ fontSize: 24, color: '#ef4444' }}>⚠</Text>
      <Text style={{ color: '#ef4444', fontSize: 12, fontFamily: 'SpaceMono-Regular', textAlign: 'center' }}>
        {message || 'Something went wrong'}
      </Text>
      {onRetry && (
        <TouchableOpacity
          onPress={onRetry}
          style={{
            marginTop: 4,
            borderWidth: 1, borderColor: '#2a3340', borderRadius: 8,
            paddingHorizontal: 16, paddingVertical: 8,
          }}
        >
          <Text style={{ color: '#d4dae3', fontSize: 12, fontFamily: 'SpaceMono-Regular' }}>Retry</Text>
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
}
export function MonoText({ children, size = 12, color = '#d4dae3', style }: MonoTextProps) {
  return (
    <Text style={[{ fontSize: size, color, fontFamily: 'SpaceMono-Regular' }, style]}>
      {children}
    </Text>
  )
}

// ─── Divider ─────────────────────────────────────────────────────────────────

export function Divider({ style }: { style?: ViewStyle }) {
  return <View style={[{ height: 1, backgroundColor: '#1e252e' }, style]} />
}
