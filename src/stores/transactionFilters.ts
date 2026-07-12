import { create } from 'zustand'
import type { TransactionType, ID } from '@/types'

export type TransactionFilterType = TransactionType | 'all'

interface TransactionFilters {
  search: string
  type: TransactionFilterType
  accountId: ID | null
  categoryId: ID | null
  /** ISO month string 'YYYY-MM' */
  month: string

  setSearch: (s: string) => void
  setType: (t: TransactionFilterType) => void
  setAccount: (id: ID | null) => void
  setCategory: (id: ID | null) => void
  setMonth: (m: string) => void
  reset: () => void
}

const currentMonth = () => new Date().toISOString().slice(0, 7)

const DEFAULTS = {
  search: '',
  type: 'all' as TransactionFilterType,
  accountId: null,
  categoryId: null,
  month: currentMonth(),
}

export const useTransactionFilters = create<TransactionFilters>((set) => ({
  ...DEFAULTS,
  setSearch: (search) => set({ search }),
  setType: (type) => set({ type }),
  setAccount: (accountId) => set({ accountId }),
  setCategory: (categoryId) => set({ categoryId }),
  setMonth: (month) => set({ month }),
  reset: () => set({ ...DEFAULTS, month: currentMonth() }),
}))
