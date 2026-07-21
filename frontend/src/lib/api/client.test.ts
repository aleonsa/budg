import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Rule } from '@/types'
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
    const rules = [
      { ...initialCollections.rules[0], id: 'rule-later', priority: 4 },
      { ...initialCollections.rules[1], id: 'rule-first', priority: 2 },
    ]
    useMockData.setState({ rules })

    const request = Promise.all([client.getMSIPurchases(), client.getRules()])
    await vi.advanceTimersByTimeAsync(200)
    const [msi, ruleResult] = await request

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

describe('API savings and rule mutations', () => {
  // Savings goals create/update/delete are now backed by the real backend
  // and are covered by savings-goals.test.ts.
  it('is covered by savings-goals.test.ts', () => {
    expect(true).toBe(true)
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
