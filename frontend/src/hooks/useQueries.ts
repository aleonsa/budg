import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { deriveBudgetProgressForDate } from '@/lib/budget-period'
import { today } from '@/lib/date'
import { queryKeys } from '@/lib/query-keys'
import type {
  AccountWithSummary,
  BudgetWithProgress,
  Category,
  SavingsGoalWithProgress,
  Transaction,
} from '@/types'
import type { Account, Budget, MSIPurchase, SavingsGoal, Cents } from '@/types'

// ── Raw data hooks ──────────────────────────────────────────

export function useCategories() {
  return useQuery({ queryKey: queryKeys.categories, queryFn: api.getCategories })
}

export function useAccounts() {
  return useQuery({ queryKey: queryKeys.accounts, queryFn: api.getAccounts })
}

export function useTransactions() {
  return useQuery({ queryKey: queryKeys.transactions, queryFn: api.getTransactions })
}

export function useMSIPurchases() {
  return useQuery({ queryKey: queryKeys.msiPurchases, queryFn: api.getMSIPurchases })
}

export function useRecurringTransactions() {
  return useQuery({
    queryKey: queryKeys.recurringTransactions,
    queryFn: api.getRecurringTransactions,
  })
}

export function useSavingsGoals() {
  return useQuery({ queryKey: queryKeys.savingsGoals, queryFn: api.getSavingsGoals })
}

export function useBudgets() {
  return useQuery({ queryKey: queryKeys.budgets, queryFn: api.getBudgets })
}

export function useRules() {
  return useQuery({ queryKey: queryKeys.rules, queryFn: api.getRules })
}

// ── Derived helpers ─────────────────────────────────────────

function toLocalISO(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Compute account summaries including balances and MSI info. */
export function deriveAccountSummary(
  accounts: Account[],
  msiPurchases: MSIPurchase[],
): AccountWithSummary[] {
  return accounts.map((acc) => {
    if (acc.type === 'debit') {
      // Actual balance from mock data
      const balance = acc.balance ?? 0
      return { ...acc, balanceOrDebt: balance }
    }

    // Credit: debt = limit - available
    const debt = (acc.creditLimit ?? 0) - (acc.availableCredit ?? 0)
    const activeMSI = msiPurchases.filter((m) => m.accountId === acc.id && m.status === 'active')
    const utilizationRate = acc.creditLimit ? (acc.availableCredit ?? 0) / acc.creditLimit : 0

    return {
      ...acc,
      balanceOrDebt: debt,
      activeMSICount: activeMSI.length,
      nextMSIPayment: activeMSI[0]?.installmentAmount,
      utilizationRate,
    }
  })
}

/** Compute budget progress against actual spending in current period. */
export function deriveBudgetProgress(
  budgets: Budget[],
  transactions: Transaction[],
): BudgetWithProgress[] {
  return deriveBudgetProgressForDate(budgets, transactions, today())
}

/** Compute savings goal progress. */
export function deriveGoalProgress(goals: SavingsGoal[]): SavingsGoalWithProgress[] {
  return goals.map((goal) => {
    const progress = goal.targetAmount > 0 ? goal.currentAmount / goal.targetAmount : 0
    const remaining = goal.targetAmount - goal.currentAmount
    return { ...goal, progress, remaining }
  })
}

/** Total balance across all debit accounts. */
export function deriveTotalBalance(accounts: AccountWithSummary[]): Cents {
  return accounts
    .filter((a) => a.type === 'debit')
    .reduce((sum, a) => sum + (a.balanceOrDebt ?? 0), 0)
}

/** Total debt across all credit accounts. */
export function deriveTotalDebt(accounts: AccountWithSummary[]): Cents {
  return accounts.filter((a) => a.type === 'credit').reduce((sum, a) => sum + a.balanceOrDebt, 0)
}

/** Sum of expenses in the current month. */
export function deriveMonthSpending(transactions: Transaction[]): Cents {
  const now = new Date()
  const monthStart = toLocalISO(new Date(now.getFullYear(), now.getMonth(), 1))

  return transactions
    .filter((t) => t.type === 'expense' && t.date >= monthStart)
    .reduce((sum, t) => sum + t.amount, 0)
}

/** Build a lookup map for quick category resolution. */
export function useCategoryMap(): Map<string, Category> | undefined {
  const { data } = useCategories()
  if (!data) return undefined
  return new Map(data.map((c) => [c.id, c]))
}
