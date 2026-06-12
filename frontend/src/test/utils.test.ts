import { describe, it, expect } from 'vitest'
import {
  formatBytes,
  formatBandwidth,
  formatUptime,
  timeAgo,
  shortAgentId,
  formatPct,
  gaugeColor,
  validatePassword,
  validateUsername,
  validateEmail,
  validateRecoveryKey,
  validateHostname,
  validateIntervalSeconds,
  validateRetentionDays,
  mapServerErrors,
  agentStatusVariant,
  collectorStatusVariant,
  LOG_SOURCE_LABEL,
} from '@/utils'

describe('formatBytes', () => {
  it('returns 0 B for zero', () => {
    expect(formatBytes(0)).toBe('0 B')
  })

  it('formats kilobytes', () => {
    // parseFloat strips trailing zeros, so 1.0 -> '1'
    expect(formatBytes(1024)).toMatch(/^1(\.\d+)? KB$/)
  })

  it('formats megabytes', () => {
    expect(formatBytes(1024 * 1024)).toMatch(/^1(\.\d+)? MB$/)
  })

  it('formats gigabytes', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toMatch(/^1(\.\d+)? GB$/)
  })

  it('formats terabytes', () => {
    expect(formatBytes(1024 * 1024 * 1024 * 1024)).toMatch(/^1(\.\d+)? TB$/)
  })

  it('respects decimal places', () => {
    // 1536 bytes = 1.5 KB; parseFloat('1.50') = 1.5 -> '1.5'
    expect(formatBytes(1536, 2)).toMatch(/^1\.5\d* KB$/)
  })

  it('handles partial gigabytes', () => {
    expect(formatBytes(536870912)).toMatch(/^512(\.\d+)? MB$/)
  })
})

describe('formatBandwidth', () => {
  it('appends /s suffix', () => {
    expect(formatBandwidth(1024)).toMatch(/^1(\.\d+)? KB\/s$/)
  })

  it('handles zero', () => {
    expect(formatBandwidth(0)).toBe('0 B/s')
  })
})

describe('formatUptime', () => {
  it('formats minutes only', () => {
    expect(formatUptime(300)).toBe('5m')
  })

  it('formats hours and minutes', () => {
    expect(formatUptime(3900)).toBe('1h 5m')
  })

  it('formats days, hours and minutes', () => {
    expect(formatUptime(90061)).toBe('1d 1h 1m')
  })

  it('formats zero as 0m', () => {
    expect(formatUptime(0)).toBe('0m')
  })

  it('formats exactly 1 day', () => {
    expect(formatUptime(86400)).toBe('1d 0h 0m')
  })
})

describe('timeAgo', () => {
  it('returns Never for null', () => {
    expect(timeAgo(null)).toBe('Never')
  })

  it('returns seconds ago', () => {
    const ts = new Date(Date.now() - 30_000).toISOString()
    expect(timeAgo(ts)).toBe('30s ago')
  })

  it('returns minutes ago', () => {
    const ts = new Date(Date.now() - 5 * 60_000).toISOString()
    expect(timeAgo(ts)).toBe('5m ago')
  })

  it('returns hours ago', () => {
    const ts = new Date(Date.now() - 3 * 3600_000).toISOString()
    expect(timeAgo(ts)).toBe('3h ago')
  })

  it('returns days ago', () => {
    const ts = new Date(Date.now() - 2 * 86400_000).toISOString()
    expect(timeAgo(ts)).toBe('2d ago')
  })
})

describe('shortAgentId', () => {
  it('strips sha256 prefix and truncates', () => {
    const full = 'sha256:a3f1b2e4c5d6e7f8a9b0'
    expect(shortAgentId(full)).toBe('a3f1b2e4c5d6...')
  })

  it('handles non-sha256 IDs', () => {
    // 'regen-abc123def456' has no 'sha256:' prefix, slices first 12 chars
    expect(shortAgentId('regen-abc123def456')).toBe('regen-abc123...')
  })
})

describe('formatPct', () => {
  it('formats with one decimal by default', () => {
    expect(formatPct(34.2)).toBe('34.2%')
  })

  it('respects decimal parameter', () => {
    expect(formatPct(34.2, 0)).toBe('34%')
  })
})

describe('gaugeColor', () => {
  it('returns green for low values', () => {
    expect(gaugeColor(50)).toBe('#22c55e')
  })

  it('returns yellow at warn threshold', () => {
    expect(gaugeColor(75)).toBe('#eab308')
  })

  it('returns red at danger threshold', () => {
    expect(gaugeColor(95)).toBe('#ef4444')
  })

  it('accepts custom thresholds', () => {
    expect(gaugeColor(60, 50, 80)).toBe('#eab308')
    expect(gaugeColor(85, 50, 80)).toBe('#ef4444')
    expect(gaugeColor(30, 50, 80)).toBe('#22c55e')
  })
})

describe('validatePassword', () => {
  it('returns null for valid password', () => {
    expect(validatePassword('securepassword123')).toBeNull()
  })

  it('returns error for short password', () => {
    expect(validatePassword('short')).toBe('Password must be at least 12 characters.')
  })

  it('accepts exactly 12 characters', () => {
    expect(validatePassword('exactly12chr')).toBeNull()
  })
})

