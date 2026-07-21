import { afterEach, describe, expect, it, vi } from 'vitest'
import { __setSupabaseForTests } from '@/lib/supabase/client'
import { authFetch, backendUrl } from './backend'

function buildSupabaseStub(opts: { session?: { access_token?: string } | null; error?: unknown }) {
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: opts.session ?? null },
        error: opts.error ?? null,
      }),
    },
  }
}

describe('backend api adapter', () => {
  afterEach(() => {
    __setSupabaseForTests(null)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('backendUrl concatenates base and path, trimming trailing slash', () => {
    expect(backendUrl('/v1/me')).toMatch(/\/v1\/me$/)
  })

  it('throws when Supabase is not configured', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    __setSupabaseForTests(null)
    await expect(authFetch('/v1/me')).rejects.toThrow(/no está configurado/i)
  })

  it('throws when there is no active session', async () => {
    __setSupabaseForTests(buildSupabaseStub({ session: null }) as never)
    await expect(authFetch('/v1/me')).rejects.toThrow(/sesión activa/i)
  })

  it('sends the access token as a Bearer header', async () => {
    __setSupabaseForTests(buildSupabaseStub({ session: { access_token: 'jwt-123' } }) as never)
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await authFetch('/v1/me', { method: 'GET' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/me$/)
    expect((init as RequestInit).headers).toBeInstanceOf(Headers)
    expect((init as RequestInit).method).toBe('GET')
    const headers = (init as RequestInit).headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer jwt-123')
  })
})
