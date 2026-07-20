import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTransactionFilters } from './transactionFilters'

describe('transaction filters store', () => {
  beforeEach(() => {
    useTransactionFilters.setState({
      search: '',
      type: 'all',
      accountId: null,
      categoryId: null,
      month: '2026-07',
    })
  })

  afterEach(() => vi.useRealTimers())

  it('keeps a complete filter selection for transaction queries', () => {
    const filters = useTransactionFilters.getState()
    filters.setSearch('coffee')
    filters.setType('expense')
    filters.setAccount('acc-checking')
    filters.setCategory('cat-food')
    filters.setMonth('2026-06')

    expect(useTransactionFilters.getState()).toMatchObject({
      search: 'coffee',
      type: 'expense',
      accountId: 'acc-checking',
      categoryId: 'cat-food',
      month: '2026-06',
    })
  })

  it('clears all selections and recomputes month from reset time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2027-01-15T12:00:00Z'))

    useTransactionFilters.getState().reset()

    expect(useTransactionFilters.getState()).toMatchObject({
      search: '',
      type: 'all',
      accountId: null,
      categoryId: null,
      month: '2027-01',
    })
  })
})
