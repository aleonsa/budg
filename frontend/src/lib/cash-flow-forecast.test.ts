import { describe, expect, it } from 'vitest'
import type { Account, MSIPurchase, RecurringTransaction } from '@/types'
import {
  addDaysISO,
  computeCashFlowForecast,
  projectMSIOccurrences,
  projectRecurringOccurrences,
  sampleForecastTimeline,
} from './cash-flow-forecast'
import { estimateYieldCents } from './yield'

describe('cash-flow-forecast', () => {
  describe('addDaysISO', () => {
    it('adds days across month boundaries', () => {
      expect(addDaysISO('2026-08-15', 5)).toBe('2026-08-20')
      expect(addDaysISO('2026-08-30', 5)).toBe('2026-09-04')
      expect(addDaysISO('2026-12-30', 5)).toBe('2027-01-04')
    })
  })

  describe('projectRecurringOccurrences', () => {
    it('projects monthly occurrences anchored to day of month', () => {
      const item: RecurringTransaction = {
        id: 'rec-1',
        accountId: 'acc-1',
        categoryId: null,
        description: 'Netflix',
        amount: 21900,
        frequency: 'monthly',
        startDate: '2026-01-05',
        nextDate: '2026-08-05',
        isActive: true,
      }
      const dates = projectRecurringOccurrences(item, '2026-08-01', '2026-10-15')
      expect(dates).toEqual(['2026-08-05', '2026-09-05', '2026-10-05'])
    })

    it('clamps 31st anchor on short months without drifting anchor', () => {
      const item: RecurringTransaction = {
        id: 'rec-rent',
        accountId: 'acc-1',
        categoryId: null,
        description: 'Renta',
        amount: 500000,
        frequency: 'monthly',
        startDate: '2026-01-31',
        nextDate: '2026-01-31',
        isActive: true,
      }
      const dates = projectRecurringOccurrences(item, '2026-01-31', '2026-04-05')
      expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
    })

    it('ignores inactive recurring items', () => {
      const item: RecurringTransaction = {
        id: 'rec-old',
        accountId: 'acc-1',
        categoryId: null,
        description: 'Gym',
        amount: 50000,
        frequency: 'monthly',
        startDate: '2026-01-01',
        nextDate: '2026-08-01',
        isActive: false,
      }
      expect(projectRecurringOccurrences(item, '2026-08-01', '2026-09-01')).toEqual([])
    })
  })

  describe('projectMSIOccurrences', () => {
    it('projects future installments up to remaining count', () => {
      const msi: MSIPurchase = {
        id: 'msi-laptop',
        accountId: 'acc-card',
        categoryId: null,
        description: 'Laptop',
        totalAmount: 1200000,
        installmentAmount: 100000,
        installmentCount: 12,
        installmentsPaid: 9,
        startDate: '2025-11-15',
        nextInstallmentDate: '2026-08-15',
        status: 'active',
      }
      const items = projectMSIOccurrences(msi, '2026-08-01', '2026-11-01')
      expect(items).toEqual([
        { date: '2026-08-15', installmentNumber: 10 },
        { date: '2026-09-15', installmentNumber: 11 },
        { date: '2026-10-15', installmentNumber: 12 },
      ])
    })

    it('returns empty for completed MSI', () => {
      const msi: MSIPurchase = {
        id: 'msi-done',
        accountId: 'acc-card',
        categoryId: null,
        description: 'Phone',
        totalAmount: 600000,
        installmentAmount: 100000,
        installmentCount: 6,
        installmentsPaid: 6,
        startDate: '2025-01-01',
        status: 'completed',
      }
      expect(projectMSIOccurrences(msi, '2026-08-01', '2026-09-01')).toEqual([])
    })
  })

  describe('computeCashFlowForecast', () => {
    const mockAccounts: Account[] = [
      {
        id: 'acc-checking',
        name: 'BBVA Nómina',
        type: 'debit',
        institution: 'BBVA',
        last4: '1234',
        currency: 'MXN',
        balance: 5000000, // $50,000 MXN
        isActive: true,
      },
      {
        id: 'acc-inactive',
        name: 'Cuenta Vieja',
        type: 'debit',
        institution: 'Santander',
        last4: '0000',
        currency: 'MXN',
        balance: 1000000, // $10,000 MXN (inactive, should be excluded)
        isActive: false,
      },
      {
        id: 'acc-credit',
        name: 'Tarjeta Banamex',
        type: 'credit',
        institution: 'Banamex',
        last4: '8890',
        currency: 'MXN',
        creditLimit: 8000000,
        availableCredit: 6000000,
        isActive: true,
      },
    ]

    const mockRecurring: RecurringTransaction[] = [
      {
        id: 'rec-rent',
        accountId: 'acc-checking',
        categoryId: null,
        description: 'Renta Depto',
        merchant: 'Inmobiliaria',
        amount: 1500000, // $15,000 MXN
        frequency: 'monthly',
        startDate: '2026-01-05',
        nextDate: '2026-08-05',
        isActive: true,
      },
      {
        id: 'rec-netflix',
        accountId: 'acc-credit',
        categoryId: null,
        description: 'Netflix',
        merchant: 'Netflix',
        amount: 24900, // $249 MXN
        frequency: 'monthly',
        startDate: '2026-01-10',
        nextDate: '2026-08-10',
        isActive: true,
      },
    ]

    const mockMSI: MSIPurchase[] = [
      {
        id: 'msi-fridge',
        accountId: 'acc-credit',
        categoryId: null,
        description: 'Refrigerador',
        merchant: 'Liverpool',
        totalAmount: 1800000,
        installmentAmount: 150000, // $1,500 MXN
        installmentCount: 12,
        installmentsPaid: 6,
        startDate: '2026-02-15',
        nextInstallmentDate: '2026-08-15',
        status: 'active',
      },
    ]

    it('computes starting liquid balance using only active debit accounts', () => {
      const forecast = computeCashFlowForecast({
        accounts: mockAccounts,
        recurringTransactions: [],
        msiPurchases: [],
        currentDate: '2026-08-01',
        horizonDays: 30,
      })

      expect(forecast.startingLiquidBalanceCents).toBe(5000000)
      expect(forecast.projectedScheduledBalanceCents).toBe(5000000)
      expect(forecast.isLiquidityRisk).toBe(false)
      expect(forecast.timeline).toHaveLength(31) // Day 0 to 30
    })

    it('projects scheduled recurring and MSI events chronologically with running balance', () => {
      const forecast = computeCashFlowForecast({
        accounts: mockAccounts,
        recurringTransactions: mockRecurring,
        msiPurchases: mockMSI,
        currentDate: '2026-08-01',
        horizonDays: 30,
      })

      // Events:
      // Aug 05: Renta ($15,000) -> 50,000 - 15,000 = 35,000
      // Aug 10: Netflix ($249) -> 35,000 - 249 = 34,751
      // Aug 15: Refrigerador ($1,500) -> 34,751 - 1,500 = 33,251
      expect(forecast.events).toHaveLength(3)
      expect(forecast.events[0]).toMatchObject({
        date: '2026-08-05',
        description: 'Renta Depto',
        amountCents: 1500000,
        projectedBalanceAfterCents: 3500000,
      })
      expect(forecast.events[1]).toMatchObject({
        date: '2026-08-10',
        description: 'Netflix',
        amountCents: 24900,
        projectedBalanceAfterCents: 3475100,
      })
      expect(forecast.events[2]).toMatchObject({
        date: '2026-08-15',
        description: 'Refrigerador (7/12)',
        amountCents: 150000,
        projectedBalanceAfterCents: 3325100,
      })

      expect(forecast.totalRecurringOutflowCents).toBe(1524900)
      expect(forecast.totalMSIOutflowCents).toBe(150000)
      expect(forecast.totalScheduledOutflowCents).toBe(1674900)
      expect(forecast.projectedScheduledBalanceCents).toBe(3325100)
      expect(forecast.minScheduledBalanceCents).toBe(3325100)
      expect(forecast.minScheduledDate).toBe('2026-08-15')
    })

    it('detects liquidity risk when projected balance drops below zero', () => {
      const tightAccounts: Account[] = [
        {
          id: 'acc-tight',
          name: 'Nómina',
          type: 'debit',
          institution: 'BBVA',
          last4: '1111',
          currency: 'MXN',
          balance: 1000000, // $10,000 MXN
          isActive: true,
        },
      ]

      const forecast = computeCashFlowForecast({
        accounts: tightAccounts,
        recurringTransactions: mockRecurring, // Renta is $15,000 -> drops to -$5,000
        msiPurchases: [],
        currentDate: '2026-08-01',
        horizonDays: 30,
      })

      expect(forecast.isLiquidityRisk).toBe(true)
      expect(forecast.minScheduledBalanceCents).toBe(-524900)
      expect(forecast.minScheduledDate).toBe('2026-08-10')
    })

    it('applies daily discretionary burn rate to realistic balance trajectory', () => {
      const forecast = computeCashFlowForecast({
        accounts: mockAccounts,
        recurringTransactions: [],
        msiPurchases: [],
        currentDate: '2026-08-01',
        horizonDays: 30,
        discretionaryDailyBurnRateCents: 50000, // $500/day
      })

      // 30 days * $500 = $15,000 burn
      expect(forecast.totalDiscretionaryBurnCents).toBe(1500000)
      expect(forecast.projectedScheduledBalanceCents).toBe(5000000)
      expect(forecast.projectedRealisticBalanceCents).toBe(3500000)
      expect(forecast.minRealisticBalanceCents).toBe(3500000)
      expect(forecast.minRealisticDate).toBe('2026-08-31')
    })
  })

  describe('expected yield', () => {
    it('adds daily savings yield to the projected balance', () => {
      const accounts: Account[] = [
        {
          id: 'savings',
          name: 'Ahorro',
          type: 'debit',
          institution: 'Nu',
          last4: '0001',
          currency: 'MXN',
          balance: 3_650_000,
          annualYieldTiers: [
            { upToCents: 2_500_000, annualYieldBps: 1500 },
            { upToCents: null, annualYieldBps: 700 },
          ],
          isActive: true,
        },
      ]
      const forecast = computeCashFlowForecast({
        accounts,
        recurringTransactions: [],
        msiPurchases: [],
        currentDate: '2026-08-01',
        horizonDays: 30,
      })
      const expectedYield = estimateYieldCents(3_650_000, null, 30, accounts[0].annualYieldTiers)
      expect(forecast.totalExpectedYieldCents).toBe(expectedYield)
      expect(forecast.projectedScheduledBalanceCents).toBe(3_650_000 + expectedYield)
      expect(forecast.minScheduledBalanceCents).toBe(3_650_000)

      const withoutYield = computeCashFlowForecast({
        accounts,
        recurringTransactions: [],
        msiPurchases: [],
        currentDate: '2026-08-01',
        horizonDays: 30,
        includeYield: false,
      })
      expect(withoutYield.totalExpectedYieldCents).toBe(0)
      expect(withoutYield.projectedScheduledBalanceCents).toBe(3_650_000)
    })
  })

  describe('sampleForecastTimeline', () => {
    it('samples timeline points down to target count including bounds', () => {
      const forecast = computeCashFlowForecast({
        accounts: [
          {
            id: 'a1',
            name: 'BBVA',
            type: 'debit',
            institution: 'BBVA',
            last4: '1',
            currency: 'MXN',
            balance: 1000,
            isActive: true,
          },
        ],
        recurringTransactions: [],
        msiPurchases: [],
        currentDate: '2026-08-01',
        horizonDays: 30,
      })

      expect(forecast.timeline).toHaveLength(31)
      const sampled = sampleForecastTimeline(forecast.timeline, 11)
      expect(sampled.length).toBeLessThanOrEqual(11)
      expect(sampled[0].date).toBe('2026-08-01')
      expect(sampled[sampled.length - 1].date).toBe('2026-08-31')
    })
  })
})
