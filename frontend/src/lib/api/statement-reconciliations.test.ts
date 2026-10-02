import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setSupabaseForTests } from '@/lib/supabase/client'
import { reconcileStatement, StatementReconciliationError } from './statement-reconciliations'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('statement reconciliation api client', () => {
  beforeEach(() => {
    __setSupabaseForTests({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: 'jwt-statement' } },
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

  it('uploads the PDF as multipart form data', async () => {
    const payload = { statement: {}, movements: [], onlyInBudg: [], summary: {} }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(payload))
    vi.stubGlobal('fetch', fetchMock)
    const file = new File(['%PDF-1.7'], 'estado.pdf', { type: 'application/pdf' })

    await expect(reconcileStatement('credit-1', file)).resolves.toEqual(payload)

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/accounts\/credit-1\/statement-reconciliations$/)
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).get('file')).toBeInstanceOf(File)
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer jwt-statement')
    expect(new Headers(init.headers).has('Content-Type')).toBe(false)
  })

  it('maps backend error codes to readable messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: { code: 'unsupported_statement', message: 'x' } }, 422),
        ),
    )
    const file = new File(['%PDF-1.7'], 'estado.pdf', { type: 'application/pdf' })

    const error = await reconcileStatement('credit-1', file).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(StatementReconciliationError)
    expect((error as StatementReconciliationError).code).toBe('unsupported_statement')
    expect((error as Error).message).toMatch(/Banamex/)
  })

  it('falls back to a generic message for non-JSON failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })))
    const file = new File(['%PDF-1.7'], 'estado.pdf', { type: 'application/pdf' })

    await expect(reconcileStatement('credit-1', file)).rejects.toThrow(
      'No se pudo procesar el estado de cuenta.',
    )
  })
})
