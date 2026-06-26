import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { renderWithProviders, loginAsAdmin, logout } from '@/test/utils'
import App from '@/App'
import { LandingPage } from '@/pages/LandingPage'

describe('LandingPage', () => {
  beforeEach(() => {
    logout()
    window.history.pushState({}, '', '/')
  })

  it('renders the public landing page at /landing without authentication', () => {
    window.history.pushState({}, '', '/landing')

    render(<App />)

    expect(screen.getByRole('heading', {
      name: /linux operations, live and accountable/i,
    })).toBeInTheDocument()
    expect(screen.getByText('ATLAS command surface')).toBeInTheDocument()
  })

  it('keeps / as the protected dashboard route', () => {
    window.history.pushState({}, '', '/')

    render(<App />)

    expect(screen.queryByText('ATLAS command surface')).not.toBeInTheDocument()
  })

  it('sends unauthenticated visitors to login from the main CTA', () => {
    renderWithProviders(<LandingPage />, { routerProps: { initialEntries: ['/landing'] } })

    expect(screen.getByRole('link', { name: /open dashboard/i })).toHaveAttribute('href', '/login')
  })

  it('sends authenticated visitors to the existing dashboard route from the main CTA', () => {
    loginAsAdmin()

    renderWithProviders(<LandingPage />, { routerProps: { initialEntries: ['/landing'] } })

    expect(screen.getByRole('link', { name: /open dashboard/i })).toHaveAttribute('href', '/')
  })
})
