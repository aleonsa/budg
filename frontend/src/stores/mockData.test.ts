import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { today } from '@/lib/date'
import type { Account, Budget, Category, Rule, SavingsGoal, Transaction } from '@/types'
import { genId, seedRules, useMockData } from './mockData'

const initialState = useMockData.getState()
const initialCollections = {
  categories: initialState.categories,
  accounts: initialState.accounts,
  transactions: initialState.transactions,
  msiPurchases: initialState.msiPurchases,
  savingsGoals: initialState.savingsGoals,
  budgets: initialState.budgets,
  rules: initialState.rules,
}

function restoreSeedData() {
  useMockData.setState({
    categories: initialCollections.categories.map((item) => ({ ...item })),
    accounts: initialCollections.accounts.map((item) => ({ ...item })),
    transactions: initialCollections.transactions.map((item) => ({ ...item })),
    msiPurchases: initialCollections.msiPurchases.map((item) => ({ ...item })),
    savingsGoals: initialCollections.savingsGoals.map((item) => ({ ...item })),
    budgets: initialCollections.budgets.map((item) => ({ ...item })),
    rules: initialCollections.rules.map((item) => ({ ...item })),
  })
}

beforeEach(restoreSeedData)
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('mock data seed', () => {
  it('rebases authored dates to today while preserving relative and optional dates', () => {
    const state = useMockData.getState()
    const todayKey = today()
    const latestTransaction = state.transactions.find((item) => item.id === 'tx-001')
    const priorTransaction = state.transactions.find((item) => item.id === 'tx-004')

    expect(latestTransaction).toMatchObject({ date: todayKey, createdAt: todayKey })
    expect(
      (new Date(latestTransaction!.date).getTime() - new Date(priorTransaction!.date).getTime()) /
        86_400_000,
    ).toBe(1)
    expect(state.budgets[0].startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(state.msiPurchases[0].nextInstallmentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(state.savingsGoals.find((goal) => goal.id === 'goal-laptop')?.targetDate).toBeUndefined()
    expect(state.rules).toEqual(seedRules)
  })
})

describe('genId', () => {
  it('uses browser UUIDs when available and a random fallback otherwise', () => {
    vi.stubGlobal('crypto', { randomUUID: () => '12345678-abcd-ef00-1234-567890abcdef' })
    expect(genId('tx')).toBe('tx-12345678')

    vi.stubGlobal('crypto', {})
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(genId('acc')).toBe('acc-i')
  })
})

describe('mock transaction lifecycle', () => {
  it('creates a fresh unreconciled transaction, then updates and deletes only that record', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' })
    const input: Omit<Transaction, 'id' | 'createdAt' | 'isReconciled'> = {
      accountId: 'acc-nomina',
      type: 'expense',
      amount: 12_345,
      categoryId: 'cat-food',
      date: '2026-07-19',
      description: 'Lunch',
    }

    const created = useMockData.getState().addTransaction(input)
    expect(created).toEqual({
      ...input,
      id: 'tx-aaaaaaaa',
      isReconciled: false,
      createdAt: today(),
    })
    expect(useMockData.getState().transactions[0]).toEqual(created)

    useMockData.getState().updateTransaction(created.id, {
      amount: 20_000,
      isReconciled: true,
    })
    expect(
      useMockData.getState().transactions.find((item) => item.id === created.id),
    ).toMatchObject({
      amount: 20_000,
      isReconciled: true,
    })
    expect(useMockData.getState().transactions.find((item) => item.id === 'tx-001')).toBeDefined()

    useMockData.getState().deleteTransaction(created.id)
    expect(useMockData.getState().transactions.some((item) => item.id === created.id)).toBe(false)
  })
})

describe('mock account and budget lifecycles', () => {
  it('assigns account defaults and supports account replacement and removal', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'bbbbbbbb-1111-2222-3333-444444444444' })
    const input: Omit<Account, 'id' | 'isActive'> = {
      name: 'Daily account',
      type: 'debit',
      institution: 'Bank',
      last4: '0001',
      currency: 'MXN',
      balance: 50_000,
    }

    const created = useMockData.getState().addAccount(input)
    expect(created).toEqual({ ...input, id: 'acc-bbbbbbbb', isActive: true })

    useMockData.getState().updateAccount(created.id, { name: 'Renamed', isActive: false })
    expect(useMockData.getState().accounts.find((item) => item.id === created.id)).toMatchObject({
      name: 'Renamed',
      isActive: false,
    })

    useMockData.getState().deleteAccount(created.id)
    expect(useMockData.getState().accounts.some((item) => item.id === created.id)).toBe(false)
  })

  it('preserves budget input through create, update, and delete', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'cccccccc-1111-2222-3333-444444444444' })
    const input: Omit<Budget, 'id'> = {
      categoryId: 'cat-food',
      amount: 300_000,
      period: 'monthly',
      startDate: '2026-07-01',
    }

    const created = useMockData.getState().addBudget(input)
    expect(created).toEqual({ ...input, id: 'bud-cccccccc' })

    useMockData.getState().updateBudget(created.id, { amount: 350_000 })
    expect(useMockData.getState().budgets.find((item) => item.id === created.id)?.amount).toBe(
      350_000,
    )

    useMockData.getState().deleteBudget(created.id)
    expect(useMockData.getState().budgets.some((item) => item.id === created.id)).toBe(false)
  })
})

