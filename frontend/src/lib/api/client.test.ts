import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account, Budget, Rule, SavingsGoal, Transaction } from '@/types'
import { useMockData } from '@/stores/mockData'
import * as client from './client'

const initialState = useMockData.getState()
const initialCollections = {
  accounts: initialState.accounts,
  transactions: initialState.transactions,
  msiPurchases: initialState.msiPurchases,
  savingsGoals: initialState.savingsGoals,
  budgets: initialState.budgets,
  rules: initialState.rules,
}

async function finishDelay<T>(request: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(200)
  return request
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('crypto', { randomUUID: () => '12345678-abcd-ef00-1234-567890abcdef' })
  useMockData.setState({
    accounts: initialCollections.accounts.map((item) => ({ ...item })),
    transactions: initialCollections.transactions.map((item) => ({ ...item })),
    msiPurchases: initialCollections.msiPurchases.map((item) => ({ ...item })),
    savingsGoals: initialCollections.savingsGoals.map((item) => ({ ...item })),
    budgets: initialCollections.budgets.map((item) => ({ ...item })),
    rules: initialCollections.rules.map((item) => ({ ...item })),
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('API reads', () => {
  it('returns independent, domain-sorted collections after simulated latency', async () => {
    const transactions = [
      { ...initialCollections.transactions[0], id: 'tx-old', date: '2026-01-01' },
      { ...initialCollections.transactions[1], id: 'tx-new', date: '2026-02-01' },
    ]
    const goals = [
      { ...initialCollections.savingsGoals[0], id: 'goal-later', order: 2 },
      { ...initialCollections.savingsGoals[1], id: 'goal-first', order: 1 },
    ]
    const rules = [
      { ...initialCollections.rules[0], id: 'rule-later', priority: 4 },
      { ...initialCollections.rules[1], id: 'rule-first', priority: 2 },
    ]
    useMockData.setState({ transactions, savingsGoals: goals, rules })

    const request = Promise.all([
      client.getAccounts(),
      client.getTransactions(),
      client.getMSIPurchases(),
      client.getSavingsGoals(),
      client.getBudgets(),
      client.getRules(),
    ])
    await vi.advanceTimersByTimeAsync(200)
    const [accounts, transactionResult, msi, goalResult, budgets, ruleResult] = await request

    expect(transactionResult.map((item) => item.id)).toEqual(['tx-new', 'tx-old'])
    expect(goalResult.map((item) => item.id)).toEqual(['goal-first', 'goal-later'])
    expect(ruleResult.map((item) => item.id)).toEqual(['rule-first', 'rule-later'])
    expect(accounts).toEqual(initialCollections.accounts)
    expect(msi).toEqual(initialCollections.msiPurchases)
    expect(budgets).toEqual(initialCollections.budgets)
    expect(transactionResult).not.toBe(transactions)
  })

  it('reads state at response time rather than capturing a stale request snapshot', async () => {
    const request = client.getAccounts()
    useMockData.setState({ accounts: [] })

    expect(await finishDelay(request)).toEqual([])
  })
})

describe('API transaction mutations', () => {
  it('creates, updates, and deletes transactions visible to later reads', async () => {
    const input: Omit<Transaction, 'id' | 'createdAt' | 'isReconciled'> = {
      accountId: 'acc-nomina',
      type: 'expense',
      amount: 900,
      categoryId: 'cat-food',
      date: '2026-07-20',
      description: 'Coffee',
    }

    const created = await finishDelay(client.createTransaction(input))
    expect(created).toMatchObject({ ...input, id: 'tx-12345678', isReconciled: false })

    await finishDelay(client.updateTransaction(created.id, { amount: 1_100 }))
    expect(useMockData.getState().transactions.find((item) => item.id === created.id)?.amount).toBe(
      1_100,
    )

    await finishDelay(client.deleteTransaction(created.id))
    expect(useMockData.getState().transactions.some((item) => item.id === created.id)).toBe(false)
  })
})

describe('API account and budget mutations', () => {
  it('exposes account create, update, and delete outcomes', async () => {
    const input: Omit<Account, 'id' | 'isActive'> = {
      name: 'Cash',
      type: 'debit',
      institution: 'Wallet',
      last4: '0000',
      currency: 'MXN',
      balance: 2_000,
    }

    const created = await finishDelay(client.createAccount(input))
    expect(created).toEqual({ ...input, id: 'acc-12345678', isActive: true })

    await finishDelay(client.updateAccount(created.id, { balance: 3_000 }))
    expect(useMockData.getState().accounts.find((item) => item.id === created.id)?.balance).toBe(
      3_000,
    )

    await finishDelay(client.deleteAccount(created.id))
    expect(useMockData.getState().accounts.some((item) => item.id === created.id)).toBe(false)
  })

  it('exposes budget create, update, and delete outcomes', async () => {
    const input: Omit<Budget, 'id'> = {
      categoryId: 'cat-food',
      amount: 10_000,
      period: 'weekly',
      startDate: '2026-07-20',
    }

    const created = await finishDelay(client.createBudget(input))
    expect(created).toEqual({ ...input, id: 'bud-12345678' })

    await finishDelay(client.updateBudget(created.id, { amount: 20_000 }))
    expect(useMockData.getState().budgets.find((item) => item.id === created.id)?.amount).toBe(
      20_000,
    )

    await finishDelay(client.deleteBudget(created.id))
    expect(useMockData.getState().budgets.some((item) => item.id === created.id)).toBe(false)
  })
})

describe('API savings, category, and rule mutations', () => {
  it('creates, edits, contributes to, and deletes savings goals', async () => {
    const input: Omit<SavingsGoal, 'id' | 'order'> = {
      name: 'Trip',
      targetAmount: 50_000,
      currentAmount: 5_000,
      accountId: null,
      isCompleted: false,
    }

    const created = await finishDelay(client.createSavingsGoal(input))
    const persisted = useMockData.getState().savingsGoals.find((item) => item.id === created.id)
    expect(created).toEqual({ ...input, id: 'goal-12345678', order: 3 })
    expect(persisted).toEqual(created)

    await finishDelay(client.updateSavingsGoal(created.id, { name: 'Long trip' }))
    await finishDelay(client.contributeToSavingsGoal(created.id, 45_000))
    expect(
      useMockData.getState().savingsGoals.find((item) => item.id === created.id),
    ).toMatchObject({
      name: 'Long trip',
      currentAmount: 50_000,
      isCompleted: true,
    })

    await finishDelay(client.deleteSavingsGoal(created.id))
    expect(useMockData.getState().savingsGoals.some((item) => item.id === created.id)).toBe(false)
  })

  // Category create/update/delete are now backed by the real backend and are
  // covered by src/lib/api/categories.test.ts.

  it('creates default-priority rules, toggles them, and deletes them', async () => {
    const input: Omit<Rule, 'id' | 'priority'> = {
      field: 'merchant',
      operator: 'contains',
      value: 'Cafe',
      categoryId: 'cat-food',
      isActive: true,
    }

    const created = await finishDelay(client.createRule(input))
    expect(created).toEqual({ ...input, id: 'rule-12345678', priority: 1 })

    await finishDelay(client.toggleRule(created.id))
    expect(useMockData.getState().rules.find((item) => item.id === created.id)?.isActive).toBe(
      false,
    )

    await finishDelay(client.deleteRule(created.id))
    expect(useMockData.getState().rules.some((item) => item.id === created.id)).toBe(false)
  })
})
