import { describe, it, expect, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders, loginAsAdmin, logout } from '@/test/utils'
import { RequireAuth, RequireAdmin, RedirectIfAuthenticated } from '@/components/auth/RouteGuards'
import { useAuthStore } from '@/store/authStore'
import { MOCK_REFRESH_TOKEN } from '@/mocks/handlers'

function ProtectedContent() {
  return <div>Protected Content</div>
}

function PublicContent() {
  return <div>Public Content</div>
}

describe('RequireAuth', () => {
  beforeEach(() => {
    logout()
  })

  it('renders children when authenticated', () => {
    loginAsAdmin()
    renderWithProviders(
      <RequireAuth>
        <ProtectedContent />
      </RequireAuth>,
      { routerProps: { initialEntries: ['/'] } }
    )
    expect(screen.getByText('Protected Content')).toBeInTheDocument()
  })

  it('redirects to /login when not authenticated', () => {
    renderWithProviders(
      <RequireAuth>
        <ProtectedContent />
      </RequireAuth>,
      { routerProps: { initialEntries: ['/dashboard'] } }
    )
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument()
  })
})

describe('RequireAdmin', () => {
  beforeEach(() => {
    logout()
  })

  it('renders children for admin users', () => {
    loginAsAdmin()
    renderWithProviders(
      <RequireAdmin>
        <ProtectedContent />
      </RequireAdmin>,
      { routerProps: { initialEntries: ['/admin'] } }
    )
    expect(screen.getByText('Protected Content')).toBeInTheDocument()
  })

  it('redirects viewers away from admin routes', () => {
    // Login as viewer
    const viewerPayload = btoa(
      JSON.stringify({ user_id: 2, username: 'viewer', role: 'viewer', exp: 9999999999, iat: 0, jti: 'v', token_type: 'access' })
    ).replace(/=/g, '')
    const viewerToken = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${viewerPayload}.fake`
    useAuthStore.getState().login(viewerToken, MOCK_REFRESH_TOKEN)

    renderWithProviders(
      <RequireAdmin>
        <ProtectedContent />
      </RequireAdmin>,
      { routerProps: { initialEntries: ['/admin'] } }
    )
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument()
  })

  it('redirects unauthenticated users to login', () => {
    renderWithProviders(
      <RequireAdmin>
        <ProtectedContent />
      </RequireAdmin>,
      { routerProps: { initialEntries: ['/admin'] } }
    )
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument()
  })
})

describe('RedirectIfAuthenticated', () => {
  beforeEach(() => {
    logout()
  })

  it('renders children when not authenticated', () => {
    renderWithProviders(
      <RedirectIfAuthenticated>
        <PublicContent />
      </RedirectIfAuthenticated>,
      { routerProps: { initialEntries: ['/login'] } }
    )
    expect(screen.getByText('Public Content')).toBeInTheDocument()
  })

  it('redirects authenticated users away from login', () => {
    loginAsAdmin()
    renderWithProviders(
      <RedirectIfAuthenticated>
        <PublicContent />
      </RedirectIfAuthenticated>,
      { routerProps: { initialEntries: ['/login'] } }
    )
    expect(screen.queryByText('Public Content')).not.toBeInTheDocument()
  })
})
