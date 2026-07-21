import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('API MSI purchases', () => {
  // MSI purchases are read-only and now backed by the real backend, covered
  // by msi-purchases.test.ts.
  it('is covered by msi-purchases.test.ts', () => {
    expect(true).toBe(true)
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
