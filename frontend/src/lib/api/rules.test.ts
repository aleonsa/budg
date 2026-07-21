import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setSupabaseForTests } from '@/lib/supabase/client'
import type { Rule } from '@/types'
import * as rules from './rules'

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

describe('rules api client', () => {
  beforeEach(() => {
    stubSession()
  })

  afterEach(() => {
    __setSupabaseForTests(null)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('getRules maps persisted rules and authenticates request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: 'rule-1',
            field: 'merchant',
            operator: 'contains',
            value: 'Uber',
            categoryId: 'cat-transport',
            isActive: true,
            priority: 1,
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await rules.getRules()

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/rules$/)
    expect(((init as RequestInit).headers as Headers).get('Authorization')).toBe('Bearer jwt-abc')
    expect(result).toEqual<Rule[]>([
      {
        id: 'rule-1',
        field: 'merchant',
        operator: 'contains',
        value: 'Uber',
        categoryId: 'cat-transport',
        isActive: true,
        priority: 1,
      },
    ])
  })

  it('getRules surfaces a non-2xx response as an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })))
    await expect(rules.getRules()).rejects.toThrow(/500/)
  })

  it('createRule POSTs existing frontend input and returns persisted rule', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          id: 'rule-new',
          field: 'description',
          operator: 'startsWith',
          value: 'Invoice',
          categoryId: 'cat-bills',
          isActive: true,
          priority: 1,
        },
        201,
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const created = await rules.createRule({
      field: 'description',
      operator: 'startsWith',
      value: 'Invoice',
      categoryId: 'cat-bills',
      isActive: true,
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/rules$/)
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      field: 'description',
      operator: 'startsWith',
      value: 'Invoice',
      categoryId: 'cat-bills',
      isActive: true,
    })
    expect(created.id).toBe('rule-new')
  })

  it('toggleRule POSTs its dedicated endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 200))
    vi.stubGlobal('fetch', fetchMock)

    await rules.toggleRule('rule-1')

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/rules\/rule-1\/toggle$/)
    expect((init as RequestInit).method).toBe('POST')
  })

  it('deleteRule issues DELETE and rejects non-success responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response('nope', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    await rules.deleteRule('rule-1')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/rules\/rule-1$/)
    expect((init as RequestInit).method).toBe('DELETE')
    await expect(rules.deleteRule('missing')).rejects.toThrow(/404/)
  })
})
