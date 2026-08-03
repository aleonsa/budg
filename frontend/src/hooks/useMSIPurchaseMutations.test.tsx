import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import {
  useCreateMSIPurchase,
  useDeleteMSIPurchase,
  useUpdateMSIPurchase,
} from './useMSIPurchaseMutations'

vi.mock('@/lib/api', () => ({
  api: {
    createMSIPurchase: vi.fn(),
    updateMSIPurchase: vi.fn(),
    deleteMSIPurchase: vi.fn(),
  },
}))

const input = {
  accountId: 'credit-1',
  categoryId: null,
  description: 'Laptop',
  totalAmount: 120000,
  installmentCount: 12,
  startDate: '2026-08-03',
  idempotencyKey: 'msi-attempt-1',
}

describe('MSI mutation hooks', () => {
  let client: QueryClient
  let wrapper: ({ children }: { children: ReactNode }) => ReactNode

  beforeEach(() => {
    vi.clearAllMocks()
    client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    wrapper = ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
  })

  it.each([
    ['create', useCreateMSIPurchase, (): typeof input => input, api.createMSIPurchase],
    [
      'update',
      useUpdateMSIPurchase,
      (): { id: string; input: typeof input } => ({ id: 'msi-1', input }),
      api.updateMSIPurchase,
    ],
    ['delete', useDeleteMSIPurchase, (): string => 'msi-1', api.deleteMSIPurchase],
  ] as const)('invalidates MSI-dependent data after %s', async (_name, useHook, value, apiCall) => {
    vi.mocked(apiCall).mockResolvedValue(undefined as never)
    for (const key of [
      queryKeys.msiPurchases,
      queryKeys.transactions,
      queryKeys.accounts,
      queryKeys.dashboard,
    ]) {
      client.setQueryData(key, 'cached')
    }

    const { result } = renderHook(() => useHook() as ReturnType<typeof useCreateMSIPurchase>, {
      wrapper,
    })
    await act(async () => {
      await result.current.mutateAsync(value() as never)
    })

    for (const key of [
      queryKeys.msiPurchases,
      queryKeys.transactions,
      queryKeys.accounts,
      queryKeys.dashboard,
    ]) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    }
  })
})
