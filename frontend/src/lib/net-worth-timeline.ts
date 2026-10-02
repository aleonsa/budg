import type { Account, Cents, ISODate, Transaction } from '@/types'

/**
 * Historical net-worth reconstruction.
 *
 * Accounts store only their *current* balance (debit) or available credit
 * (credit). Historical values are derived by walking every transaction newer
 * than the snapshot date and removing its contribution from the current
 * value — a "reverse ledger" from today backwards.
 *
 * Contribution of a transaction to an account's value (balance for debit,
 * debt for credit), from the "money in" perspective:
 *
 *   debit:  money in  → balance +amount, money out → balance −amount
 *   credit: money in  → debt   −amount, money out → debt   +amount
 *
 * So the account's direction factor is +1 for debit and −1 for credit,
 * applied to the signed money flow.
 */

export interface NetWorthPoint {
  date: ISODate
  assets: Cents
  debt: Cents
  net: Cents
}

interface AccountFlows {
  direction: 1 | -1
  /** Signed money flows that shaped the account's current value, newest first. */
  flows: Array<{ date: ISODate; amount: number }>
}

function buildAccountFlows(accounts: Account[], transactions: Transaction[]): AccountFlows[] {
  const byAccount = new Map<string, Array<{ date: ISODate; amount: number }>>()
  const push = (accountId: string, date: ISODate, amount: number) => {
    if (amount === 0) return
    const list = byAccount.get(accountId) ?? []
    list.push({ date, amount })
    byAccount.set(accountId, list)
  }

  for (const t of transactions) {
    if (t.affectsBalance === false) continue
    // Money out of the source account (expense, transfer leg).
    if (t.type === 'expense') push(t.accountId, t.date, -t.amount)
    if (t.type === 'income') push(t.accountId, t.date, t.amount)
    if (t.type === 'transfer') {
      push(t.accountId, t.date, -t.amount)
      if (t.transferToAccountId) push(t.transferToAccountId, t.date, t.amount)
    }
  }

  return accounts.map((account) => ({
    direction: account.type === 'debit' ? (1 as const) : (-1 as const),
    flows: (byAccount.get(account.id) ?? []).sort((a, b) => b.date.localeCompare(a.date)),
  }))
}

/** Current stored value: balance for debit, debt for credit. */
function currentValue(account: Account): Cents {
  if (account.type === 'debit') return account.balance ?? 0
  return (account.creditLimit ?? 0) - (account.availableCredit ?? 0)
}

function valueAt(account: Account, flows: AccountFlows, date: ISODate): Cents {
  // Remove the contribution of every flow newer than `date`.
  const current = currentValue(account)
  let correction = 0
  for (const flow of flows.flows) {
    if (flow.date <= date) break
    correction += flow.amount * flows.direction
  }
  return current - correction
}

/**
 * Reconstruct assets, debt, and net worth at each snapshot date.
 *
 * A snapshot is only as good as the transaction history: an account whose
 * `balanceTrackingStartedAt` is newer than the snapshot date is excluded
 * from that snapshot (its earlier balance is unknowable), and inactive
 * accounts are always excluded.
 */
export function netWorthTimeline(
  accounts: Account[],
  transactions: Transaction[],
  dates: ISODate[],
): NetWorthPoint[] {
  const active = accounts.filter((a) => a.isActive)
  const flowsByAccount = new Map<string, AccountFlows>()
  const wrapped = buildAccountFlows(active, transactions)
  for (let i = 0; i < active.length; i++) flowsByAccount.set(active[i].id, wrapped[i])

  return dates.map((date) => {
    let assets = 0
    let debt = 0
    for (const account of active) {
      if (account.balanceTrackingStartedAt && account.balanceTrackingStartedAt > date) continue
      const flows = flowsByAccount.get(account.id)
      if (!flows) continue
      const value = valueAt(account, flows, date)
      if (account.type === 'debit') assets += value
      else debt += Math.max(value, 0)
    }
    return { date, assets, debt, net: assets - debt }
  })
}
