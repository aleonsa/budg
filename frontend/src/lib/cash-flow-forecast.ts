import type { Account, Cents, MSIPurchase, RecurringTransaction } from '@/types'

export interface ForecastParams {
  accounts: Account[]
  recurringTransactions: RecurringTransaction[]
  msiPurchases: MSIPurchase[]
  currentDate: string // YYYY-MM-DD
  horizonDays: 30 | 60 | 90
  discretionaryDailyBurnRateCents?: number
}

export interface ScheduledForecastEvent {
  id: string
  date: string
  type: 'recurring' | 'msi'
  description: string
  merchant: string | null
  amountCents: Cents
  accountId: string
  accountName: string
  projectedBalanceAfterCents: Cents
}

export interface ForecastTimelinePoint {
  date: string
  label: string
  scheduledBalanceCents: Cents
  discretionaryBalanceCents: Cents
}

export interface CashFlowForecast {
  currentDate: string
  horizonDays: number
  startingLiquidBalanceCents: Cents
  projectedScheduledBalanceCents: Cents
  projectedRealisticBalanceCents: Cents
  minScheduledBalanceCents: Cents
  minScheduledDate: string
  minRealisticBalanceCents: Cents
  minRealisticDate: string
  isLiquidityRisk: boolean
  totalRecurringOutflowCents: Cents
  totalMSIOutflowCents: Cents
  totalScheduledOutflowCents: Cents
  totalDiscretionaryBurnCents: Cents
  events: ScheduledForecastEvent[]
  timeline: ForecastTimelinePoint[]
}

/** Days in month for UTC dates. */
function daysInMonth(year: number, monthZeroIndexed: number): number {
  return new Date(Date.UTC(year, monthZeroIndexed + 1, 0)).getUTCDate()
}

/** Parse an ISO date YYYY-MM-DD to [year, monthZeroIndexed, day]. */
function parseISODateParts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number)
  return [y, m - 1, d]
}

