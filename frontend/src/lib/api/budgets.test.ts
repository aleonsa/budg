import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setSupabaseForTests } from '@/lib/supabase/client'
import type { Budget } from '@/types'
import * as budgets from './budgets'

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

describe('budgets api client', () => {
  beforeEach(() => {
    stubSession()
  })

  afterEach(() => {
    __setSupabaseForTests(null)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('getBudgets maps the backend payload into the frontend Budget shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: 'bud-1',
            categoryId: 'cat-1',
            amount: 5000,
            period: 'monthly',
            startDate: '2026-01-01',
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await budgets.getBudgets()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/budgets$/)
    expect(((init as RequestInit).headers as Headers).get('Authorization')).toBe('Bearer jwt-abc')
    expect(result).toEqual<Budget[]>([
      {
        id: 'bud-1',
        categoryId: 'cat-1',
        amount: 5000,
        period: 'monthly',
        startDate: '2026-01-01',
      },
    ])
  })

  it('getBudgets surfaces a non-2xx response as an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })))
    await expect(budgets.getBudgets()).rejects.toThrow(/500/)
  })

  it('createBudget POSTs the wire payload and returns the created row', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          id: 'bud-new',
          categoryId: null,
          amount: 10000,
          period: 'monthly',
          startDate: '2026-07-01',
        },
        201,
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const created = await budgets.createBudget({
      categoryId: null,
      amount: 10000,
      period: 'monthly',
      startDate: '2026-07-01',
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/budgets$/)
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toMatchObject({
      categoryId: null,
      amount: 10000,
      period: 'monthly',
      startDate: '2026-07-01',
    })
    expect(created.id).toBe('bud-new')
  })

  it('updateBudget PATCHes only the fields provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 200))
    vi.stubGlobal('fetch', fetchMock)

    await budgets.updateBudget('bud-1', { amount: 12000 })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/budgets\/bud-1$/)
    expect((init as RequestInit).method).toBe('PATCH')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({ amount: 12000 })
  })

  it('deleteBudget issues DELETE and resolves on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await budgets.deleteBudget('bud-1')

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/budgets\/bud-1$/)
    expect((init as RequestInit).method).toBe('DELETE')
  })

  it('deleteBudget rejects on 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404 })))
    await expect(budgets.deleteBudget('bud-missing')).rejects.toThrow(/404/)
  })
})
