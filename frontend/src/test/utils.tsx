import { type ReactNode } from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, type MemoryRouterProps } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { MOCK_ACCESS_TOKEN, MOCK_REFRESH_TOKEN } from '@/mocks/handlers'

// ─── Query client factory (fresh per test) ────────────────────────────────────

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  })
}

// ─── Wrapper factory ──────────────────────────────────────────────────────────

interface WrapperOptions {
  routerProps?: MemoryRouterProps
  queryClient?: QueryClient
}

export function createWrapper(options: WrapperOptions = {}) {
  const qc = options.queryClient ?? createTestQueryClient()

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <MemoryRouter {...options.routerProps}>
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    )
  }

  return Wrapper
}

// ─── Custom render ────────────────────────────────────────────────────────────

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  routerProps?: MemoryRouterProps
  queryClient?: QueryClient
}

export function renderWithProviders(
  ui: ReactNode,
  options: CustomRenderOptions = {},
) {
  const { routerProps, queryClient, ...renderOptions } = options
  const qc = queryClient ?? createTestQueryClient()

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <MemoryRouter {...routerProps}>
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    )
  }

  return { ...render(ui, { wrapper: Wrapper, ...renderOptions }), queryClient: qc }
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

/**
 * Populates auth store with an admin user.
 * Call before rendering components that require authentication.
 */
export function loginAsAdmin() {
  useAuthStore.getState().login(MOCK_ACCESS_TOKEN, MOCK_REFRESH_TOKEN)
}

/**
 * Clears auth state.
 */
export function logout() {
  useAuthStore.getState().logout()
}

// ─── Wait helpers ─────────────────────────────────────────────────────────────

export function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Re-export commonly used testing utilities
export { screen, fireEvent, waitFor as rtlWaitFor, within, act } from '@testing-library/react'
export { userEvent } from '@testing-library/user-event'
export { vi, expect, describe, it, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