/** Format year, month (0-indexed), day as YYYY-MM-DD. */
function formatISODateParts(year: number, monthZeroIndexed: number, day: number): string {
  const y = String(year).padStart(4, '0')
  const m = String(monthZeroIndexed + 1).padStart(2, '0')
  const d = String(day).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Add whole days to an ISO date. */
export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = parseISODateParts(iso)
  const date = new Date(Date.UTC(y, m, d + days))
  return formatISODateParts(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

/** Add whole months clamped to anchor day of month. */
function addMonthsClamped(
  baseYear: number,
  baseMonthZero: number,
  anchorDay: number,
  monthsToAdd: number,
): string {
  const totalMonths = baseMonthZero + monthsToAdd
  const targetYear = baseYear + Math.floor(totalMonths / 12)
  const targetMonth = ((totalMonths % 12) + 12) % 12
  const maxDay = daysInMonth(targetYear, targetMonth)
  const targetDay = Math.min(anchorDay, maxDay)
  return formatISODateParts(targetYear, targetMonth, targetDay)
}

/** Project occurrence dates of a recurring transaction within [fromDate, toDate]. */
export function projectRecurringOccurrences(
  item: RecurringTransaction,
  fromDate: string,
  toDate: string,
): string[] {
  if (!item.isActive || item.amount <= 0) return []

  const [startYear, startMonth, anchorDay] = parseISODateParts(item.startDate)
  const occurrences: string[] = []

  let cursor = item.nextDate || item.startDate
  if (cursor < fromDate) {
    // Fast-forward cursor to first occurrence on or after fromDate
    const intervalMonths = item.frequency === 'yearly' ? 12 : 1
    let k = 0
    while (cursor < fromDate && k < 1200) {
      k++
      cursor = addMonthsClamped(startYear, startMonth, anchorDay, k * intervalMonths)
    }
  }

  const intervalMonths = item.frequency === 'yearly' ? 12 : 1
  let guard = 0
  while (cursor <= toDate && guard < 120) {
    if (cursor >= fromDate) {
      occurrences.push(cursor)
    }
    const [cYear, cMonth] = parseISODateParts(cursor)
    cursor = addMonthsClamped(cYear, cMonth, anchorDay, intervalMonths)
    guard++
  }

  return occurrences
}

/** Project installments of an active MSI purchase within [fromDate, toDate]. */
export function projectMSIOccurrences(
  purchase: MSIPurchase,
  fromDate: string,
  toDate: string,
): Array<{ date: string; installmentNumber: number }> {
  if (purchase.status !== 'active') return []
  const remainingCount = purchase.installmentCount - purchase.installmentsPaid
  if (remainingCount <= 0) return []

  const anchorDay = parseISODateParts(purchase.startDate)[2]
  const baseDate = purchase.nextInstallmentDate || purchase.startDate
  const [baseYear, baseMonth] = parseISODateParts(baseDate)

  const items: Array<{ date: string; installmentNumber: number }> = []
  for (let i = 0; i < remainingCount; i++) {
    const installmentDate = addMonthsClamped(baseYear, baseMonth, anchorDay, i)
    if (installmentDate >= fromDate && installmentDate <= toDate) {
      items.push({
        date: installmentDate,
        installmentNumber: purchase.installmentsPaid + i + 1,
      })
    }
  }
  return items
}

/** Format date as short Spanish label: "05 oct". */
function formatShortDateLabel(iso: string): string {
  const [y, m, d] = parseISODateParts(iso)
  return new Date(Date.UTC(y, m, d)).toLocaleDateString('es-MX', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
  })
}

/**
 * Computes deterministic cash flow forecast over 30, 60, or 90 days.
 */
export function computeCashFlowForecast({
  accounts,
  recurringTransactions,
  msiPurchases,
  currentDate,
  horizonDays,
  discretionaryDailyBurnRateCents = 0,
}: ForecastParams): CashFlowForecast {
  const accountMap = new Map(accounts.map((a) => [a.id, a.name]))

  // Starting liquid cash: active debit accounts in MXN
  const startingLiquidBalanceCents = accounts
    .filter((a) => a.isActive && a.type === 'debit')
    .reduce(
      (sum, a) =>
        sum + (a.balance ?? (a as unknown as { balanceCents?: number }).balanceCents ?? 0),
      0,
    )

  const endDate = addDaysISO(currentDate, horizonDays)

  // 1. Gather all raw events
  interface RawEvent {
    date: string
    type: 'recurring' | 'msi'
    description: string
    merchant: string | null
    amountCents: Cents
    accountId: string
  }
  const rawEvents: RawEvent[] = []

  let totalRecurringOutflowCents = 0
  for (const rec of recurringTransactions) {
    if (!rec.isActive) continue
    const dates = projectRecurringOccurrences(rec, currentDate, endDate)
    for (const d of dates) {
      rawEvents.push({
        date: d,
        type: 'recurring',
        description: rec.description,
        merchant: rec.merchant ?? null,
        amountCents: rec.amount,
        accountId: rec.accountId,
      })
      totalRecurringOutflowCents += rec.amount
    }
  }

  let totalMSIOutflowCents = 0
  for (const msi of msiPurchases) {
    if (msi.status !== 'active') continue
    const installments = projectMSIOccurrences(msi, currentDate, endDate)
    for (const inst of installments) {
      const desc = `${msi.description} (${inst.installmentNumber}/${msi.installmentCount})`
      rawEvents.push({
        date: inst.date,
        type: 'msi',
        description: desc,
        merchant: msi.merchant ?? null,
        amountCents: msi.installmentAmount,
        accountId: msi.accountId,
      })
      totalMSIOutflowCents += msi.installmentAmount
    }
  }

  // Sort events chronologically
  rawEvents.sort((a, b) => a.date.localeCompare(b.date))

  // 2. Build daily schedule and timeline points
  const dailyOutflow = new Map<string, number>()
  for (const ev of rawEvents) {
    dailyOutflow.set(ev.date, (dailyOutflow.get(ev.date) ?? 0) + ev.amountCents)
  }

  const timeline: ForecastTimelinePoint[] = []
  let scheduledBalance = startingLiquidBalanceCents
  let realisticBalance = startingLiquidBalanceCents

  let minScheduledBalanceCents = startingLiquidBalanceCents
  let minScheduledDate = currentDate
  let minRealisticBalanceCents = startingLiquidBalanceCents
  let minRealisticDate = currentDate

  const normalizedBurnRate = Math.max(0, discretionaryDailyBurnRateCents)

  for (let day = 0; day <= horizonDays; day++) {
    const date = addDaysISO(currentDate, day)
    const outflow = dailyOutflow.get(date) ?? 0

    scheduledBalance -= outflow
    realisticBalance -= outflow
    if (day > 0) {
      realisticBalance -= normalizedBurnRate
    }

    if (scheduledBalance < minScheduledBalanceCents) {
      minScheduledBalanceCents = scheduledBalance
      minScheduledDate = date
    }
    if (realisticBalance < minRealisticBalanceCents) {
      minRealisticBalanceCents = realisticBalance
      minRealisticDate = date
    }

    timeline.push({
      date,
      label: formatShortDateLabel(date),
      scheduledBalanceCents: scheduledBalance,
      discretionaryBalanceCents: realisticBalance,
    })
  }

  // 3. Attach balance after each event
  let runningBalance = startingLiquidBalanceCents
  const events: ScheduledForecastEvent[] = []
  let eventIdx = 0
  for (const ev of rawEvents) {
    runningBalance -= ev.amountCents
    events.push({
      id: `forecast-event-${eventIdx++}`,
      date: ev.date,
      type: ev.type,
      description: ev.description,
      merchant: ev.merchant,
      amountCents: ev.amountCents,
      accountId: ev.accountId,
      accountName: accountMap.get(ev.accountId) ?? 'Cuenta',
      projectedBalanceAfterCents: runningBalance,
    })
  }

  const totalScheduledOutflowCents = totalRecurringOutflowCents + totalMSIOutflowCents
  const totalDiscretionaryBurnCents = normalizedBurnRate * horizonDays

  return {
    currentDate,
    horizonDays,
    startingLiquidBalanceCents,
    projectedScheduledBalanceCents: scheduledBalance,
    projectedRealisticBalanceCents: realisticBalance,
    minScheduledBalanceCents,
    minScheduledDate,
    minRealisticBalanceCents,
    minRealisticDate,
    isLiquidityRisk: minScheduledBalanceCents < 0 || minRealisticBalanceCents < 0,
    totalRecurringOutflowCents,
    totalMSIOutflowCents,
    totalScheduledOutflowCents,
    totalDiscretionaryBurnCents,
    events,
    timeline,
  }
}

/** Sample timeline points evenly so SVG charts render readable labels without crowding. */
export function sampleForecastTimeline(
  timeline: ForecastTimelinePoint[],
  maxPoints = 11,
): ForecastTimelinePoint[] {
  if (timeline.length <= maxPoints) return timeline
  const result: ForecastTimelinePoint[] = []
  const step = (timeline.length - 1) / (maxPoints - 1)
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.min(Math.round(i * step), timeline.length - 1)
    const point = timeline[idx]
    if (!result.some((p) => p.date === point.date)) {
      result.push(point)
    }
  }
  return result
}
