import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useTransactionFilters } from '@/stores/transactionFilters'
import type { Transaction } from '@/types'
import { useFilteredTransactions } from './useFilteredTransactions'

const transactions: Transaction[] = [
  {
    id: 'groceries',
    accountId: 'checking',
    type: 'expense',
    amount: 12500,
    categoryId: 'food',
    date: '2026-07-18',
    description: 'Despensa semanal',
    merchant: 'Mercado Central',
    isReconciled: true,
    createdAt: '2026-07-18',
  },
  {
    id: 'coffee',
    accountId: 'credit',
    type: 'expense',
    amount: 8500,
    categoryId: 'food',
    date: '2026-07-12',
    description: 'Café con equipo',
    merchant: 'Nómada',
    isReconciled: false,
    createdAt: '2026-07-12',
  },
  {
    id: 'salary',
    accountId: 'checking',
    type: 'income',
    amount: 250000,
    categoryId: 'salary',
    date: '2026-07-01',
    description: 'Nómina',
    isReconciled: true,
    createdAt: '2026-07-01',
  },
  {
    id: 'transfer',
    accountId: 'checking',
    type: 'transfer',
    amount: 40000,
    categoryId: null,
    date: '2026-07-05',
    description: 'Ahorro mensual',
    transferToAccountId: 'savings',
    isReconciled: true,
    createdAt: '2026-07-05',
  },
  {
    id: 'old',
    accountId: 'checking',
    type: 'expense',
    amount: 1000,
    categoryId: 'food',
    date: '2026-06-30',
    description: 'Mes anterior',
    isReconciled: true,
    createdAt: '2026-06-30',
  },
]

function setFilters(overrides: Partial<ReturnType<typeof useTransactionFilters.getState>> = {}) {
  useTransactionFilters.setState({
    search: '',
    type: 'all',
    accountId: null,
    categoryId: null,
    month: '2026-07',
    ...overrides,
  })
}

afterEach(() => setFilters())

describe('useFilteredTransactions', () => {
  it('keeps only transactions from the selected month', () => {
    setFilters()

    const { result } = renderHook(() => useFilteredTransactions(transactions))

    expect(result.current.filtered.map((tx) => tx.id)).toEqual([
      'groceries',
      'coffee',
      'salary',
      'transfer',
    ])
  })

  it('searches descriptions and merchants without case sensitivity', () => {
    setFilters({ search: 'MERCADO' })
    const { result, rerender } = renderHook(() => useFilteredTransactions(transactions))

    expect(result.current.filtered.map((tx) => tx.id)).toEqual(['groceries'])

    act(() => result.current.filters.setSearch('café'))
    rerender()
    expect(result.current.filtered.map((tx) => tx.id)).toEqual(['coffee'])
  })

  it.each([
    ['type', { type: 'income' as const }, ['salary']],
    ['account', { accountId: 'credit' }, ['coffee']],
    ['category', { categoryId: 'food' }, ['groceries', 'coffee']],
  ])('applies the %s filter', (_name, filter, expectedIds) => {
    setFilters(filter)

    const { result } = renderHook(() => useFilteredTransactions(transactions))

    expect(result.current.filtered.map((tx) => tx.id)).toEqual(expectedIds)
  })

  it('intersects month, type, account, category, and search filters', () => {
    setFilters({
      search: 'nómada',
      type: 'expense',
      accountId: 'credit',
      categoryId: 'food',
    })

    const { result } = renderHook(() => useFilteredTransactions(transactions))

    expect(result.current.filtered.map((tx) => tx.id)).toEqual(['coffee'])
  })
})
