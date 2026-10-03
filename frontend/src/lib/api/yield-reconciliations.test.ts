import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setSupabaseForTests } from '@/lib/supabase/client'
import {
  getYieldReconciliations,
  reconcileYield,
  undoYieldReconciliation,
  YieldReconciliationError,
} from './yield-reconciliations'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const backendAccount = {
  id: 'acc-1',
  name: 'Nu',
  type: 'debit',
  institution: 'Nu',
  last4: '0001',
  currency: 'MXN',
  balance: 101_500,
  annualYieldBps: 1200,
  yieldReconciledOn: '2026-10-02',
  isActive: true,
}

describe('yield reconciliation api client', () => {
  beforeEach(() => {
    __setSupabaseForTests({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: 'jwt-yield' } },
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

  it('posts a reconciliation with an idempotency key and maps the account', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { reconciliation: { id: 'rec-1', yield: 1_000 }, account: backendAccount },
          201,
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await reconcileYield(
      'acc-1',
      { currentBalance: 101_500, yieldAmount: 1_000, categoryId: null, date: '2026-10-02' },
      { idempotencyKey: 'key-1' },
    )

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/accounts\/acc-1\/yield-reconciliations$/)
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('key-1')
    expect(JSON.parse(init.body)).toEqual({
      currentBalance: 101_500,
      yieldAmount: 1_000,
      categoryId: null,
      date: '2026-10-02',
    })
    expect(result.account).toMatchObject({ annualYieldBps: 1200, yieldReconciledOn: '2026-10-02' })
  })

  it('lists and undoes reconciliations', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'rec-1' }] }))
      .mockResolvedValueOnce(jsonResponse(backendAccount))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getYieldReconciliations()).resolves.toEqual([{ id: 'rec-1' }])
    await expect(undoYieldReconciliation('acc-1', 'rec-1')).resolves.toMatchObject({ id: 'acc-1' })
    expect(String(fetchMock.mock.calls[1][0])).toMatch(
      /\/v1\/accounts\/acc-1\/yield-reconciliations\/rec-1$/,
    )
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE')
  })

  it('maps error codes to messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: { code: 'yield_reconciliation_not_latest' } }, 409),
        ),
    )
    const error = await undoYieldReconciliation('acc-1', 'old').catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(YieldReconciliationError)
    expect((error as Error).message).toMatch(/más reciente/)
  })
})
