import { describe, expect, it } from 'vitest'
import { netWorthTimeline } from './net-worth-timeline'
import type { Account, Transaction } from '@/types'

const debit = (id: string, balance: number, extra: Partial<Account> = {}): Account => ({
  id,
  name: id,
  type: 'debit',
  institution: 'x',
  last4: '0000',
  currency: 'MXN',
  balance,
  isActive: true,
  ...extra,
})

const credit = (id: string, limit: number, available: number): Account => ({
  id,
  name: id,
  type: 'credit',
  institution: 'x',
  last4: '0000',
  currency: 'MXN',
  creditLimit: limit,
  availableCredit: available,
  isActive: true,
})

const tx = (
  id: string,
  accountId: string,
  type: Transaction['type'],
  amount: number,
  date: string,
  extra: Partial<Transaction> = {},
): Transaction => ({
  id,
  accountId,
  type,
  amount,
  categoryId: null,
  date,
  description: id,
  isReconciled: false,
  createdAt: date,
  ...extra,
})

describe('netWorthTimeline', () => {
  it('reconstructs debit balances by reversing newer transactions', () => {
    const accounts = [debit('nómina', 1_000)]
    const transactions = [
      tx('e1', 'nómina', 'expense', 300, '2026-07-10'),
      tx('e2', 'nómina', 'expense', 200, '2026-06-15'),
      tx('i1', 'nómina', 'income', 500, '2026-06-01'),
    ]

    const points = netWorthTimeline(accounts, transactions, [
      '2026-06-01',
      '2026-06-30',
      '2026-07-31',
    ])

    // End-of-day semantics: the 06-01 snapshot includes that day's income.
    // current 1000 = start + 500 − 200 − 300 → start = 1000.
    expect(points).toEqual([
      { date: '2026-06-01', assets: 1500, debt: 0, net: 1500 },
      { date: '2026-06-30', assets: 1300, debt: 0, net: 1300 },
      { date: '2026-07-31', assets: 1000, debt: 0, net: 1000 },
    ])
  })

  it('tracks credit debt growth from expenses and payments', () => {
    const accounts = [credit('card', 10_000, 6_000)] // current debt 4000
    const transactions = [
      tx('buy', 'card', 'expense', 1_500, '2026-07-05'),
      tx('pay', 'bank', 'transfer', 1_000, '2026-07-10', { transferToAccountId: 'card' }),
    ]

    const points = netWorthTimeline(accounts, transactions, ['2026-07-01', '2026-07-31'])

    // Before both: debt = 4000 − 1500 + 1000 = 3500.
    expect(points[0]).toEqual({ date: '2026-07-01', assets: 0, debt: 3500, net: -3500 })
    expect(points[1]).toEqual({ date: '2026-07-31', assets: 0, debt: 4000, net: -4000 })
  })

  it('moves money across transfer legs without leaking net worth', () => {
    const accounts = [debit('a', 800), debit('b', 200)]
    const transactions = [
      tx('t1', 'a', 'transfer', 200, '2026-07-08', { transferToAccountId: 'b' }),
    ]

    const points = netWorthTimeline(accounts, transactions, ['2026-07-01', '2026-07-31'])

    expect(points[0]).toEqual({ date: '2026-07-01', assets: 1000, debt: 0, net: 1000 })
    expect(points[1]).toEqual({ date: '2026-07-31', assets: 1000, debt: 0, net: 1000 })
  })

  it('ignores transactions flagged as not affecting the balance', () => {
    const accounts = [debit('a', 500)]
    const transactions = [tx('x', 'a', 'expense', 999, '2026-07-05', { affectsBalance: false })]

    const points = netWorthTimeline(accounts, transactions, ['2026-07-01', '2026-07-31'])
    expect(points.map((p) => p.assets)).toEqual([500, 500])
  })

  it('excludes inactive accounts and pre-tracking snapshots', () => {
    const accounts = [
      debit('old', 9_999, { isActive: false }),
      debit('new', 1_000, { balanceTrackingStartedAt: '2026-06-15' }),
    ]
    const transactions = [tx('e', 'new', 'expense', 100, '2026-07-01')]

    const points = netWorthTimeline(accounts, transactions, [
      '2026-06-01',
      '2026-06-30',
      '2026-07-31',
    ])

    // 'new' started tracking 06-15 with balance 1100 (current 1000 + 100 spent
    // on 07-01); before its tracking start it is excluded entirely.
    expect(points.map((p) => p.assets)).toEqual([0, 1100, 1000])
  })

  it('clamps negative credit values to zero debt', () => {
    const accounts = [credit('card', 10_000, 11_000)] // overpaid card
    const points = netWorthTimeline(accounts, [], ['2026-07-31'])
    expect(points[0].debt).toBe(0)
  })
})
