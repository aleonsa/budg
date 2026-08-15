import type { Cents, ISODate, Transaction } from '@/types'

export interface CreditCardCycle {
  startDate: ISODate
  endDate: ISODate
  paymentDueDate: ISODate
}

function fromISO(value: ISODate): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function toISO(value: Date): ISODate {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function dayInMonth(year: number, month: number, day: number): Date {
  const lastDay = new Date(year, month + 1, 0).getDate()
  return new Date(year, month, Math.min(day, lastDay))
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value)
  result.setDate(result.getDate() + days)
  return result
}

function dueDateAfter(cycleEnd: Date, paymentDueDay: number): Date {
  let due = dayInMonth(cycleEnd.getFullYear(), cycleEnd.getMonth(), paymentDueDay)
  if (due <= cycleEnd) {
    due = dayInMonth(cycleEnd.getFullYear(), cycleEnd.getMonth() + 1, paymentDueDay)
  }
  return due
}

export function getCreditCardCycles(
  statementCutDay: number,
  paymentDueDay: number,
  currentDate: ISODate,
): { open: CreditCardCycle; previous: CreditCardCycle } {
  const current = fromISO(currentDate)
  const cutThisMonth = dayInMonth(current.getFullYear(), current.getMonth(), statementCutDay)
  const openEnd =
    current <= cutThisMonth
      ? cutThisMonth
      : dayInMonth(current.getFullYear(), current.getMonth() + 1, statementCutDay)
  const previousEnd = dayInMonth(openEnd.getFullYear(), openEnd.getMonth() - 1, statementCutDay)
  const previousPreviousEnd = dayInMonth(
    previousEnd.getFullYear(),
    previousEnd.getMonth() - 1,
    statementCutDay,
  )

  return {
    open: {
      startDate: toISO(addDays(previousEnd, 1)),
      endDate: toISO(openEnd),
      paymentDueDate: toISO(dueDateAfter(openEnd, paymentDueDay)),
    },
    previous: {
      startDate: toISO(addDays(previousPreviousEnd, 1)),
      endDate: toISO(previousEnd),
      paymentDueDate: toISO(dueDateAfter(previousEnd, paymentDueDay)),
    },
  }
}

/**
 * Net amount a card accumulates over a cycle window: expenses and outgoing
 * transfers add, while refunds and unallocated incoming payments subtract.
 * Payments linked to a statement are excluded because its paid amount already
 * reduces the carried remainder. `upTo` prevents future-dated transactions
 * from inflating the running total.
 */
export function sumCycleTransactions(
  transactions: Transaction[],
  accountId: string,
  start: ISODate,
  end: ISODate,
  upTo?: ISODate,
): Cents {
  return transactions
    .filter(
      (tx) =>
        (tx.accountId === accountId ||
          (tx.type === 'transfer' && tx.transferToAccountId === accountId)) &&
        tx.date >= start &&
        tx.date <= end &&
        (upTo === undefined || tx.date <= upTo),
    )
    .reduce((total, tx) => {
      if (tx.type === 'expense') return total + tx.amount
      if (tx.type === 'income') return total - tx.amount
      if (tx.type === 'transfer') {
        if (tx.transferToAccountId === accountId) {
          return tx.creditCardStatementId ? total : total - tx.amount
        }
        return total + tx.amount
      }
      return total
    }, 0)
}

/** How far into the cycle we are (0–1) and how many days remain until the cut. */
export function cycleElapsed(
  cycle: CreditCardCycle,
  currentDate: ISODate,
): { ratio: number; daysLeft: number } {
  const start = fromISO(cycle.startDate).getTime()
  const end = fromISO(cycle.endDate).getTime()
  const now = fromISO(currentDate).getTime()
  const span = Math.max(1, end - start)
  const clamped = Math.min(Math.max(now, start), end)
  return {
    ratio: (clamped - start) / span,
    daysLeft: Math.max(0, Math.ceil((end - now) / 86_400_000)),
  }
}
