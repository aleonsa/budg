import type { Account, Cents, YieldReconciliation, YieldTier } from '@/types'

const DAY_MS = 86_400_000

function parseISO(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** Whole days from `from` to `to` (YYYY-MM-DD). Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseISO(to) - parseISO(from)) / DAY_MS)
}

/**
 * Yield earned on `balance` at an annual rate (basis points) compounded daily
 * for `days`. Mirrors store.EstimateYieldCents on the backend.
 */
export function estimateYieldCents(
  balance: Cents,
  annualYieldBps: number | null | undefined,
  days: number,
  tiers?: YieldTier[] | null,
): Cents {
  if (balance <= 0 || days <= 0) return 0
  if (tiers && tiers.length > 0) {
    let currentBalance = balance
    for (let day = 0; day < days; day += 1) {
      currentBalance += tieredDailyYield(currentBalance, tiers)
    }
    return Math.round(currentBalance - balance)
  }
  if (!annualYieldBps || annualYieldBps <= 0) return 0
  const rate = annualYieldBps / 10_000
  return Math.round(balance * (Math.pow(1 + rate / 365, days) - 1))
}

function tieredDailyYield(balance: number, tiers: YieldTier[]): number {
  let dailyYield = 0
  let previousCap = 0
  for (const tier of tiers) {
    const portion =
      tier.upToCents === null
        ? balance - previousCap
        : Math.min(balance, tier.upToCents) - previousCap
    if (portion <= 0) break
    dailyYield += (portion * tier.annualYieldBps) / 10_000 / 365
    if (tier.upToCents === null) break
    previousCap = tier.upToCents
  }
  return dailyYield
}

/** Balance-weighted configured rate across tiers (or the flat rate). */
export function blendedAnnualYieldBps(
  balance: Cents,
  annualYieldBps: number | null | undefined,
  tiers?: YieldTier[] | null,
): number | null {
  if (balance <= 0) return null
  if (!tiers || tiers.length === 0) return annualYieldBps ?? null
  let previousCap = 0
  let weighted = 0
  for (const tier of tiers) {
    const portion =
      tier.upToCents === null
        ? balance - previousCap
        : Math.min(balance, tier.upToCents) - previousCap
    if (portion <= 0) break
    weighted += portion * tier.annualYieldBps
    if (tier.upToCents === null) break
    previousCap = tier.upToCents
  }
  return Math.round(weighted / balance)
}

/** "15% hasta $25k · 7% después" for display. */
export function describeYieldTiers(
  annualYieldBps: number | null | undefined,
  tiers: YieldTier[] | null | undefined,
  currency: string,
): string | null {
  if (tiers && tiers.length > 0) {
    return tiers
      .map((tier, index) => {
        const rate = formatBps(tier.annualYieldBps)
        return tier.upToCents === null
          ? index === 0
            ? `${rate} sin límite`
            : `${rate} después`
          : `${rate} hasta ${new Intl.NumberFormat('es-MX', {
              style: 'currency',
              currency,
              maximumFractionDigits: 0,
            }).format(tier.upToCents / 100)}`
      })
      .join(' · ')
  }
  if (annualYieldBps != null && annualYieldBps > 0) return `${formatBps(annualYieldBps)} anual`
  return null
}

/** Date from which yield accrues: last reconciliation, else tracking start. */
export function accrualStart(account: Account): string | null {
  if (account.yieldReconciledOn) return account.yieldReconciledOn
  if (account.balanceTrackingStartedAt) return account.balanceTrackingStartedAt.slice(0, 10)
  return null
}

export interface AccountYieldEstimate {
  since: string | null
  days: number
  accrued: Cents
  monthly: Cents
}

export function estimateAccountYield(account: Account, today: string): AccountYieldEstimate {
  const balance = account.balance ?? 0
  const since = accrualStart(account)
  const days = since ? Math.max(0, daysBetween(since, today)) : 0
  return {
    since,
    days,
    accrued: estimateYieldCents(balance, account.annualYieldBps, days, account.annualYieldTiers),
    monthly: estimateYieldCents(balance, account.annualYieldBps, 30, account.annualYieldTiers),
  }
}

/**
 * Annualized realized rate (basis points) over reconciliations within the
 * last year: total yield divided by balance-days, times 365.
 */
export function effectiveAnnualRateBps(
  reconciliations: YieldReconciliation[],
  today: string,
): number | null {
  const [year, month, day] = today.split('-')
  const cutoff = `${Number(year) - 1}-${month}-${day}`
  let balanceDays = 0
  let earned = 0
  for (const rec of reconciliations) {
    if (rec.date < cutoff) continue
    const days = daysBetween(rec.periodStart, rec.date)
    if (days <= 0 || rec.balanceBefore <= 0) continue
    balanceDays += rec.balanceBefore * days
    earned += rec.yield
  }
  if (balanceDays <= 0) return null
  return Math.round((earned / balanceDays) * 365 * 10_000)
}

export function sumYield(reconciliations: YieldReconciliation[], from: string, to: string): Cents {
  return reconciliations
    .filter((rec) => rec.date >= from && rec.date <= to)
    .reduce((sum, rec) => sum + rec.yield, 0)
}

/** "12.5%" from basis points. */
export function formatBps(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return '—'
  return `${(bps / 100).toLocaleString('es-MX', { maximumFractionDigits: 2 })}%`
}

/** Suggested split of a balance difference into yield and adjustment. */
export function suggestYieldSplit(
  difference: Cents,
  estimate: Cents,
): {
  yieldAmount: Cents
  suspicious: boolean
} {
  if (difference <= 0) return { yieldAmount: 0, suspicious: difference < 0 }
  const tolerance = Math.max(estimate * 2, estimate + 5_000)
  if (estimate > 0 && difference > tolerance) {
    return { yieldAmount: Math.min(estimate, difference), suspicious: true }
  }
  return { yieldAmount: difference, suspicious: false }
}
