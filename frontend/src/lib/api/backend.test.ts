import { afterEach, describe, expect, it, vi } from 'vitest'
import { __setSupabaseForTests } from '@/lib/supabase/client'
import { authFetch, backendUrl, resolveApiBaseOverride } from './backend'

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

describe('resolveApiBaseOverride', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports no override when nothing usable is configured', () => {
    expect(resolveApiBaseOverride(undefined, true)).toBe('')
    expect(resolveApiBaseOverride('', true)).toBe('')
    expect(resolveApiBaseOverride('   ', true)).toBe('')
    expect(resolveApiBaseOverride(undefined, false)).toBe('')
    expect(resolveApiBaseOverride('  ', false)).toBe('')
  })

  it('honours a configured override, trimmed', () => {
    expect(resolveApiBaseOverride('  https://api.example.com  ', false)).toBe(
      'https://api.example.com',
    )
    expect(resolveApiBaseOverride('https://api.example.com', true)).toBe('https://api.example.com')
  })

  it('keeps a loopback override in dev, where it is the whole point', () => {
    expect(resolveApiBaseOverride('http://localhost:9000', true)).toBe('http://localhost:9000')
    expect(resolveApiBaseOverride('http://127.0.0.1:8080', true)).toBe('http://127.0.0.1:8080')
  })

  // Regression guard for 2026-08-03: a leaked frontend/.env baked
  // VITE_API_BASE_URL=http://localhost:8080 into the production bundle and every
  // /v1/* call failed with ERR_CONNECTION_REFUSED.
  it.each([
    'http://localhost:8080',
    'https://localhost',
    'http://localhost:8080/',
    'http://127.0.0.1:8080',
    'http://[::1]:8080',
    'http://0.0.0.0:8080',
    '//localhost:8080',
    'HTTP://LOCALHOST:8080',
  ])('discards the unreachable loopback override %s in a deployed build', (configured) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveApiBaseOverride(configured, false)).toBe('')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain(configured)
  })

  it('does not mistake a real host that merely contains "localhost" for loopback', () => {
    expect(resolveApiBaseOverride('https://localhost.example.com', false)).toBe(
      'https://localhost.example.com',
    )
    expect(resolveApiBaseOverride('https://api.localhost-cdn.net', false)).toBe(
      'https://api.localhost-cdn.net',
    )
  })
})

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
