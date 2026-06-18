import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useAgents, useFleetHealth, useLatestMetrics, useLogs, useAudit, useDebounce } from '@/hooks'
import { createWrapper, loginAsAdmin } from '@/test/utils'
import { server } from '@/mocks/server'
import { http, HttpResponse } from 'msw'
import { mockAgent, mockFleetHealth } from '@/mocks/handlers'

describe('useAgents', () => {
  beforeEach(() => {
    loginAsAdmin()
  })

  it('fetches agent list', async () => {
    const { result } = renderHook(() => useAgents(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.data).toHaveLength(1)
    expect(result.current.data?.[0].hostname).toBe('prod-server-01')
    expect(result.current.error).toBeNull()
  })

  it('handles API errors', async () => {
    server.use(
      http.get('/api/v1/agents/', () =>
        HttpResponse.json({ detail: 'Server error' }, { status: 500 })
      )
    )

    const { result } = renderHook(() => useAgents(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.error).toBeTruthy()
    expect(result.current.data).toBeUndefined()
  })

  it('passes filter params', async () => {
    let capturedUrl = ''
    server.use(
      http.get('/api/v1/agents/', ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json([mockAgent])
      })
    )

    const { result } = renderHook(
      () => useAgents({ status: 'ONLINE' }),
      { wrapper: createWrapper() }
    )

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(capturedUrl).toContain('status=ONLINE')
  })
})

describe('useFleetHealth', () => {
  beforeEach(() => {
    loginAsAdmin()
  })

  it('fetches fleet health', async () => {
    const { result } = renderHook(() => useFleetHealth(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.data?.server_status).toBe('ONLINE')
    expect(result.current.data?.agents.total).toBe(2)
    expect(result.current.data?.agents.online).toBe(1)
  })

  it('returns correct agent counts', async () => {
    const { result } = renderHook(() => useFleetHealth(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.data?.agents).toEqual(mockFleetHealth.agents)
  })
})

describe('useLatestMetrics', () => {
  beforeEach(() => {
    loginAsAdmin()
  })

  it('fetches latest metrics for agent', async () => {
    const { result } = renderHook(
      () => useLatestMetrics(mockAgent.agent_id),
      { wrapper: createWrapper() }
    )

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.data?.cpu).toBeDefined()
    expect(result.current.data?.cpu?.metric_type).toBe('cpu')
  })

  it('does not fetch when agentId is null', async () => {
    let fetchCalled = false
    server.use(
      http.get('/api/v1/telemetry/latest/:agentId/', () => {
        fetchCalled = true
        return HttpResponse.json({})
      })
    )

    const { result } = renderHook(
      () => useLatestMetrics(null),
      { wrapper: createWrapper() }
    )

    // Wait a moment to ensure no fetch happens
    await new Promise((r) => setTimeout(r, 100))

    expect(fetchCalled).toBe(false)
    expect(result.current.isLoading).toBe(false)
    expect(result.current.data).toBeUndefined()
  })
})

describe('useLogs', () => {
  beforeEach(() => {
    loginAsAdmin()
  })

  it('fetches log entries', async () => {
    const { result } = renderHook(
      () => useLogs({ limit: 100 }),
      { wrapper: createWrapper() }
    )

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.data).toHaveLength(1)
    expect(result.current.data?.[0].severity).toBe('Info')
  })

  it('does not fetch when disabled', async () => {
    let fetchCalled = false
    server.use(
      http.get('/api/v1/logs/', () => {
        fetchCalled = true
        return HttpResponse.json([])
      })
    )

    renderHook(
      () => useLogs({ limit: 100 }, false),
      { wrapper: createWrapper() }
    )

    await new Promise((r) => setTimeout(r, 50))
    expect(fetchCalled).toBe(false)
  })
})

describe('useAudit', () => {
  beforeEach(() => {
    loginAsAdmin()
  })

  it('fetches audit logs', async () => {
    const { result } = renderHook(
      () => useAudit(),
      { wrapper: createWrapper() }
    )

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.data).toHaveLength(1)
    expect(result.current.data?.[0].action).toBe('LOGIN')
    expect(result.current.data?.[0].user).toBe('admin')
  })
})

describe('useDebounce', () => {
  it('returns initial value immediately', () => {
    const { result } = renderHook(() => useDebounce('initial', 500))
    expect(result.current).toBe('initial')
  })

  it('debounces value changes', async () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 100),
      { initialProps: { value: 'initial' } }
    )

    rerender({ value: 'changed' })
    expect(result.current).toBe('initial') // still debounced

    await waitFor(() => expect(result.current).toBe('changed'), { timeout: 500 })
  })

  it('uses latest value after debounce period', async () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 50),
      { initialProps: { value: 'a' } }
    )

    rerender({ value: 'b' })
    rerender({ value: 'c' })
    rerender({ value: 'final' })

    await waitFor(() => expect(result.current).toBe('final'), { timeout: 500 })
  })
})
