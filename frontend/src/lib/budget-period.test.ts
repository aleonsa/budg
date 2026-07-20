import { describe, expect, it } from 'vitest'
import type { Budget, Transaction } from '@/types'
import {
  deriveBudgetProgressForDate,
  getBudgetCycle,
  selectApplicableBudgets,
} from './budget-period'

const budget = (overrides: Partial<Budget> = {}): Budget => ({
  id: 'budget',
  categoryId: 'food',
  amount: 10_000,
  period: 'monthly',
  startDate: '2026-01-15',
  ...overrides,
})

const transaction = (
  id: string,
  date: string,
  amount: number,
  categoryId: string | null = 'food',
  type: Transaction['type'] = 'expense',
): Transaction => ({
  id,
  accountId: 'account',
  type,
  amount,
  categoryId,
  date,
  description: id,
  isReconciled: false,
  createdAt: date,
})

describe('getBudgetCycle', () => {
  it('uses exact seven-day cycles anchored by start date with inclusive boundaries', () => {
    const weekly = budget({ period: 'weekly', startDate: '2026-07-01' })

    expect(getBudgetCycle(weekly, '2026-07-01')).toEqual({
      start: '2026-07-01',
      end: '2026-07-07',
    })
    expect(getBudgetCycle(weekly, '2026-07-14')).toEqual({
      start: '2026-07-08',
      end: '2026-07-14',
    })
    expect(getBudgetCycle(weekly, '2026-07-15')).toEqual({
      start: '2026-07-15',
      end: '2026-07-21',
    })
  })

  it('clamps month-end anchors and restores the anchor day when available', () => {
    const monthly = budget({ period: 'monthly', startDate: '2026-01-31' })

    expect(getBudgetCycle(monthly, '2026-02-27')).toEqual({
      start: '2026-01-31',
      end: '2026-02-27',
    })
    expect(getBudgetCycle(monthly, '2026-02-28')).toEqual({
      start: '2026-02-28',
      end: '2026-03-30',
    })
    expect(getBudgetCycle(monthly, '2026-03-31')).toEqual({
      start: '2026-03-31',
      end: '2026-04-29',
    })
  })

  it('clamps leap-day yearly anchors and restores leap day in leap years', () => {
    const yearly = budget({ period: 'yearly', startDate: '2024-02-29' })

    expect(getBudgetCycle(yearly, '2025-02-27')).toEqual({
      start: '2024-02-29',
      end: '2025-02-27',
    })
    expect(getBudgetCycle(yearly, '2025-02-28')).toEqual({
      start: '2025-02-28',
      end: '2026-02-27',
    })
    expect(getBudgetCycle(yearly, '2028-02-29')).toEqual({
      start: '2028-02-29',
      end: '2029-02-27',
    })
  })

  it('returns null before the anchor date', () => {
    expect(getBudgetCycle(budget({ startDate: '2026-07-21' }), '2026-07-20')).toBeNull()
  })
})

describe('deriveBudgetProgressForDate', () => {
  it('caps spending at asOf within the selected cycle', () => {
    const weekly = budget({ period: 'weekly', startDate: '2026-07-15' })
    const [progress] = deriveBudgetProgressForDate(
      [weekly],
      [
        transaction('pre-start', '2026-07-14', 10_000),
        transaction('cycle-start', '2026-07-15', 1_000),
        transaction('as-of', '2026-07-20', 500),
        transaction('future-in-cycle', '2026-07-21', 2_000),
        transaction('next-cycle', '2026-07-22', 10_000),
        transaction('income', '2026-07-20', 10_000, 'food', 'income'),
        transaction('transfer', '2026-07-20', 10_000, 'food', 'transfer'),
      ],
      '2026-07-20',
    )

    expect(progress).toMatchObject({ spent: 1_500, remaining: 8_500, progress: 0.15 })
  })

  it('includes cycle-end spending when cycle end is asOf', () => {
    const [progress] = deriveBudgetProgressForDate(
      [budget({ period: 'weekly', startDate: '2026-07-15' })],
      [
        transaction('cycle-end', '2026-07-21', 2_000),
        transaction('next-cycle', '2026-07-22', 8_000),
      ],
      '2026-07-21',
    )

    expect(progress).toMatchObject({ spent: 2_000, remaining: 8_000, progress: 0.2 })
  })

  it('filters categorized budgets while global budgets cover all expense categories', () => {
    const progress = deriveBudgetProgressForDate(
      [budget({ id: 'food' }), budget({ id: 'global', categoryId: null, amount: 20_000 })],
      [
        transaction('food', '2026-07-15', 2_000),
        transaction('rent', '2026-07-15', 3_000, 'rent'),
        transaction('uncategorized', '2026-07-15', 4_000, null),
      ],
      '2026-07-20',
    )

    expect(progress[0]).toMatchObject({ spent: 2_000, remaining: 8_000, progress: 0.2 })
    expect(progress[1]).toMatchObject({ spent: 9_000, remaining: 11_000, progress: 0.45 })
  })

  it('keeps future budgets inactive and defines zero-limit progress as zero', () => {
    const progress = deriveBudgetProgressForDate(
      [
        budget({ id: 'future', startDate: '2026-07-21' }),
        budget({ id: 'zero', amount: 0, startDate: '2026-07-01' }),
      ],
      [transaction('expense', '2026-07-20', 2_000)],
      '2026-07-20',
    )

    expect(progress[0]).toMatchObject({ spent: 0, remaining: 10_000, progress: 0 })
    expect(progress[1]).toMatchObject({ spent: 2_000, remaining: -2_000, progress: 0 })
  })
})

describe('selectApplicableBudgets', () => {
  it('uses the latest active global budget as the sole aggregate scope', () => {
    const selected = selectApplicableBudgets(
      [
        budget({ id: 'old-global', categoryId: null, startDate: '2026-07-01' }),
        budget({ id: 'food', categoryId: 'food', startDate: '2026-07-10' }),
        budget({ id: 'latest-global', categoryId: null, startDate: '2026-07-15' }),
        budget({ id: 'future-global', categoryId: null, startDate: '2026-07-21' }),
      ],
      '2026-07-20',
    )

    expect(selected.map((item) => item.id)).toEqual(['latest-global'])
  })

  it('uses one latest active budget per concrete category with deterministic ties', () => {
    const selected = selectApplicableBudgets(
      [
        budget({ id: 'food-old', categoryId: 'food', startDate: '2026-07-01' }),
        budget({ id: 'food-latest-a', categoryId: 'food', startDate: '2026-07-10' }),
        budget({ id: 'rent', categoryId: 'rent', startDate: '2026-07-05' }),
        budget({ id: 'food-latest-z', categoryId: 'food', startDate: '2026-07-10' }),
        budget({ id: 'future-rent', categoryId: 'rent', startDate: '2026-07-21' }),
      ],
      '2026-07-20',
    )

    expect(selected.map((item) => item.id)).toEqual(['food-latest-z', 'rent'])
  })
})
