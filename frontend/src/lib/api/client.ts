/**
 * API Client — mock implementation backed by an in-memory Zustand store.
 *
 * When the Go backend is ready, replace the internals of each function
 * with `fetch()` calls. The function signatures and return types stay
 * the same, so no component or hook needs to change.
 */

import type {
  Account,
  Budget,
  Category,
  MSIPurchase,
  Rule,
  SavingsGoal,
  Transaction,
} from '@/types'
import { useMockData } from '@/stores/mockData'

/** Simulate network latency */
const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))

/** Snapshot accessor — always reads the latest in-memory state. */
const state = () => useMockData.getState()

// ── Categories ──────────────────────────────────────────────
export async function getCategories(): Promise<Category[]> {
  await delay()
  return [...state().categories].sort((a, b) => a.order - b.order)
}

// ── Accounts ────────────────────────────────────────────────
export async function getAccounts(): Promise<Account[]> {
  await delay()
  return [...state().accounts]
}

// ── Transactions ────────────────────────────────────────────
export async function getTransactions(): Promise<Transaction[]> {
  await delay()
  return [...state().transactions].sort((a, b) => b.date.localeCompare(a.date))
}

// ── MSI Purchases ───────────────────────────────────────────
export async function getMSIPurchases(): Promise<MSIPurchase[]> {
  await delay()
  return [...state().msiPurchases]
}

// ── Savings Goals ───────────────────────────────────────────
export async function getSavingsGoals(): Promise<SavingsGoal[]> {
  await delay()
  return [...state().savingsGoals].sort((a, b) => a.order - b.order)
}

// ── Budgets ─────────────────────────────────────────────────
export async function getBudgets(): Promise<Budget[]> {
  await delay()
  return [...state().budgets]
}

// ── Rules ───────────────────────────────────────────────────
export async function getRules(): Promise<Rule[]> {
  await delay()
  return [...state().rules].sort((a, b) => a.priority - b.priority)
}

// ── Mutations ───────────────────────────────────────────────

export async function createTransaction(
  input: Omit<Transaction, 'id' | 'createdAt' | 'isReconciled'>,
): Promise<Transaction> {
  await delay()
  return state().addTransaction(input)
}

export async function updateTransaction(
  id: string,
  patch: Partial<Transaction>,
): Promise<void> {
  await delay()
  state().updateTransaction(id, patch)
}

export async function deleteTransaction(id: string): Promise<void> {
  await delay()
  state().deleteTransaction(id)
}

export async function createAccount(
  input: Omit<Account, 'id' | 'isActive'>,
): Promise<Account> {
  await delay()
  return state().addAccount(input)
}

export async function updateAccount(id: string, patch: Partial<Account>): Promise<void> {
  await delay()
  state().updateAccount(id, patch)
}

export async function deleteAccount(id: string): Promise<void> {
  await delay()
  state().deleteAccount(id)
}

export async function createBudget(input: Omit<Budget, 'id'>): Promise<Budget> {
  await delay()
  return state().addBudget(input)
}

export async function updateBudget(id: string, patch: Partial<Budget>): Promise<void> {
  await delay()
  state().updateBudget(id, patch)
}

export async function deleteBudget(id: string): Promise<void> {
  await delay()
  state().deleteBudget(id)
}

export async function createSavingsGoal(
  input: Omit<SavingsGoal, 'id' | 'order'>,
): Promise<SavingsGoal> {
  await delay()
  return state().addSavingsGoal(input)
}

export async function updateSavingsGoal(
  id: string,
  patch: Partial<SavingsGoal>,
): Promise<void> {
  await delay()
  state().updateSavingsGoal(id, patch)
}

export async function contributeToSavingsGoal(id: string, amount: number): Promise<void> {
  await delay()
  state().contributeToGoal(id, amount)
}

export async function deleteSavingsGoal(id: string): Promise<void> {
  await delay()
  state().deleteSavingsGoal(id)
}

export async function createCategory(
  input: Omit<Category, 'id' | 'order' | 'isSystem'>,
): Promise<Category> {
  await delay()
  return state().addCategory(input)
}

export async function updateCategory(id: string, patch: Partial<Category>): Promise<void> {
  await delay()
  state().updateCategory(id, patch)
}

export async function deleteCategory(id: string): Promise<void> {
  await delay()
  state().deleteCategory(id)
}

export async function createRule(input: Omit<Rule, 'id' | 'priority'>): Promise<Rule> {
  await delay()
  return state().addRule(input)
}

export async function toggleRule(id: string): Promise<void> {
  await delay()
  state().toggleRule(id)
}

export async function deleteRule(id: string): Promise<void> {
  await delay()
  state().deleteRule(id)
}
