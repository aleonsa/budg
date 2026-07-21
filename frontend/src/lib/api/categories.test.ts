import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setSupabaseForTests } from '@/lib/supabase/client'
import type { Category } from '@/types'
import * as categories from './categories'

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

describe('categories api client', () => {
  beforeEach(() => {
    stubSession()
  })

  afterEach(() => {
    __setSupabaseForTests(null)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('getCategories maps the backend payload into the frontend Category shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: 'cat-1',
            name: 'Food',
            kind: 'expense',
            color: 'blue',
            icon: 'Utensils',
            parentId: null,
            isSystem: false,
            order: 0,
          },
          {
            id: 'cat-2',
            name: 'Salary',
            kind: 'income',
            color: 'green',
            icon: 'Wallet',
            parentId: null,
            isSystem: true,
            order: 1,
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await categories.getCategories()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/categories$/)
    expect(((init as RequestInit).headers as Headers).get('Authorization')).toBe('Bearer jwt-abc')
    expect(result).toEqual<Category[]>([
      {
        id: 'cat-1',
        name: 'Food',
        kind: 'expense',
        color: 'blue',
        icon: 'Utensils',
        parentId: null,
        isSystem: false,
        order: 0,
      },
      {
        id: 'cat-2',
        name: 'Salary',
        kind: 'income',
        color: 'green',
        icon: 'Wallet',
        parentId: null,
        isSystem: true,
        order: 1,
      },
    ])
  })

  it('getCategories surfaces a non-2xx response as an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })))
    await expect(categories.getCategories()).rejects.toThrow(/500/)
  })

  it('createCategory POSTs the wire payload and returns the created row', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          id: 'cat-new',
          name: 'Pets',
          kind: 'expense',
          color: 'orange',
          icon: 'PawPrint',
          parentId: null,
          isSystem: false,
          order: 0,
        },
        201,
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const created = await categories.createCategory({
      name: 'Pets',
      kind: 'expense',
      color: 'orange',
      icon: 'PawPrint',
      parentId: null,
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/categories$/)
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toMatchObject({
      name: 'Pets',
      kind: 'expense',
      color: 'orange',
      icon: 'PawPrint',
      parentId: null,
      order: 0,
    })
    expect(created.id).toBe('cat-new')
  })

  it('updateCategory PATCHes only the fields provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 200))
    vi.stubGlobal('fetch', fetchMock)

    await categories.updateCategory('cat-1', { name: 'Renamed' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/categories\/cat-1$/)
    expect((init as RequestInit).method).toBe('PATCH')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({ name: 'Renamed' })
  })

  it('updateCategory can clear parentId by sending null', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 200))
    vi.stubGlobal('fetch', fetchMock)

    await categories.updateCategory('cat-1', { parentId: null })

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toEqual({ parentId: null })
  })

  it('deleteCategory issues DELETE and resolves on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await categories.deleteCategory('cat-1')

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/categories\/cat-1$/)
    expect((init as RequestInit).method).toBe('DELETE')
  })

  it('deleteCategory rejects on 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404 })))
    await expect(categories.deleteCategory('cat-missing')).rejects.toThrow(/404/)
  })
})
