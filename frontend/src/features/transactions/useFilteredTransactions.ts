import { useMemo } from 'react'
import type { Transaction } from '@/types'
import { useTransactionFilters } from '@/stores/transactionFilters'

/**
 * Filters transactions by active filters (search, type, account, category, month).
 * Returns filtered + grouped by date (descending).
 */
export function useFilteredTransactions(transactions: Transaction[]) {
  const filters = useTransactionFilters()

  const filtered = useMemo(() => {
    return transactions.filter((tx) => {
      // Month filter
      if (!tx.date.startsWith(filters.month)) return false

      // Type filter
      if (filters.type !== 'all' && tx.type !== filters.type) return false

      // Account filter
      if (filters.accountId && tx.accountId !== filters.accountId) return false

      // Category filter
      if (filters.categoryId && tx.categoryId !== filters.categoryId) return false

      // Search filter (description + merchant)
      if (filters.search) {
        const q = filters.search.toLowerCase()
        const haystack = `${tx.description} ${tx.merchant ?? ''}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }

      return true
    })
  }, [
    transactions,
    filters.month,
    filters.type,
    filters.accountId,
    filters.categoryId,
    filters.search,
  ])

  return { filtered, filters }
}
