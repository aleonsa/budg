import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setSupabaseForTests } from '@/lib/supabase/client'
import type { SavingsGoal } from '@/types'
import * as savingsGoals from './savings-goals'

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

describe('savings goals api client', () => {
  beforeEach(() => {
    stubSession()
  })

  afterEach(() => {
    __setSupabaseForTests(null)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('getSavingsGoals maps the backend payload into the frontend SavingsGoal shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: 'goal-1',
            name: 'Trip',
            targetAmount: 50000,
            currentAmount: 5000,
            targetDate: '2026-12-31',
            accountId: null,
            isCompleted: false,
            order: 0,
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await savingsGoals.getSavingsGoals()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/savings-goals$/)
    expect(((init as RequestInit).headers as Headers).get('Authorization')).toBe('Bearer jwt-abc')
    expect(result).toEqual<SavingsGoal[]>([
      {
        id: 'goal-1',
        name: 'Trip',
        targetAmount: 50000,
        currentAmount: 5000,
        targetDate: '2026-12-31',
        accountId: null,
        isCompleted: false,
        order: 0,
      },
    ])
  })

  it('getSavingsGoals surfaces a non-2xx response as an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })))
    await expect(savingsGoals.getSavingsGoals()).rejects.toThrow(/500/)
  })

  it('createSavingsGoal POSTs the wire payload and returns the created row', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          id: 'goal-new',
          name: 'Car',
          targetAmount: 200000,
          currentAmount: 0,
          targetDate: '2027-01-15',
          accountId: null,
          isCompleted: false,
          order: 0,
        },
        201,
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const created = await savingsGoals.createSavingsGoal({
      name: 'Car',
      targetAmount: 200000,
      currentAmount: 0,
      targetDate: '2027-01-15',
      accountId: null,
      isCompleted: false,
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/savings-goals$/)
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({
      name: 'Car',
      targetAmount: 200000,
      currentAmount: 0,
      targetDate: '2027-01-15',
      accountId: null,
      order: 0,
    })
    expect(created.id).toBe('goal-new')
    expect(created.targetDate).toBe('2027-01-15')
  })

  it('updateSavingsGoal PATCHes only the fields provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 200))
    vi.stubGlobal('fetch', fetchMock)

    await savingsGoals.updateSavingsGoal('goal-1', {
      name: 'New Trip',
      accountId: 'account-2',
      targetDate: null,
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/savings-goals\/goal-1$/)
    expect((init as RequestInit).method).toBe('PATCH')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({ name: 'New Trip', accountId: 'account-2', targetDate: null })
  })

  it('deleteSavingsGoal issues DELETE and resolves on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await savingsGoals.deleteSavingsGoal('goal-1')

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/savings-goals\/goal-1$/)
    expect((init as RequestInit).method).toBe('DELETE')
  })

  it('deleteSavingsGoal rejects on 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404 })))
    await expect(savingsGoals.deleteSavingsGoal('goal-missing')).rejects.toThrow(/404/)
  })

  it('getSavingsOverview returns account allocation totals and activity', async () => {
    const overview = {
      totalAllocated: 12000,
      totalAccountBalance: 20000,
      totalUnallocated: 8000,
      accounts: [
        {
          accountId: 'account-2',
          accountName: 'Ahorro',
          balance: 20000,
          allocatedAmount: 12000,
          unallocatedAmount: 8000,
        },
      ],
      recentActivity: [],
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(overview))
    vi.stubGlobal('fetch', fetchMock)

    await expect(savingsGoals.getSavingsOverview()).resolves.toEqual(overview)
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/v1\/savings-goals\/overview$/)
  })

  it('saveToGoal atomically posts transfer data with idempotency', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ goal: {}, transaction: {} }, 201))
    vi.stubGlobal('fetch', fetchMock)

    await savingsGoals.saveToGoal(
      'goal-1',
      {
        sourceAccountId: 'account-1',
        destinationAccountId: 'account-2',
        amount: 5000,
        date: '2026-08-16',
        description: 'Ahorro para viaje',
      },
      { idempotencyKey: 'save-key-1' },
    )

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/savings-goals\/goal-1\/savings$/)
    expect((init as RequestInit).method).toBe('POST')
    expect(((init as RequestInit).headers as Headers).get('Idempotency-Key')).toBe('save-key-1')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      sourceAccountId: 'account-1',
      destinationAccountId: 'account-2',
      amount: 5000,
      date: '2026-08-16',
      description: 'Ahorro para viaje',
    })
  })

  it('allocateSavings and reallocateSavings send idempotent ledger operations', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)

    await savingsGoals.allocateSavings(
      'goal-1',
      { accountId: 'account-2', amount: 1000, date: '2026-08-16' },
      { idempotencyKey: 'allocation-key-1' },
    )
    await savingsGoals.reallocateSavings(
      'goal-1',
      { toGoalId: 'goal-2', accountId: 'account-2', amount: 500, date: '2026-08-16' },
      { idempotencyKey: 'reallocation-key-1' },
    )

    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/goal-1\/allocations$/)
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST')
    expect(
      ((fetchMock.mock.calls[0][1] as RequestInit).headers as Headers).get('Idempotency-Key'),
    ).toBe('allocation-key-1')
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/\/goal-1\/reallocations$/)
    expect(
      ((fetchMock.mock.calls[1][1] as RequestInit).headers as Headers).get('Idempotency-Key'),
    ).toBe('reallocation-key-1')
  })
})
