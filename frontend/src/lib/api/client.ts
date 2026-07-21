/**
 * API Client — mock implementation backed by an in-memory Zustand store.
 *
 * Category CRUD has been migrated to the real backend (see ./categories);
 * this file still hosts the remaining mock resources until each lands in
 * Phase 4+. When a resource is migrated, delete its functions here and
 * re-export the real implementation to keep callsites stable.
 */

import type { Account, Budget, MSIPurchase, Rule, SavingsGoal, Transaction } from '@/types'
import { useMockData } from '@/stores/mockData'

// Re-export real implementations so callers using `import * as api from
// '@/lib/api/client'` keep working transparently across the migration.
export { getCategories, createCategory, updateCategory, deleteCategory } from './categories'

/** Simulate network latency */
const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))

/** Snapshot accessor — always reads the latest in-memory state. */
const state = () => useMockData.getState()

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

export async function updateTransaction(id: string, patch: Partial<Transaction>): Promise<void> {
  await delay()
  state().updateTransaction(id, patch)
}

export async function deleteTransaction(id: string): Promise<void> {
  await delay()
  state().deleteTransaction(id)
}

export async function createAccount(input: Omit<Account, 'id' | 'isActive'>): Promise<Account> {
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

export async function updateSavingsGoal(id: string, patch: Partial<SavingsGoal>): Promise<void> {
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

// Category create/update/delete are backed by ./categories (re-exported above).

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
