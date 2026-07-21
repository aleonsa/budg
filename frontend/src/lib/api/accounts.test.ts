import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setSupabaseForTests } from '@/lib/supabase/client'
import type { Account } from '@/types'
import * as accounts from './accounts'

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

describe('accounts api client', () => {
  beforeEach(() => {
    stubSession()
  })

  afterEach(() => {
    __setSupabaseForTests(null)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('getAccounts maps the backend payload into the frontend Account shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: 'acc-1',
            name: 'Nómina',
            type: 'debit',
            institution: 'BBVA',
            last4: '4521',
            currency: 'MXN',
            balance: 1845000,
            isActive: true,
          },
          {
            id: 'acc-2',
            name: 'Cred Platino',
            type: 'credit',
            institution: 'Santander',
            last4: '1093',
            currency: 'MXN',
            creditLimit: 8000000,
            availableCredit: 5340000,
            statementCutDay: 15,
            paymentDueDay: 5,
            isActive: true,
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await accounts.getAccounts()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/accounts$/)
    expect(((init as RequestInit).headers as Headers).get('Authorization')).toBe('Bearer jwt-abc')
    expect(result).toEqual<Account[]>([
      {
        id: 'acc-1',
        name: 'Nómina',
        type: 'debit',
        institution: 'BBVA',
        last4: '4521',
        currency: 'MXN',
        balance: 1845000,
        creditLimit: undefined,
        availableCredit: undefined,
        statementCutDay: undefined,
        paymentDueDay: undefined,
        isActive: true,
      },
      {
        id: 'acc-2',
        name: 'Cred Platino',
        type: 'credit',
        institution: 'Santander',
        last4: '1093',
        currency: 'MXN',
        balance: undefined,
        creditLimit: 8000000,
        availableCredit: 5340000,
        statementCutDay: 15,
        paymentDueDay: 5,
        isActive: true,
      },
    ])
  })

  it('getAccounts surfaces a non-2xx response as an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })))
    await expect(accounts.getAccounts()).rejects.toThrow(/500/)
  })

  it('createAccount POSTs the wire payload and returns the created row', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          id: 'acc-new',
          name: 'Ahorro',
          type: 'debit',
          institution: 'Nu',
          last4: '8830',
          currency: 'MXN',
          balance: 0,
          isActive: true,
        },
        201,
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const created = await accounts.createAccount({
      name: 'Ahorro',
      type: 'debit',
      institution: 'Nu',
      last4: '8830',
      currency: 'MXN',
      balance: 0,
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/accounts$/)
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toMatchObject({
      name: 'Ahorro',
      type: 'debit',
      institution: 'Nu',
      last4: '8830',
      currency: 'MXN',
      balance: 0,
    })
    expect(created.id).toBe('acc-new')
  })

  it('updateAccount PATCHes only the fields provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 200))
    vi.stubGlobal('fetch', fetchMock)

    await accounts.updateAccount('acc-1', { name: 'Renamed' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/accounts\/acc-1$/)
    expect((init as RequestInit).method).toBe('PATCH')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({ name: 'Renamed' })
  })

  it('deleteAccount issues DELETE and resolves on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await accounts.deleteAccount('acc-1')

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/accounts\/acc-1$/)
    expect((init as RequestInit).method).toBe('DELETE')
  })

  it('deleteAccount rejects on 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404 })))
    await expect(accounts.deleteAccount('acc-missing')).rejects.toThrow(/404/)
  })
})
