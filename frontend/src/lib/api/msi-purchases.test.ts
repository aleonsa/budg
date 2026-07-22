import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setSupabaseForTests } from '@/lib/supabase/client'
import type { MSIPurchase } from '@/types'
import * as msiPurchases from './msi-purchases'

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

describe('msi purchases api client', () => {
  beforeEach(() => {
    stubSession()
  })

  afterEach(() => {
    __setSupabaseForTests(null)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('getMSIPurchases maps the backend payload into the frontend MSIPurchase shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: 'msi-1',
            accountId: 'acct-1',
            categoryId: 'cat-1',
            description: 'Laptop',
            merchant: 'Apple Store',
            totalAmount: 120000,
            installmentAmount: 10000,
            installmentCount: 12,
            installmentsPaid: 3,
            startDate: '2026-01-01',
            nextInstallmentDate: '2026-04-01',
            status: 'active',
          },
          {
            id: 'msi-2',
            accountId: 'acct-1',
            categoryId: null,
            description: 'TV',
            totalAmount: 60000,
            installmentAmount: 10000,
            installmentCount: 6,
            installmentsPaid: 6,
            startDate: '2025-06-01',
            status: 'completed',
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await msiPurchases.getMSIPurchases()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/msi-purchases$/)
    expect(((init as RequestInit).headers as Headers).get('Authorization')).toBe('Bearer jwt-abc')
    expect(result).toEqual<MSIPurchase[]>([
      {
        id: 'msi-1',
        accountId: 'acct-1',
        categoryId: 'cat-1',
        description: 'Laptop',
        merchant: 'Apple Store',
        totalAmount: 120000,
        installmentAmount: 10000,
        installmentCount: 12,
        installmentsPaid: 3,
        startDate: '2026-01-01',
        nextInstallmentDate: '2026-04-01',
        status: 'active',
      },
      {
        id: 'msi-2',
        accountId: 'acct-1',
        categoryId: null,
        description: 'TV',
        merchant: undefined,
        totalAmount: 60000,
        installmentAmount: 10000,
        installmentCount: 6,
        installmentsPaid: 6,
        startDate: '2025-06-01',
        nextInstallmentDate: undefined,
        status: 'completed',
      },
    ])
  })

  it('getMSIPurchases surfaces a non-2xx response as an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })))
    await expect(msiPurchases.getMSIPurchases()).rejects.toThrow(/500/)
  })

  it('createMSIPurchase posts only the writable request fields and maps the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          id: 'msi-new',
          accountId: 'acct-1',
          categoryId: 'cat-1',
          description: 'Laptop',
          merchant: 'Apple Store',
          totalAmount: 120000,
          installmentAmount: 10000,
          installmentCount: 12,
          installmentsPaid: 0,
          startDate: '2026-08-15',
          nextInstallmentDate: '2026-08-15',
          status: 'active',
        },
        201,
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await msiPurchases.createMSIPurchase({
      accountId: 'acct-1',
      categoryId: 'cat-1',
      description: 'Laptop',
      merchant: 'Apple Store',
      totalAmount: 120000,
      installmentCount: 12,
      startDate: '2026-08-15',
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/msi-purchases$/)
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      accountId: 'acct-1',
      categoryId: 'cat-1',
      description: 'Laptop',
      merchant: 'Apple Store',
      totalAmount: 120000,
      installmentCount: 12,
      startDate: '2026-08-15',
    })
    expect(result.id).toBe('msi-new')
    expect(result.installmentAmount).toBe(10000)
  })
})
