import { useMemo } from 'react'
import type { Account, Category, Transaction } from '@/types'
import { useTransactionFilters } from '@/stores/transactionFilters'

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('es-MX')
}

/**
 * Filters transactions by active filters (search, type, account, category, month).
 * Returns filtered + grouped by date (descending).
 */
export function useFilteredTransactions(
  transactions: Transaction[],
  accounts: Account[] = [],
  categories: Category[] = [],
) {
  const filters = useTransactionFilters()

  const filtered = useMemo(() => {
    const accountNames = new Map(accounts.map((account) => [account.id, account.name]))
    const categoryNames = new Map(categories.map((category) => [category.id, category.name]))

    return transactions.filter((tx) => {
      // Text search is global by design. A person looking for "Amazon" or
      // "seguro" should not need to guess which month contains it.
      if (!filters.search && !tx.date.startsWith(filters.month)) return false

      // Type filter
      if (filters.type !== 'all' && tx.type !== filters.type) return false

      // Account filter
      if (filters.accountId && tx.accountId !== filters.accountId) return false

      // Category filter
      if (filters.categoryId && tx.categoryId !== filters.categoryId) return false

      // Search is intentionally broad: a user remembers "Nu", "super" or
      // "Amazon", not necessarily the exact transaction description.
      if (filters.search) {
        const terms = normalizeSearch(filters.search).split(/\s+/).filter(Boolean)
        const haystack = normalizeSearch(
          [
            tx.description,
            tx.merchant,
            tx.categoryId ? categoryNames.get(tx.categoryId) : '',
            accountNames.get(tx.accountId),
            tx.transferToAccountId ? accountNames.get(tx.transferToAccountId) : '',
          ]
            .filter(Boolean)
            .join(' '),
        )
        if (!terms.every((term) => haystack.includes(term))) return false
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
    accounts,
    categories,
  ])

  return { filtered, filters }
}
