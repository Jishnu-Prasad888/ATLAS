import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { renderWithProviders, logout } from '@/test/utils'
import { LoginPage } from '@/pages/LoginPage'
import { useAuthStore } from '@/store/authStore'
import { MOCK_ACCESS_TOKEN, MOCK_REFRESH_TOKEN } from '@/mocks/handlers'

// Mock wsClient connect
vi.mock('@/ws/client', () => ({
  wsClient: { connect: vi.fn(), destroy: vi.fn(), on: vi.fn(() => () => {}), updateToken: vi.fn() },
}))

// Mock useNavigate
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

describe('LoginPage', () => {
  beforeEach(() => {
    logout()
    mockNavigate.mockClear()
  })

  it('renders login form', () => {
    renderWithProviders(<LoginPage />, { routerProps: { initialEntries: ['/login'] } })

    expect(screen.getByLabelText('Username')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('shows validation errors for empty fields', async () => {
    const user = userEvent.setup()
    renderWithProviders(<LoginPage />, { routerProps: { initialEntries: ['/login'] } })

    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText('Username is required.')).toBeInTheDocument()
    expect(screen.getByText('Password is required.')).toBeInTheDocument()
  })

  it('shows validation error for empty password only', async () => {
    const user = userEvent.setup()
    renderWithProviders(<LoginPage />, { routerProps: { initialEntries: ['/login'] } })

    await user.type(screen.getByLabelText('Username'), 'admin')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText('Password is required.')).toBeInTheDocument()
    expect(screen.queryByText('Username is required.')).not.toBeInTheDocument()
  })

  it('shows API error for wrong credentials', async () => {
    const user = userEvent.setup()
    renderWithProviders(<LoginPage />, { routerProps: { initialEntries: ['/login'] } })

    await user.type(screen.getByLabelText('Username'), 'admin')
    await user.type(screen.getByLabelText('Password'), 'wrongpassword')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText(/No active account found/i)).toBeInTheDocument()
  })

  it('logs in and navigates on success', async () => {
    const user = userEvent.setup()
    renderWithProviders(<LoginPage />, { routerProps: { initialEntries: ['/login'] } })

    await user.type(screen.getByLabelText('Username'), 'admin')
    await user.type(screen.getByLabelText('Password'), 'correctpassword')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(useAuthStore.getState().isAuthenticated).toBe(true)
    })
    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true })
  })

  it('shows loading state during submission', async () => {
    // Delay the response
    server.use(
      http.post('/api/v1/auth/login/', async () => {
        await new Promise((r) => setTimeout(r, 200))
        return HttpResponse.json({ access: MOCK_ACCESS_TOKEN, refresh: MOCK_REFRESH_TOKEN })
      })
    )

    const user = userEvent.setup()
    renderWithProviders(<LoginPage />, { routerProps: { initialEntries: ['/login'] } })

    await user.type(screen.getByLabelText('Username'), 'admin')
    await user.type(screen.getByLabelText('Password'), 'correctpassword')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    // Button should be disabled while loading
    expect(screen.getByRole('button', { name: /sign in/i })).toBeDisabled()

    await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(true))
  })

  it('shows rate limit error on 429', async () => {
    server.use(
      http.post('/api/v1/auth/login/', () =>
        HttpResponse.json({ detail: 'Too many requests.' }, { status: 429 })
      )
    )

    const user = userEvent.setup()
    renderWithProviders(<LoginPage />, { routerProps: { initialEntries: ['/login'] } })

    await user.type(screen.getByLabelText('Username'), 'admin')
    await user.type(screen.getByLabelText('Password'), 'password')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText(/Too many login attempts/i)).toBeInTheDocument()
  })

  it('has link to recovery page', () => {
    renderWithProviders(<LoginPage />, { routerProps: { initialEntries: ['/login'] } })
    expect(screen.getByText(/recovery key/i)).toBeInTheDocument()
  })
})