describe('validateUsername', () => {
  it('returns null for valid username', () => {
    expect(validateUsername('admin')).toBeNull()
  })

  it('returns error for empty username', () => {
    expect(validateUsername('')).toBe('Username is required.')
    expect(validateUsername('   ')).toBe('Username is required.')
  })

  it('returns error for username exceeding 150 chars', () => {
    expect(validateUsername('a'.repeat(151))).toBe('Username must be 150 characters or fewer.')
  })

  it('accepts exactly 150 characters', () => {
    expect(validateUsername('a'.repeat(150))).toBeNull()
  })
})

describe('validateEmail', () => {
  it('returns null for empty (optional field)', () => {
    expect(validateEmail('')).toBeNull()
  })

  it('returns null for valid email', () => {
    expect(validateEmail('user@example.com')).toBeNull()
  })

  it('returns error for invalid email', () => {
    expect(validateEmail('not-an-email')).toBe('Enter a valid email address.')
    expect(validateEmail('@nodomain.com')).toBe('Enter a valid email address.')
  })
})

describe('validateRecoveryKey', () => {
  it('returns null for valid key', () => {
    expect(validateRecoveryKey('A3F1-B2E4-C5D6-E7F8')).toBeNull()
  })

  it('is case-insensitive', () => {
    expect(validateRecoveryKey('a3f1-b2e4-c5d6-e7f8')).toBeNull()
  })

  it('returns error for wrong format', () => {
    expect(validateRecoveryKey('A3F1-B2E4-C5D6')).toBeTruthy()
    expect(validateRecoveryKey('GGGG-GGGG-GGGG-GGGG')).toBeTruthy()
    expect(validateRecoveryKey('')).toBeTruthy()
  })
})

describe('validateHostname', () => {
  it('returns null for valid hostname', () => {
    expect(validateHostname('prod-server-01')).toBeNull()
  })

  it('returns error for empty hostname', () => {
    expect(validateHostname('')).toBe('Hostname is required.')
  })

  it('returns error for hostname over 253 chars', () => {
    expect(validateHostname('a'.repeat(254))).toBe('Hostname must be 253 characters or fewer.')
  })
})

describe('validateIntervalSeconds', () => {
  it('returns null for valid integer', () => {
    expect(validateIntervalSeconds(5)).toBeNull()
    expect(validateIntervalSeconds(1)).toBeNull()
  })

  it('returns error for zero', () => {
    expect(validateIntervalSeconds(0)).toBeTruthy()
  })

  it('returns error for negative', () => {
    expect(validateIntervalSeconds(-1)).toBeTruthy()
  })

  it('returns error for non-integer', () => {
    expect(validateIntervalSeconds(1.5)).toBeTruthy()
  })
})

describe('validateRetentionDays', () => {
  it('returns null for valid integer', () => {
    expect(validateRetentionDays(30)).toBeNull()
  })

  it('returns error for zero', () => {
    expect(validateRetentionDays(0)).toBeTruthy()
  })
})

describe('mapServerErrors', () => {
  it('maps field errors', () => {
    const result = mapServerErrors({ username: ['This field is required.'] })
    expect(result.username).toBe('This field is required.')
  })

  it('maps detail to _global', () => {
    const result = mapServerErrors({ detail: 'Invalid credentials.' })
    expect(result._global).toBe('Invalid credentials.')
  })

  it('maps non_field_errors to _global', () => {
    const result = mapServerErrors({ non_field_errors: ['Invalid recovery key.'] })
    expect(result._global).toBe('Invalid recovery key.')
  })

  it('handles array values by taking first', () => {
    const result = mapServerErrors({ password: ['Too short.', 'Too simple.'] })
    expect(result.password).toBe('Too short.')
  })

  it('handles mixed errors', () => {
    const result = mapServerErrors({
      username: ['Already exists.'],
      detail: 'Validation failed.',
    })
    expect(result.username).toBe('Already exists.')
    expect(result._global).toBe('Validation failed.')
  })
})

describe('agentStatusVariant', () => {
  it('maps ONLINE to online', () => {
    expect(agentStatusVariant('ONLINE')).toBe('online')
  })

  it('maps DEGRADED to warning', () => {
    expect(agentStatusVariant('DEGRADED')).toBe('warning')
  })

  it('maps FAILED to error', () => {
    expect(agentStatusVariant('FAILED')).toBe('error')
  })

  it('maps OFFLINE to muted', () => {
    expect(agentStatusVariant('OFFLINE')).toBe('muted')
  })

  it('maps BOOTING to blue', () => {
    expect(agentStatusVariant('BOOTING')).toBe('blue')
  })
})

describe('collectorStatusVariant', () => {
  it('maps Healthy to online', () => {
    expect(collectorStatusVariant('Healthy')).toBe('online')
  })

  it('maps Degraded to warning', () => {
    expect(collectorStatusVariant('Degraded')).toBe('warning')
  })

  it('maps Failed to error', () => {
    expect(collectorStatusVariant('Failed')).toBe('error')
  })

  it('maps Disabled to muted', () => {
    expect(collectorStatusVariant('Disabled')).toBe('muted')
  })
})

describe('LOG_SOURCE_LABEL', () => {
  it('maps known sources', () => {
    expect(LOG_SOURCE_LABEL['systemd-journald']).toBe('Systemd')
    expect(LOG_SOURCE_LABEL['syslog']).toBe('Syslog')
    expect(LOG_SOURCE_LABEL['docker']).toBe('Docker')
    expect(LOG_SOURCE_LABEL['internal']).toBe('Beacon')
  })
})
