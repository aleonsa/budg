import type { Budget, BudgetPeriod, BudgetWithProgress, ISODate, Transaction } from '@/types'

const DAY_MS = 24 * 60 * 60 * 1000

export interface BudgetCycle {
  start: ISODate
  end: ISODate
}

function parseISODate(value: ISODate): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function toISODate(value: Date): ISODate {
  return value.toISOString().slice(0, 10)
}

function addPeriods(anchor: Date, period: BudgetPeriod, count: number): Date {
  if (period === 'weekly') {
    return new Date(anchor.getTime() + count * 7 * DAY_MS)
  }

  const anchorYear = anchor.getUTCFullYear()
  const anchorMonth = anchor.getUTCMonth()
  const anchorDay = anchor.getUTCDate()
  const targetMonthIndex =
    period === 'monthly'
      ? anchorYear * 12 + anchorMonth + count
      : (anchorYear + count) * 12 + anchorMonth
  const targetYear = Math.floor(targetMonthIndex / 12)
  const targetMonth = targetMonthIndex % 12
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()

  return new Date(Date.UTC(targetYear, targetMonth, Math.min(anchorDay, lastDay)))
}

/** Return the recurring budget cycle containing asOf, with inclusive ISO-date boundaries. */
export function getBudgetCycle(
  budget: Pick<Budget, 'period' | 'startDate'>,
  asOf: ISODate,
): BudgetCycle | null {
  if (asOf < budget.startDate) return null

  const anchor = parseISODate(budget.startDate)
  const reference = parseISODate(asOf)
  let cycleCount: number

  if (budget.period === 'weekly') {
    cycleCount = Math.floor((reference.getTime() - anchor.getTime()) / (7 * DAY_MS))
  } else if (budget.period === 'monthly') {
    cycleCount =
      (reference.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
      reference.getUTCMonth() -
      anchor.getUTCMonth()
  } else {
    cycleCount = reference.getUTCFullYear() - anchor.getUTCFullYear()
  }

  if (addPeriods(anchor, budget.period, cycleCount) > reference) cycleCount -= 1

  const start = addPeriods(anchor, budget.period, cycleCount)
  const nextStart = addPeriods(anchor, budget.period, cycleCount + 1)
  const end = new Date(nextStart.getTime() - DAY_MS)

  return { start: toISODate(start), end: toISODate(end) }
}

export function deriveBudgetProgressForDate(
  budgets: Budget[],
  transactions: Transaction[],
  asOf: ISODate,
): BudgetWithProgress[] {
  return budgets.map((budget) => {
    const cycle = getBudgetCycle(budget, asOf)
    const spent = transactions
      .filter(
        (transaction) =>
          cycle !== null &&
          transaction.type === 'expense' &&
          transaction.date >= cycle.start &&
          transaction.date <= cycle.end &&
          transaction.date <= asOf &&
          (budget.categoryId === null || transaction.categoryId === budget.categoryId),
      )
      .reduce((sum, transaction) => sum + transaction.amount, 0)
    const remaining = budget.amount - spent
    const progress = budget.amount > 0 ? spent / budget.amount : 0

    return { ...budget, spent, remaining, progress }
  })
}

function isLaterBudget(candidate: Budget, current: Budget): boolean {
  // Budget IDs break equal-start ties so API ordering cannot change aggregate totals.
  return (
    candidate.startDate > current.startDate ||
    (candidate.startDate === current.startDate && candidate.id > current.id)
  )
}

export function selectApplicableBudgets<T extends Budget>(budgets: T[], asOf: ISODate): T[] {
  let globalBudget: T | undefined
  const categoryBudgets = new Map<string, T>()

  for (const budget of budgets) {
    if (getBudgetCycle(budget, asOf) === null) continue

    if (budget.categoryId === null) {
      if (!globalBudget || isLaterBudget(budget, globalBudget)) globalBudget = budget
      continue
    }

    const current = categoryBudgets.get(budget.categoryId)
    if (!current || isLaterBudget(budget, current)) {
      categoryBudgets.set(budget.categoryId, budget)
    }
  }

  if (globalBudget) return [globalBudget]

  return [...categoryBudgets.entries()]
    .sort(([categoryA], [categoryB]) =>
      categoryA < categoryB ? -1 : categoryA > categoryB ? 1 : 0,
    )
    .map(([, budget]) => budget)
}
