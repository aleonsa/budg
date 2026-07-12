/**
 * API Client — mock implementation.
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
  SavingsGoal,
  Transaction,
} from '@/types'
import { mockCategories, mockAccounts, mockTransactions, mockMSIPurchases, mockSavingsGoals, mockBudgets } from './mock'

/** Simulate network latency */
const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))

// ── Categories ──────────────────────────────────────────────
export async function getCategories(): Promise<Category[]> {
  await delay()
  return [...mockCategories].sort((a, b) => a.order - b.order)
}

// ── Accounts ────────────────────────────────────────────────
export async function getAccounts(): Promise<Account[]> {
  await delay()
  return [...mockAccounts]
}

// ── Transactions ────────────────────────────────────────────
export async function getTransactions(): Promise<Transaction[]> {
  await delay()
  return [...mockTransactions].sort((a, b) => b.date.localeCompare(a.date))
}

// ── MSI Purchases ───────────────────────────────────────────
export async function getMSIPurchases(): Promise<MSIPurchase[]> {
  await delay()
  return [...mockMSIPurchases]
}

// ── Savings Goals ───────────────────────────────────────────
export async function getSavingsGoals(): Promise<SavingsGoal[]> {
  await delay()
  return [...mockSavingsGoals].sort((a, b) => a.order - b.order)
}

// ── Budgets ─────────────────────────────────────────────────
export async function getBudgets(): Promise<Budget[]> {
  await delay()
  return [...mockBudgets]
}