describe('mock savings goals', () => {
  it('appends goals in display order, edits them, clamps withdrawals, and marks completed goals', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'dddddddd-1111-2222-3333-444444444444' })
    const input: Omit<SavingsGoal, 'id' | 'order'> = {
      name: 'Bike',
      targetAmount: 100_000,
      currentAmount: 25_000,
      accountId: null,
      isCompleted: false,
    }
    const originalCount = useMockData.getState().savingsGoals.length

    const created = useMockData.getState().addSavingsGoal(input)
    const persisted = useMockData.getState().savingsGoals.find((item) => item.id === created.id)
    expect(created).toEqual({ ...input, id: 'goal-dddddddd', order: originalCount })
    expect(persisted).toEqual(created)

    useMockData.getState().updateSavingsGoal(created.id, { name: 'Road bike' })
    useMockData.getState().contributeToGoal(created.id, -50_000)
    expect(
      useMockData.getState().savingsGoals.find((item) => item.id === created.id),
    ).toMatchObject({
      name: 'Road bike',
      currentAmount: 0,
      isCompleted: false,
    })

    useMockData.getState().contributeToGoal(created.id, 120_000)
    expect(
      useMockData.getState().savingsGoals.find((item) => item.id === created.id),
    ).toMatchObject({
      currentAmount: 120_000,
      isCompleted: true,
    })
    expect(
      useMockData.getState().savingsGoals.find((item) => item.id === 'goal-emergency'),
    ).toBeDefined()

    useMockData.getState().deleteSavingsGoal(created.id)
    expect(useMockData.getState().savingsGoals.some((item) => item.id === created.id)).toBe(false)
  })
})

describe('mock categories and rules', () => {
  it('places user categories after their kind, allows edits, and removes the target', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'eeeeeeee-1111-2222-3333-444444444444' })
    const input: Omit<Category, 'id' | 'order' | 'isSystem'> = {
      name: 'Side work',
      kind: 'income',
      color: 'blue',
      icon: 'Briefcase',
      parentId: null,
    }
    const maxIncomeOrder = Math.max(
      ...useMockData
        .getState()
        .categories.filter((item) => item.kind === 'income')
        .map((item) => item.order),
    )

    const created = useMockData.getState().addCategory(input)
    expect(created).toEqual({
      ...input,
      id: 'cat-eeeeeeee',
      isSystem: false,
      order: maxIncomeOrder + 1,
    })
    expect(useMockData.getState().categories.find((item) => item.id === created.id)).toEqual(
      created,
    )

    useMockData.getState().updateCategory(created.id, { color: 'purple', name: 'Consulting' })
    expect(useMockData.getState().categories.find((item) => item.id === created.id)).toMatchObject({
      color: 'purple',
      name: 'Consulting',
    })

    useMockData.getState().deleteCategory(created.id)
    expect(useMockData.getState().categories.some((item) => item.id === created.id)).toBe(false)
  })

  it('adds default-priority rules, toggles activation, and deletes only the target', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'ffffffff-1111-2222-3333-444444444444' })
    const input: Omit<Rule, 'id' | 'priority'> = {
      field: 'description',
      operator: 'startsWith',
      value: 'Rent',
      categoryId: 'cat-home',
      isActive: true,
    }

    const created = useMockData.getState().addRule(input)
    expect(created).toEqual({ ...input, id: 'rule-ffffffff', priority: 1 })

    useMockData.getState().toggleRule(created.id)
    expect(useMockData.getState().rules.find((item) => item.id === created.id)?.isActive).toBe(
      false,
    )
    expect(useMockData.getState().rules.find((item) => item.id === 'rule-1')?.isActive).toBe(true)

    useMockData.getState().deleteRule(created.id)
    expect(useMockData.getState().rules.some((item) => item.id === created.id)).toBe(false)
  })
})
