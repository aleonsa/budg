import { describe, expect, it } from 'vitest'
import type { Account, YieldReconciliation } from '@/types'
import {
  accrualStart,
  blendedAnnualYieldBps,
  daysBetween,
  describeYieldTiers,
  effectiveAnnualRateBps,
  estimateAccountYield,
  estimateYieldCents,
  formatBps,
  suggestYieldSplit,
  sumYield,
} from './yield'

const account: Account = {
  id: 'savings',
  name: 'Nu',
  type: 'debit',
  institution: 'Nu',
  last4: '0001',
  currency: 'MXN',
  balance: 10_000_000,
  annualYieldBps: 1200,
  balanceTrackingStartedAt: '2026-01-01T10:00:00Z',
  isActive: true,
}

function rec(overrides: Partial<YieldReconciliation>): YieldReconciliation {
  return {
    id: 'r',
    accountId: 'savings',
    transactionId: null,
    date: '2026-07-31',
    periodStart: '2026-07-01',
    balanceBefore: 10_000_000,
    balanceAfter: 10_100_000,
    yield: 100_000,
    adjustment: 0,
    estimatedYield: 98_000,
    annualYieldBps: 1200,
    annualYieldTiers: null,
    allocations: [],
    ...overrides,
  }
}

describe('yield helpers', () => {
  it('matches the backend daily-compounding estimate', () => {
    expect(estimateYieldCents(10_000_000, 1200, 30)).toBe(99_102)
    expect(estimateYieldCents(10_000_000, null, 30)).toBe(0)
    expect(estimateYieldCents(-1, 1200, 30)).toBe(0)
    expect(estimateYieldCents(10_000_000, 1200, 0)).toBe(0)
  })

  it('estimates and describes a tiered rate', () => {
    const tiers = [
      { upToCents: 2_500_000, annualYieldBps: 1500 },
      { upToCents: null, annualYieldBps: 700 },
    ]
    expect(estimateYieldCents(5_000_000, null, 30, tiers)).toBe(45_331)
    expect(estimateYieldCents(2_500_000, null, 30, tiers)).toBe(30_908)
    expect(estimateYieldCents(2_500_000, null, 365, tiers)).toBe(388_398)
    expect(blendedAnnualYieldBps(5_000_000, null, tiers)).toBe(1100)
    expect(describeYieldTiers(null, tiers, 'MXN')).toContain('15% hasta $25,000')
    expect(describeYieldTiers(null, tiers, 'MXN')).toContain('7% después')
  })

  it('accrues from the last reconciliation, else tracking start', () => {
    expect(accrualStart(account)).toBe('2026-01-01')
    expect(accrualStart({ ...account, yieldReconciledOn: '2026-07-15' })).toBe('2026-07-15')
    expect(accrualStart({ ...account, balanceTrackingStartedAt: undefined })).toBeNull()
    const estimate = estimateAccountYield(
      { ...account, yieldReconciledOn: '2026-07-15' },
      '2026-08-14',
    )
    expect(estimate).toEqual({ since: '2026-07-15', days: 30, accrued: 99_102, monthly: 99_102 })
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1)
  })

  it('computes the realized annual rate over the last year', () => {
    const history = [rec({}), rec({ date: '2024-01-31', periodStart: '2024-01-01', yield: 1 })]
    // 100,000 / (10,000,000 * 30) * 365 = 12.17%
    expect(effectiveAnnualRateBps(history, '2026-08-14')).toBe(1217)
    expect(effectiveAnnualRateBps([], '2026-08-14')).toBeNull()
    expect(sumYield(history, '2026-01-01', '2026-12-31')).toBe(100_000)
    expect(formatBps(1250)).toBe('12.5%')
    expect(formatBps(null)).toBe('—')
  })

  it('suggests treating large differences cautiously', () => {
    expect(suggestYieldSplit(95_000, 99_000)).toEqual({ yieldAmount: 95_000, suspicious: false })
    expect(suggestYieldSplit(500_000, 99_000)).toEqual({ yieldAmount: 99_000, suspicious: true })
    expect(suggestYieldSplit(-10, 99_000)).toEqual({ yieldAmount: 0, suspicious: true })
    expect(suggestYieldSplit(1_000, 0)).toEqual({ yieldAmount: 1_000, suspicious: false })
  })
})
