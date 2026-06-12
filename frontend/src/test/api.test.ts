import { describe, it, expect, beforeEach, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { authApi } from '@/api/auth'
import { ApiError, setTokens, clearTokens, parseJwt, getAccessToken, getRefreshToken } from '@/api/client'
import { MOCK_ACCESS_TOKEN, MOCK_REFRESH_TOKEN } from '@/mocks/handlers'

describe('parseJwt', () => {
  it('decodes a JWT payload', () => {
    const payload = parseJwt<{ username: string; role: string }>(MOCK_ACCESS_TOKEN)
    expect(payload.username).toBe('admin')
    expect(payload.role).toBe('administrator')
  })
})

describe('token management', () => {
  beforeEach(() => {
    clearTokens()
  })

  it('sets and retrieves tokens', () => {
    setTokens('access123', 'refresh456')
    expect(getAccessToken()).toBe('access123')
    expect(getRefreshToken()).toBe('refresh456')
  })

  it('clears tokens', () => {
    setTokens('access123', 'refresh456')
    clearTokens()
    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })
})

describe('authApi.login', () => {
  beforeEach(() => {
    clearTokens()
  })

  it('returns tokens on valid credentials', async () => {
    const result = await authApi.login('admin', 'correctpassword')
    expect(result.access).toBe(MOCK_ACCESS_TOKEN)
    expect(result.refresh).toBe(MOCK_REFRESH_TOKEN)
  })

  it('throws ApiError on invalid credentials', async () => {
    await expect(authApi.login('admin', 'wrongpassword')).rejects.toBeInstanceOf(ApiError)
  })

  it('ApiError has correct status', async () => {
    try {
      await authApi.login('admin', 'wrongpassword')
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError)
      expect((e as ApiError).status).toBe(400)
    }
  })
})

describe('authApi.logout', () => {
  it('returns success detail', async () => {
    setTokens(MOCK_ACCESS_TOKEN, MOCK_REFRESH_TOKEN)
    const result = await authApi.logout(MOCK_REFRESH_TOKEN)
    expect(result.detail).toBe('Logged out successfully.')
  })
})

describe('authApi.whoami', () => {
  it('returns user object', async () => {
    setTokens(MOCK_ACCESS_TOKEN, MOCK_REFRESH_TOKEN)
    const user = await authApi.whoami()
    expect(user.username).toBe('admin')
    expect(user.role).toBe('administrator')
  })
})

describe('authApi.generateRecoveryKey', () => {
  it('returns recovery key and warning', async () => {
    setTokens(MOCK_ACCESS_TOKEN, MOCK_REFRESH_TOKEN)
    const result = await authApi.generateRecoveryKey()
    expect(result.recovery_key).toMatch(/[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}/i)
    expect(result.warning).toBeTruthy()
  })
})

describe('authApi.changePassword', () => {
  it('returns success detail', async () => {
    setTokens(MOCK_ACCESS_TOKEN, MOCK_REFRESH_TOKEN)
    const result = await authApi.changePassword('oldpass', 'newpassword123')
    expect(result.detail).toBe('Password changed successfully.')
  })
})

describe('ApiError silent refresh', () => {
  it('retries request after 401 with valid refresh token', async () => {
    setTokens('expired-token', MOCK_REFRESH_TOKEN)

    // Override whoami to return 401 on first call, then succeed
    let callCount = 0
    server.use(
      http.get('/api/v1/auth/whoami/', () => {
        callCount++
        if (callCount === 1) {
          return HttpResponse.json({ detail: 'Token is invalid or expired.' }, { status: 401 })
        }
        return HttpResponse.json({ id: 1, username: 'admin', role: 'administrator', email: '', is_active: true, created_at: '', last_login: null })
      })
    )

    const result = await authApi.whoami()
    expect(result.username).toBe('admin')
    expect(callCount).toBe(2) // First call fails, second succeeds after refresh
  })

  it('dispatches session-expired event when refresh fails', async () => {
    setTokens('expired-token', 'also-expired-refresh')

    server.use(
      http.get('/api/v1/auth/whoami/', () =>
        HttpResponse.json({ detail: 'Token is invalid or expired.' }, { status: 401 })
      ),
      http.post('/api/v1/auth/refresh/', () =>
        HttpResponse.json({ detail: 'Token is invalid or expired.' }, { status: 401 })
      )
    )

    const eventFired = vi.fn()
    window.addEventListener('beacon:session-expired', eventFired)

    try {
      await authApi.whoami()
    } catch {
      // expected to throw
    }

    // Give the event loop a tick
    await new Promise((r) => setTimeout(r, 0))

    expect(eventFired).toHaveBeenCalled()
    window.removeEventListener('beacon:session-expired', eventFired)
  })
})
