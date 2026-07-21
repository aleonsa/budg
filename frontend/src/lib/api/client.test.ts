import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Rule, SavingsGoal } from '@/types'
import { useMockData } from '@/stores/mockData'
import * as client from './client'

const initialState = useMockData.getState()
const initialCollections = {
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
    const goals = [
      { ...initialCollections.savingsGoals[0], id: 'goal-later', order: 2 },
      { ...initialCollections.savingsGoals[1], id: 'goal-first', order: 1 },
    ]
    const rules = [
      { ...initialCollections.rules[0], id: 'rule-later', priority: 4 },
      { ...initialCollections.rules[1], id: 'rule-first', priority: 2 },
    ]
    useMockData.setState({ savingsGoals: goals, rules })

    const request = Promise.all([
      client.getMSIPurchases(),
      client.getSavingsGoals(),
      client.getRules(),
    ])
    await vi.advanceTimersByTimeAsync(200)
    const [msi, goalResult, ruleResult] = await request

    expect(goalResult.map((item) => item.id)).toEqual(['goal-first', 'goal-later'])
    expect(ruleResult.map((item) => item.id)).toEqual(['rule-first', 'rule-later'])
    expect(msi).toEqual(initialCollections.msiPurchases)
  })
})

describe('API transaction mutations', () => {
  // Transaction create/update/delete are now backed by the real backend and are
  // covered by src/lib/api/transactions.test.ts.
  it('is covered by transactions.test.ts', () => {
    expect(true).toBe(true)
  })
})

describe('API account and budget mutations', () => {
  // Account and budget create/update/delete are now backed by the real backend
  // and are covered by accounts.test.ts and budgets.test.ts.
  it('is covered by accounts.test.ts and budgets.test.ts', () => {
    expect(true).toBe(true)
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
