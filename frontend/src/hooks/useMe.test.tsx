import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setSupabaseForTests } from '@/lib/supabase/client'
import { authFetch } from '@/lib/api/backend'
import { useMe, type MeResponse } from './useMe'

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
}

function renderHookWithClient<T>(fn: () => T) {
  const client = makeClient()
  return renderHook(fn, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
}

describe('useMe', () => {
  beforeEach(() => {
    __setSupabaseForTests({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: 'jwt-abc' } },
          error: null,
        }),
      },
    } as never)
  })

  afterEach(() => {
    __setSupabaseForTests(null)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('auto-fetches the verified identity when enabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ userId: 'u1', email: 'a@b.co', authenticated: true }), {
        status: 200,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHookWithClient(() => useMe({ enabled: true }))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({
      userId: 'u1',
      email: 'a@b.co',
      authenticated: true,
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/me$/)
    expect(((init as RequestInit).headers as Headers).get('Authorization')).toBe('Bearer jwt-abc')
  })

  it('stays idle until explicitly enabled', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHookWithClient(() => useMe())

    // Give react-query a tick to potentially fire a fetch.
    await Promise.resolve()
    expect(result.current.isPending).toBe(true)
    expect(result.current.fetchStatus).toBe('idle')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces a request failure as an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 401 })))
    const { result } = renderHookWithClient(() => useMe({ enabled: true }))

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error?.message).toMatch(/401/)
  })

  it('authFetch (used inside useMe) throws when there is no session', async () => {
    __setSupabaseForTests({
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      },
    } as never)

    await expect(authFetch('/v1/me')).rejects.toThrow(/sesión activa/i)
    const sample: MeResponse = { userId: 'x', email: 'x@y.z', authenticated: true }
    expect(sample.authenticated).toBe(true)
  })
})
