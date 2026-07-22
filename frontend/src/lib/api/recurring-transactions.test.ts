import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setSupabaseForTests } from '@/lib/supabase/client'
import type { RecurringTransaction } from '@/types'
import * as recurringTransactions from './recurring-transactions'

function stubSession(token = 'jwt-abc') {
  __setSupabaseForTests({
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: token } },
        error: null,
      }),
    },
  } as never)
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const recurring: RecurringTransaction = {
  id: 'recurring-1',
  accountId: 'acct-1',
  categoryId: 'cat-1',
  description: 'Membresía',
  merchant: 'Gym',
  amount: 89900,
  frequency: 'monthly',
  startDate: '2026-07-01',
  nextDate: '2026-08-01',
  isActive: true,
}

describe('recurring transactions api client', () => {
  beforeEach(() => stubSession())

  afterEach(() => {
    __setSupabaseForTests(null)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('gets the exact recurring-transactions collection wire shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [recurring] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(recurringTransactions.getRecurringTransactions()).resolves.toEqual([recurring])

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/recurring-transactions$/)
    expect((init as RequestInit).method).toBeUndefined()
    expect(((init as RequestInit).headers as Headers).get('Authorization')).toBe('Bearer jwt-abc')
  })

  it('posts only writable recurring-transaction fields and maps its response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(recurring, 201))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      recurringTransactions.createRecurringTransaction({
        accountId: 'acct-1',
        categoryId: 'cat-1',
        description: 'Membresía',
        merchant: 'Gym',
        amount: 89900,
        frequency: 'monthly',
        startDate: '2026-07-01',
      }),
    ).resolves.toEqual(recurring)

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/recurring-transactions$/)
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      accountId: 'acct-1',
      categoryId: 'cat-1',
      description: 'Membresía',
      merchant: 'Gym',
      amount: 89900,
      frequency: 'monthly',
      startDate: '2026-07-01',
    })
  })

  it('posts process without a body and returns its created count', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ created: 3 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(recurringTransactions.processRecurringTransactions()).resolves.toEqual({
      created: 3,
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/recurring-transactions\/process$/)
    expect((init as RequestInit).method).toBe('POST')
    expect((init as RequestInit).body).toBeUndefined()
  })

  it('surfaces non-successful responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })))

    await expect(recurringTransactions.getRecurringTransactions()).rejects.toThrow(/500/)
  })
})
