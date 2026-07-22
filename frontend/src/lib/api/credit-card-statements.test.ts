import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setSupabaseForTests } from '@/lib/supabase/client'
import * as statements from './credit-card-statements'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('credit card statements api client', () => {
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

  it('lists statements for one account', async () => {
    const payload = {
      id: 'statement-1',
      accountId: 'credit-1',
      cycleStartDate: '2026-06-13',
      cycleEndDate: '2026-07-12',
      paymentDueDate: '2026-07-28',
      statementBalance: 40_000,
      paidAmount: 0,
      status: 'pending' as const,
      confirmedAt: '2026-07-13T00:00:00Z',
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [payload] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(statements.getCreditCardStatements('credit-1')).resolves.toEqual([payload])
    expect(String(fetchMock.mock.calls[0][0])).toMatch(
      /\/v1\/accounts\/credit-1\/credit-card-statements$/,
    )
  })

  it('confirms bank statement amounts in cents', async () => {
    const input = {
      cycleStartDate: '2026-06-13',
      cycleEndDate: '2026-07-12',
      paymentDueDate: '2026-07-28',
      statementBalance: 42_550,
      minimumPayment: 4_000,
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'statement-1', ...input }))
    vi.stubGlobal('fetch', fetchMock)

    await statements.confirmCreditCardStatement('credit-1', input)

    const [, init] = fetchMock.mock.calls[0]
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(input)
  })
})
