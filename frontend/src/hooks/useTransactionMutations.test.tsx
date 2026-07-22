import { type PropsWithChildren, createElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Transaction } from '@/types'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import {
  useCreateTransaction,
  useDeleteTransaction,
  useUpdateTransaction,
} from './useTransactionMutations'

vi.mock('@/lib/api', () => ({
  api: {
    createTransaction: vi.fn(),
    updateTransaction: vi.fn(),
    deleteTransaction: vi.fn(),
  },
}))

const input: Omit<Transaction, 'id' | 'createdAt' | 'isReconciled'> = {
  accountId: 'acc-checking',
  type: 'expense',
  amount: 2_500,
  categoryId: 'cat-food',
  date: '2026-07-20',
  description: 'Lunch',
}

function setupQueryClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  })
  client.setQueryData(queryKeys.transactions, ['cached transaction'])
  client.setQueryData(queryKeys.dashboard, { spending: 2_500 })
  client.setQueryData(queryKeys.accounts, ['unrelated account'])

  function QueryWrapper({ children }: PropsWithChildren) {
    return createElement(QueryClientProvider, { client }, children)
  }

  return { client, wrapper: QueryWrapper }
}

function expectTransactionCachesInvalidated(client: QueryClient) {
  expect(client.getQueryState(queryKeys.transactions)?.isInvalidated).toBe(true)
  expect(client.getQueryState(queryKeys.dashboard)?.isInvalidated).toBe(true)
  expect(client.getQueryState(queryKeys.accounts)?.isInvalidated).toBe(true)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.createTransaction).mockResolvedValue({
    ...input,
    id: 'tx-new',
    createdAt: '2026-07-20',
    isReconciled: false,
  })
  vi.mocked(api.updateTransaction).mockResolvedValue(undefined)
  vi.mocked(api.deleteTransaction).mockResolvedValue(undefined)
})

describe('transaction mutation hooks', () => {
  it('creates a transaction and invalidates transaction-dependent caches on success', async () => {
    const { client, wrapper } = setupQueryClient()
    const { result } = renderHook(useCreateTransaction, { wrapper })

    let created: Transaction | undefined
    await act(async () => {
      created = await result.current.mutateAsync(input)
    })

    expect(api.createTransaction).toHaveBeenCalledWith(input)
    expect(created?.id).toBe('tx-new')
    expectTransactionCachesInvalidated(client)
    client.clear()
  })

  it('passes an update patch and invalidates transaction-dependent caches on success', async () => {
    const { client, wrapper } = setupQueryClient()
    const { result } = renderHook(useUpdateTransaction, { wrapper })
    const variables = { id: 'tx-existing', patch: { amount: 7_500, description: 'Dinner' } }

    await act(async () => {
      await result.current.mutateAsync(variables)
    })

    expect(api.updateTransaction).toHaveBeenCalledWith('tx-existing', variables.patch)
    expectTransactionCachesInvalidated(client)
    client.clear()
  })

  it('passes the deleted id and invalidates transaction-dependent caches on success', async () => {
    const { client, wrapper } = setupQueryClient()
    const { result } = renderHook(useDeleteTransaction, { wrapper })

    await act(async () => {
      await result.current.mutateAsync('tx-existing')
    })

    expect(api.deleteTransaction).toHaveBeenCalledWith('tx-existing')
    expectTransactionCachesInvalidated(client)
    client.clear()
  })

  it('preserves valid caches when the mutation fails', async () => {
    const { client, wrapper } = setupQueryClient()
    const failure = new Error('write rejected')
    vi.mocked(api.createTransaction).mockRejectedValue(failure)
    const { result } = renderHook(useCreateTransaction, { wrapper })

    await expect(
      act(async () => {
        await result.current.mutateAsync(input)
      }),
    ).rejects.toBe(failure)

    expect(client.getQueryState(queryKeys.transactions)?.isInvalidated).toBe(false)
    expect(client.getQueryState(queryKeys.dashboard)?.isInvalidated).toBe(false)
    client.clear()
  })
})
