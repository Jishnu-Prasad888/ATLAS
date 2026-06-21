import { describe, it, expect, beforeEach } from 'vitest'
import { useAuthStore } from '@/store/authStore'
import { clearTokens, getAccessToken } from '@/api/client'
import { MOCK_ACCESS_TOKEN, MOCK_REFRESH_TOKEN } from '@/mocks/handlers'

describe('authStore', () => {
  beforeEach(() => {
    useAuthStore.getState().logout()
    clearTokens()
  })

  it('starts unauthenticated', () => {
    const state = useAuthStore.getState()
    expect(state.isAuthenticated).toBe(false)
    expect(state.user).toBeNull()
    expect(state.isAdmin).toBe(false)
    expect(state.isApproved).toBe(false)
  })

  it('sets user on login', () => {
    useAuthStore.getState().login(MOCK_ACCESS_TOKEN, MOCK_REFRESH_TOKEN)
    const state = useAuthStore.getState()

    expect(state.isAuthenticated).toBe(true)
    expect(state.user).not.toBeNull()
    expect(state.user?.username).toBe('admin')
    expect(state.user?.role).toBe('administrator')
    expect(state.isAdmin).toBe(true)
    expect(state.isApproved).toBe(true)
  })

  it('stores access token in api client', () => {
    useAuthStore.getState().login(MOCK_ACCESS_TOKEN, MOCK_REFRESH_TOKEN)
    expect(getAccessToken()).toBe(MOCK_ACCESS_TOKEN)
  })

  it('stores tokens in store', () => {
    useAuthStore.getState().login(MOCK_ACCESS_TOKEN, MOCK_REFRESH_TOKEN)
    const state = useAuthStore.getState()
    expect(state.accessToken).toBe(MOCK_ACCESS_TOKEN)
    expect(state.refreshToken).toBe(MOCK_REFRESH_TOKEN)
  })

  it('clears state on logout', () => {
    useAuthStore.getState().login(MOCK_ACCESS_TOKEN, MOCK_REFRESH_TOKEN)
    useAuthStore.getState().logout()

    const state = useAuthStore.getState()
    expect(state.isAuthenticated).toBe(false)
    expect(state.user).toBeNull()
    expect(state.isAdmin).toBe(false)
    expect(state.accessToken).toBeNull()
    expect(state.refreshToken).toBeNull()
    expect(getAccessToken()).toBeNull()
  })

  it('schedules refresh timer on login', () => {
    useAuthStore.getState().login(MOCK_ACCESS_TOKEN, MOCK_REFRESH_TOKEN)
    // Timer is scheduled (not null) since token has a far-future exp
    const state = useAuthStore.getState()
    expect(state.refreshTimer).not.toBeNull()
  })

  it('clears refresh timer on logout', () => {
    useAuthStore.getState().login(MOCK_ACCESS_TOKEN, MOCK_REFRESH_TOKEN)
    useAuthStore.getState().logout()
    const state = useAuthStore.getState()
    expect(state.refreshTimer).toBeNull()
  })

  it('sets isAdmin false for viewer role', () => {
    // Create a viewer token
    const viewerPayload = btoa(
      JSON.stringify({ user_id: 2, username: 'viewer', role: 'viewer', exp: 9999999999, iat: 0, jti: 'v', token_type: 'access' })
    ).replace(/=/g, '')
    const viewerToken = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${viewerPayload}.fake`

    useAuthStore.getState().login(viewerToken, MOCK_REFRESH_TOKEN)
    const state = useAuthStore.getState()
    expect(state.isAdmin).toBe(false)
    expect(state.isAuthenticated).toBe(true)
    expect(state.user?.role).toBe('viewer')
    expect(state.isApproved).toBe(true)
  })
})
