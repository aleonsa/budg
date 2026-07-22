import type { ISODate } from '@/types'

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
