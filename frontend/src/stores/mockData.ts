import { create } from 'zustand'
import type {
  Account,
  Budget,
  Category,
  MSIPurchase,
  Rule,
  SavingsGoal,
  Transaction,
} from '@/types'
import {
  mockAccounts,
  mockBudgets,
  mockCategories,
  mockMSIPurchases,
  mockSavingsGoals,
  mockTransactions,
} from '@/lib/api/mock'

/**
 * In-memory mock data store.
 *
 * Not persisted — a page refresh resets the demo to seed data, which is the
 * intended mock behaviour. All API mutations route through here so the UI
 * reflects changes live via TanStack Query invalidation.
 */

// ── Rule seed (previously a const inside RulesPage) ──────────

export const seedRules: Rule[] = [
  {
    id: 'rule-1',
    field: 'merchant',
    operator: 'contains',
    value: 'Uber',
    categoryId: 'cat-transport',
    isActive: true,
    priority: 1,
  },
  {
    id: 'rule-2',
    field: 'merchant',
    operator: 'contains',
    value: 'OXXO',
    categoryId: 'cat-food',
    isActive: true,
    priority: 2,
  },
  {
    id: 'rule-3',
    field: 'description',
    operator: 'contains',
    value: 'Nómina',
    categoryId: 'cat-income',
    isActive: true,
    priority: 1,
  },
  {
    id: 'rule-4',
    field: 'merchant',
    operator: 'contains',
    value: 'Netflix',
    categoryId: 'cat-entertainment',
    isActive: false,
    priority: 3,
  },
]

// ── ID + cents helpers ────────────────────────────────────────

