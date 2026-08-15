import { describe, expect, it } from 'vitest'
import type { Transaction } from '@/types'
import { getCreditCardCycles, sumCycleTransactions } from './credit-card-cycle'

const transaction = (overrides: Partial<Transaction>): Transaction => ({
  id: 'tx-1',
  accountId: 'credit-1',
  type: 'expense',
  amount: 21_000,
  categoryId: null,
  date: '2026-07-20',
  description: 'Movimiento',
  affectsBalance: true,
  isReconciled: true,
  createdAt: '2026-07-20',
  ...overrides,
})

describe('getCreditCardCycles', () => {
  it('builds open and previous cycles after cut day', () => {
    expect(getCreditCardCycles(12, 28, '2026-07-22')).toEqual({
      open: {
        startDate: '2026-07-13',
        endDate: '2026-08-12',
        paymentDueDate: '2026-08-28',
      },
      previous: {
        startDate: '2026-06-13',
        endDate: '2026-07-12',
        paymentDueDate: '2026-07-28',
      },
    })
  })

  it('moves due date to next month when due day precedes cut day', () => {
    expect(getCreditCardCycles(28, 10, '2026-02-10').open).toEqual({
      startDate: '2026-01-29',
      endDate: '2026-02-28',
      paymentDueDate: '2026-03-10',
    })
  })

  it('clamps cycle days in short months', () => {
    expect(getCreditCardCycles(31, 5, '2026-04-30').open).toEqual({
      startDate: '2026-04-01',
      endDate: '2026-04-30',
      paymentDueDate: '2026-05-05',
    })
  })
})

describe('sumCycleTransactions', () => {
  it('subtracts unallocated card payments and ignores payments already applied to statements', () => {
    const transactions = [
      transaction({}),
      transaction({
        id: 'cash-advance',
        type: 'transfer',
        amount: 5_000,
        transferToAccountId: 'debit-1',
      }),
      transaction({ id: 'refund', type: 'income', amount: 1_000 }),
      transaction({
        id: 'card-payment',
        accountId: 'debit-1',
        type: 'transfer',
        amount: 6_000,
        transferToAccountId: 'credit-1',
      }),
      transaction({
        id: 'statement-payment',
        accountId: 'debit-1',
        type: 'transfer',
        amount: 3_000,
        transferToAccountId: 'credit-1',
        creditCardStatementId: 'statement-1',
      }),
    ]

    expect(
      sumCycleTransactions(transactions, 'credit-1', '2026-07-13', '2026-08-12', '2026-07-22'),
    ).toBe(19_000)
  })
})
