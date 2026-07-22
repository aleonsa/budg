import { describe, expect, it } from 'vitest'
import { getCreditCardCycles } from './credit-card-cycle'

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