export function genId(prefix: string): string {
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `${prefix}-${uuid}`
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

// ── Date rebasing ────────────────────────────────────────────
// Mock data is authored against a fixed "today" (2025-07-12). The app's
// period logic (dashboard, deriveMonthSpending, default month filter) uses
// the real clock, so we rebase every seed date to be relative to the actual
// current date. This keeps the demo populated regardless of when it runs.

const MOCK_ANCHOR = '2025-07-12'

function shiftDate(iso: string | undefined, offsetDays: number): string | undefined {
  if (!iso) return iso
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

const REBASE_OFFSET_DAYS = (() => {
  const today = new Date(`${todayISO()}T00:00:00Z`).getTime()
  const anchor = new Date(`${MOCK_ANCHOR}T00:00:00Z`).getTime()
  return Math.round((today - anchor) / 86_400_000)
})()

function rebaseTransactions(items: Transaction[]): Transaction[] {
  return items.map((t) => ({
    ...t,
    date: shiftDate(t.date, REBASE_OFFSET_DAYS)!,
    createdAt: shiftDate(t.createdAt, REBASE_OFFSET_DAYS)!,
  }))
}

function rebaseMSI(items: MSIPurchase[]): MSIPurchase[] {
  return items.map((m) => ({
    ...m,
    startDate: shiftDate(m.startDate, REBASE_OFFSET_DAYS)!,
    nextInstallmentDate: shiftDate(m.nextInstallmentDate, REBASE_OFFSET_DAYS),
  }))
}

function rebaseBudgets(items: Budget[]): Budget[] {
  return items.map((b) => ({
    ...b,
    startDate: shiftDate(b.startDate, REBASE_OFFSET_DAYS)!,
  }))
}

function rebaseGoals(items: SavingsGoal[]): SavingsGoal[] {
  return items.map((g) => ({
    ...g,
    targetDate: shiftDate(g.targetDate, REBASE_OFFSET_DAYS),
  }))
}

// ── Store shape ───────────────────────────────────────────────

interface MockDataState {
  categories: Category[]
  accounts: Account[]
  transactions: Transaction[]
  msiPurchases: MSIPurchase[]
  savingsGoals: SavingsGoal[]
  budgets: Budget[]
  rules: Rule[]

  // Transactions
  addTransaction: (input: Omit<Transaction, 'id' | 'createdAt' | 'isReconciled'>) => Transaction
  updateTransaction: (id: string, patch: Partial<Transaction>) => void
  deleteTransaction: (id: string) => void

  // Accounts
  addAccount: (input: Omit<Account, 'id' | 'isActive'>) => Account
  updateAccount: (id: string, patch: Partial<Account>) => void
  deleteAccount: (id: string) => void

  // Budgets
  addBudget: (input: Omit<Budget, 'id'>) => Budget
  updateBudget: (id: string, patch: Partial<Budget>) => void
  deleteBudget: (id: string) => void

  // Savings goals
  addSavingsGoal: (input: Omit<SavingsGoal, 'id' | 'order'>) => SavingsGoal
  updateSavingsGoal: (id: string, patch: Partial<SavingsGoal>) => void
  contributeToGoal: (id: string, amount: number) => void
  deleteSavingsGoal: (id: string) => void

  // Categories
  addCategory: (input: Omit<Category, 'id' | 'order' | 'isSystem'>) => Category
  updateCategory: (id: string, patch: Partial<Category>) => void
  deleteCategory: (id: string) => void

  // Rules
  addRule: (input: Omit<Rule, 'id' | 'priority'>) => Rule
  toggleRule: (id: string) => void
  deleteRule: (id: string) => void
}

export const useMockData = create<MockDataState>((set) => ({
  categories: [...mockCategories],
  accounts: [...mockAccounts],
  transactions: rebaseTransactions(mockTransactions),
  msiPurchases: rebaseMSI(mockMSIPurchases),
  savingsGoals: rebaseGoals(mockSavingsGoals),
  budgets: rebaseBudgets(mockBudgets),
  rules: [...seedRules],

  // ── Transactions ──────────────────────────────────────────
  addTransaction: (input) => {
    const tx: Transaction = {
      ...input,
      id: genId('tx'),
      isReconciled: false,
      createdAt: todayISO(),
    }
    set((s) => ({ transactions: [tx, ...s.transactions] }))
    return tx
  },
  updateTransaction: (id, patch) =>
    set((s) => ({
      transactions: s.transactions.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),
  deleteTransaction: (id) =>
    set((s) => ({ transactions: s.transactions.filter((t) => t.id !== id) })),

  // ── Accounts ──────────────────────────────────────────────
  addAccount: (input) => {
    const acc: Account = { ...input, id: genId('acc'), isActive: true }
    set((s) => ({ accounts: [...s.accounts, acc] }))
    return acc
  },
  updateAccount: (id, patch) =>
    set((s) => ({
      accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    })),
  deleteAccount: (id) =>
    set((s) => ({ accounts: s.accounts.filter((a) => a.id !== id) })),

  // ── Budgets ───────────────────────────────────────────────
  addBudget: (input) => {
    const budget: Budget = { ...input, id: genId('bud') }
    set((s) => ({ budgets: [...s.budgets, budget] }))
    return budget
  },
  updateBudget: (id, patch) =>
    set((s) => ({
      budgets: s.budgets.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    })),
  deleteBudget: (id) => set((s) => ({ budgets: s.budgets.filter((b) => b.id !== id) })),

  // ── Savings goals ─────────────────────────────────────────
  addSavingsGoal: (input) => {
    const goal: SavingsGoal = { ...input, id: genId('goal'), order: 0 }
    set((s) => {
      const order = s.savingsGoals.length
      const withOrder = { ...goal, order }
      return { savingsGoals: [...s.savingsGoals, withOrder] }
    })
    return goal
  },
  updateSavingsGoal: (id, patch) =>
    set((s) => ({
      savingsGoals: s.savingsGoals.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    })),
  contributeToGoal: (id, amount) =>
    set((s) => ({
      savingsGoals: s.savingsGoals.map((g) => {
        if (g.id !== id) return g
        const currentAmount = Math.max(0, g.currentAmount + amount)
        const isCompleted = currentAmount >= g.targetAmount
        return { ...g, currentAmount, isCompleted }
      }),
    })),
  deleteSavingsGoal: (id) =>
    set((s) => ({ savingsGoals: s.savingsGoals.filter((g) => g.id !== id) })),

  // ── Categories ────────────────────────────────────────────
  addCategory: (input) => {
    const cat: Category = {
      ...input,
      id: genId('cat'),
      isSystem: false,
      order: 0,
    }
    set((s) => {
      // Place at the end of its kind group; system cats keep low orders.
      const sameKind = s.categories.filter((c) => c.kind === input.kind)
      const order = sameKind.reduce((max, c) => Math.max(max, c.order), 0) + 1
      return { categories: [...s.categories, { ...cat, order }] }
    })
    return cat
  },
  updateCategory: (id, patch) =>
    set((s) => ({
      categories: s.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    })),
  deleteCategory: (id) =>
    set((s) => ({ categories: s.categories.filter((c) => c.id !== id) })),

  // ── Rules ─────────────────────────────────────────────────
  addRule: (input) => {
    const rule: Rule = {
      ...input,
      id: genId('rule'),
      priority: 1,
    }
    set((s) => ({ rules: [...s.rules, rule] }))
    return rule
  },
  toggleRule: (id) =>
    set((s) => ({
      rules: s.rules.map((r) => (r.id === id ? { ...r, isActive: !r.isActive } : r)),
    })),
  deleteRule: (id) => set((s) => ({ rules: s.rules.filter((r) => r.id !== id) })),
}))
