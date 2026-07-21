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
      accountId: null,
      isCompleted: false,
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/savings-goals$/)
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toMatchObject({
      name: 'Car',
      targetAmount: 200000,
      currentAmount: 0,
      accountId: null,
      isCompleted: false,
    })
    expect(created.id).toBe('goal-new')
  })

  it('updateSavingsGoal PATCHes only the fields provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 200))
    vi.stubGlobal('fetch', fetchMock)

    await savingsGoals.updateSavingsGoal('goal-1', { name: 'New Trip' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/savings-goals\/goal-1$/)
    expect((init as RequestInit).method).toBe('PATCH')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({ name: 'New Trip' })
  })

  it('contributeToSavingsGoal patches currentAmount', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 200))
    vi.stubGlobal('fetch', fetchMock)

    await savingsGoals.contributeToSavingsGoal('goal-1', 1000)

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toEqual({ currentAmount: 1000 })
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
})
