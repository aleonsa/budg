import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setSupabaseForTests } from '@/lib/supabase/client'
import type { Transaction } from '@/types'
import * as transactions from './transactions'

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

describe('transactions api client', () => {
  beforeEach(() => {
    stubSession()
  })

  afterEach(() => {
    __setSupabaseForTests(null)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('getTransactions maps the backend payload into the frontend Transaction shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: 'tx-1',
            accountId: 'acc-1',
            type: 'expense',
            amount: 1500,
            categoryId: 'cat-1',
            date: '2026-07-20',
            description: 'Coffee',
            merchant: 'Starbucks',
            isReconciled: true,
            createdAt: '2026-07-20',
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await transactions.getTransactions()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/transactions$/)
    expect(((init as RequestInit).headers as Headers).get('Authorization')).toBe('Bearer jwt-abc')
    expect(result).toEqual<Transaction[]>([
      {
        id: 'tx-1',
        accountId: 'acc-1',
        type: 'expense',
        amount: 1500,
        categoryId: 'cat-1',
        date: '2026-07-20',
        description: 'Coffee',
        merchant: 'Starbucks',
        msiPurchaseId: undefined,
        transferToAccountId: undefined,
        isReconciled: true,
        createdAt: '2026-07-20',
      },
    ])
  })

  it('getTransactions surfaces a non-2xx response as an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })))
    await expect(transactions.getTransactions()).rejects.toThrow(/500/)
  })

  it('createTransaction POSTs the wire payload and returns the created row', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          id: 'tx-new',
          accountId: 'acc-1',
          type: 'expense',
          amount: 1500,
          categoryId: 'cat-1',
          date: '2026-07-20',
          description: 'Coffee',
          isReconciled: false,
          createdAt: '2026-07-20',
        },
        201,
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const created = await transactions.createTransaction({
      accountId: 'acc-1',
      type: 'expense',
      amount: 1500,
      categoryId: 'cat-1',
      date: '2026-07-20',
      description: 'Coffee',
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/transactions$/)
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toMatchObject({
      accountId: 'acc-1',
      type: 'expense',
      amount: 1500,
      categoryId: 'cat-1',
      date: '2026-07-20',
      description: 'Coffee',
    })
    expect(created.id).toBe('tx-new')
  })

  it('sends an idempotency key for retry-safe payments', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          id: 'payment-1',
          accountId: 'debit-1',
          transferToAccountId: 'credit-1',
          type: 'transfer',
          amount: 30_000,
          categoryId: null,
          date: '2026-07-22',
          description: 'Pago Tarjeta Oro',
          affectsBalance: true,
          isReconciled: false,
          createdAt: '2026-07-22',
        },
        201,
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await transactions.createTransaction(
      {
        accountId: 'debit-1',
        transferToAccountId: 'credit-1',
        type: 'transfer',
        amount: 30_000,
        categoryId: null,
        date: '2026-07-22',
        description: 'Pago Tarjeta Oro',
        affectsBalance: true,
      },
      { idempotencyKey: 'payment-attempt-1' },
    )

    const [, init] = fetchMock.mock.calls[0]
    expect(((init as RequestInit).headers as Headers).get('Idempotency-Key')).toBe(
      'payment-attempt-1',
    )
  })

  it('updateTransaction PATCHes only the fields provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 200))
    vi.stubGlobal('fetch', fetchMock)

    await transactions.updateTransaction('tx-1', { description: 'Updated' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/transactions\/tx-1$/)
    expect((init as RequestInit).method).toBe('PATCH')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({ description: 'Updated' })
  })

  it('deleteTransaction issues DELETE and resolves on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await transactions.deleteTransaction('tx-1')

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/transactions\/tx-1$/)
    expect((init as RequestInit).method).toBe('DELETE')
  })

  it('deleteTransaction rejects on 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404 })))
    await expect(transactions.deleteTransaction('tx-missing')).rejects.toThrow(/404/)
  })
})
