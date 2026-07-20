import { type PropsWithChildren, createElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account, Category, MSIPurchase, SavingsGoal, Transaction } from '@/types'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import {
  deriveAccountSummary,
  deriveBudgetProgress,
  deriveGoalProgress,
  deriveMonthSpending,
  deriveTotalBalance,
  deriveTotalDebt,
  useAccounts,
  useBudgets,
  useCategories,
  useCategoryMap,
  useMSIPurchases,
  useRules,
  useSavingsGoals,
  useTransactions,
} from './useQueries'

vi.mock('@/lib/api', () => ({
  api: {
    getCategories: vi.fn(),
    getAccounts: vi.fn(),
    getTransactions: vi.fn(),
    getMSIPurchases: vi.fn(),
    getSavingsGoals: vi.fn(),
    getBudgets: vi.fn(),
    getRules: vi.fn(),
  },
}))

const category: Category = {
  id: 'cat-food',
  name: 'Food',
  kind: 'expense',
  color: 'orange',
  icon: 'Utensils',
  parentId: null,
  isSystem: true,
  order: 0,
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
}

function wrapperFor(client: QueryClient) {
  return function QueryWrapper({ children }: PropsWithChildren) {
    return createElement(QueryClientProvider, { client }, children)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.getCategories).mockResolvedValue([category])
  vi.mocked(api.getAccounts).mockResolvedValue([])
  vi.mocked(api.getTransactions).mockResolvedValue([])
  vi.mocked(api.getMSIPurchases).mockResolvedValue([])
  vi.mocked(api.getSavingsGoals).mockResolvedValue([])
  vi.mocked(api.getBudgets).mockResolvedValue([])
  vi.mocked(api.getRules).mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('raw query hooks', () => {
  it('loads each resource into its canonical QueryClient cache entry', async () => {
    const client = createQueryClient()
    const { result } = renderHook(
      () => ({
        categories: useCategories(),
        duplicateCategories: useCategories(),
        accounts: useAccounts(),
        transactions: useTransactions(),
        msi: useMSIPurchases(),
        goals: useSavingsGoals(),
        budgets: useBudgets(),
        rules: useRules(),
      }),
      { wrapper: wrapperFor(client) },
    )

    await waitFor(() => {
      expect(Object.values(result.current).every((query) => query.isSuccess)).toBe(true)
    })

    expect(api.getCategories).toHaveBeenCalledOnce()
    expect(api.getAccounts).toHaveBeenCalledOnce()
    expect(api.getTransactions).toHaveBeenCalledOnce()
    expect(api.getMSIPurchases).toHaveBeenCalledOnce()
    expect(api.getSavingsGoals).toHaveBeenCalledOnce()
    expect(api.getBudgets).toHaveBeenCalledOnce()
    expect(api.getRules).toHaveBeenCalledOnce()
    expect(client.getQueryData(queryKeys.categories)).toEqual([category])
    expect(client.getQueryData(queryKeys.accounts)).toEqual([])
    expect(client.getQueryData(queryKeys.transactions)).toEqual([])
    expect(client.getQueryData(queryKeys.msiPurchases)).toEqual([])
    expect(client.getQueryData(queryKeys.savingsGoals)).toEqual([])
    expect(client.getQueryData(queryKeys.budgets)).toEqual([])
    expect(client.getQueryData(queryKeys.rules)).toEqual([])
    client.clear()
  })

  it('surfaces API failures without caching successful transaction data', async () => {
    const client = createQueryClient()
    const failure = new Error('transactions unavailable')
    vi.mocked(api.getTransactions).mockRejectedValue(failure)

    const { result } = renderHook(useTransactions, { wrapper: wrapperFor(client) })
    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(result.current.error).toBe(failure)
    expect(client.getQueryData(queryKeys.transactions)).toBeUndefined()
    client.clear()
  })

  it('returns no category lookup while loading, then indexes fetched categories by id', async () => {
    const client = createQueryClient()
    let resolveCategories!: (categories: Category[]) => void
    vi.mocked(api.getCategories).mockImplementation(
      () => new Promise((resolve) => (resolveCategories = resolve)),
    )

    const { result } = renderHook(useCategoryMap, { wrapper: wrapperFor(client) })
    expect(result.current).toBeUndefined()

    resolveCategories([category, { ...category, id: 'cat-travel', name: 'Travel' }])
    await waitFor(() => expect(result.current?.size).toBe(2))

    expect(result.current?.get('cat-food')?.name).toBe('Food')
    expect(result.current?.get('cat-travel')?.name).toBe('Travel')
    client.clear()
  })
})

describe('query derivations', () => {
  const debit: Account = {
    id: 'debit',
    name: 'Debit',
    type: 'debit',
    institution: 'Bank',
    last4: '0001',
    currency: 'MXN',
    balance: 80_000,
    isActive: true,
  }
  const credit: Account = {
    id: 'credit',
    name: 'Credit',
    type: 'credit',
    institution: 'Bank',
    last4: '0002',
    currency: 'MXN',
    creditLimit: 100_000,
    availableCredit: 40_000,
    isActive: true,
  }
  const activeMSI: MSIPurchase = {
    id: 'msi-active',
    accountId: 'credit',
    description: 'Laptop',
    totalAmount: 12_000,
    installmentAmount: 1_000,
    installmentCount: 12,
    installmentsPaid: 2,
    startDate: '2026-01-01',
    categoryId: null,
    status: 'active',
  }

  it('summarizes debit balances and credit debt with active installment context', () => {
    const summaries = deriveAccountSummary(
      [debit, { ...debit, id: 'empty-debit', balance: undefined }, credit],
      [activeMSI, { ...activeMSI, id: 'completed', status: 'completed' }],
    )

    expect(summaries[0].balanceOrDebt).toBe(80_000)
    expect(summaries[1].balanceOrDebt).toBe(0)
    expect(summaries[2]).toMatchObject({
      balanceOrDebt: 60_000,
      activeMSICount: 1,
      nextMSIPayment: 1_000,
    })
  })

  it('handles credit accounts without limits or active installments', () => {
    const [missingAvailable, missingLimit] = deriveAccountSummary(
      [
        { ...credit, availableCredit: undefined },
        { ...credit, creditLimit: undefined, availableCredit: undefined },
      ],
      [],
    )

    expect(missingAvailable).toMatchObject({
      balanceOrDebt: 100_000,
      activeMSICount: 0,
    })
    expect(missingLimit).toMatchObject({
      balanceOrDebt: 0,
      activeMSICount: 0,
      utilizationRate: 0,
    })
    expect(missingLimit.nextMSIPayment).toBeUndefined()
  })

  it('derives anchored budget progress using local today as the reference date', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 20, 12))
    const [progress] = deriveBudgetProgress(
      [
        {
          id: 'weekly-budget',
          categoryId: 'cat-food',
          amount: 10_000,
          period: 'weekly',
          startDate: '2026-07-15',
        },
      ],
      [
        transaction('before-cycle', 'expense', 8_000, 'cat-food', '2026-07-14'),
        transaction('cycle-start', 'expense', 1_000, 'cat-food', '2026-07-15'),
        transaction('future-in-cycle', 'expense', 2_000, 'cat-food', '2026-07-21'),
        transaction('next-cycle', 'expense', 4_000, 'cat-food', '2026-07-22'),
      ],
    )

    expect(progress).toMatchObject({ spent: 1_000, remaining: 9_000, progress: 0.1 })
  })

  it('derives goal progress and remaining amounts for funded and zero targets', () => {
    const goals: SavingsGoal[] = [
      {
        id: 'goal-funded',
        name: 'Funded',
        targetAmount: 20_000,
        currentAmount: 5_000,
        accountId: null,
        isCompleted: false,
        order: 0,
      },
      {
        id: 'goal-zero',
        name: 'Zero',
        targetAmount: 0,
        currentAmount: 500,
        accountId: null,
        isCompleted: true,
        order: 1,
      },
    ]

    expect(deriveGoalProgress(goals)).toEqual([
      { ...goals[0], progress: 0.25, remaining: 15_000 },
      { ...goals[1], progress: 0, remaining: -500 },
    ])
  })

  it('totals account balances, credit debt, and only current-month expenses', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 1, 0, 30))
    const summaries = deriveAccountSummary([debit, credit], [])
    const transactions = [
      transaction('expense', 'expense', 3_000, 'cat-food', '2026-07-10'),
      transaction('old', 'expense', 7_000, 'cat-food', '2026-06-30'),
      transaction('income', 'income', 20_000, 'cat-food', '2026-07-15'),
    ]

    expect(deriveTotalBalance(summaries)).toBe(80_000)
    expect(deriveTotalDebt(summaries)).toBe(60_000)
    expect(deriveMonthSpending(transactions)).toBe(3_000)
  })
})

function transaction(
  id: string,
  type: Transaction['type'],
  amount: number,
  categoryId: string | null,
  date: string,
): Transaction {
  return {
    id,
    accountId: 'debit',
    type,
    amount,
    categoryId,
    date,
    description: id,
    isReconciled: true,
    createdAt: date,
  }
}
