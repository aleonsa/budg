/**
 * API Client — mock implementation backed by an in-memory Zustand store.
 *
 * Category and account CRUD have been migrated to the real backend (see
 * ./categories, ./accounts); this file still hosts the remaining mock
 * resources until each lands in a later phase. When a resource is migrated,
 * delete its functions here and re-export the real implementation to keep
 * callsites stable.
 */

import type { MSIPurchase } from '@/types'
import { useMockData } from '@/stores/mockData'

// Re-export real implementations so callers using `import * as api from
// '@/lib/api/client'` keep working transparently across the migration.
export { getCategories, createCategory, updateCategory, deleteCategory } from './categories'
export { getAccounts, createAccount, updateAccount, deleteAccount } from './accounts'
export {
  getTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
} from './transactions'
export { getBudgets, createBudget, updateBudget, deleteBudget } from './budgets'
export {
  getSavingsGoals,
  createSavingsGoal,
  updateSavingsGoal,
  contributeToSavingsGoal,
  deleteSavingsGoal,
} from './savings-goals'
export { getRules, createRule, toggleRule, deleteRule } from './rules'

/** Simulate network latency */
const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))

/** Snapshot accessor — always reads the latest in-memory state. */
const state = () => useMockData.getState()

// ── MSI Purchases ───────────────────────────────────────────
export async function getMSIPurchases(): Promise<MSIPurchase[]> {
  await delay()
  return [...state().msiPurchases]
}

// ── Mutations ───────────────────────────────────────────────

// Transactions, accounts, budgets, savings goals, and rules are backed by
// their own API modules (re-exported above).

// Category create/update/delete are backed by ./categories (re-exported above).
