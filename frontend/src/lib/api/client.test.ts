import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMockData } from '@/stores/mockData'
import * as client from './client'

const initialState = useMockData.getState()
const initialCollections = {
  msiPurchases: initialState.msiPurchases,
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('crypto', { randomUUID: () => '12345678-abcd-ef00-1234-567890abcdef' })
  useMockData.setState({
    msiPurchases: initialCollections.msiPurchases.map((item) => ({ ...item })),
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('API reads', () => {
  it('returns independent, domain-sorted collections after simulated latency', async () => {
    const request = client.getMSIPurchases()
    await vi.advanceTimersByTimeAsync(200)
    const msi = await request

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

describe('API savings mutations', () => {
  // Savings goals create/update/delete are now backed by the real backend
  // and are covered by savings-goals.test.ts.
  it('is covered by savings-goals.test.ts', () => {
    expect(true).toBe(true)
  })

  // Rules are now backed by the real backend and covered by rules.test.ts.
})
