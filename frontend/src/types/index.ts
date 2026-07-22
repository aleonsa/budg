/**
 * budg — Domain Types
 * Money is stored in cents (integer) to avoid floating-point errors.
 * See decision log: cents throughout the model, formatters handle display.
 */

export type ID = string
export type ISODate = string // 'YYYY-MM-DD'
export type Cents = number // integer, minor units (centavos)
export type CurrencyCode = 'MXN' | 'USD'

/** Accent color keys used across the app. */
export type AccentColor =
  'blue' | 'green' | 'red' | 'purple' | 'yellow' | 'orange' | 'cyan' | 'pink' | 'gray'

// ── Category ────────────────────────────────────────────────
export type CategoryKind = 'expense' | 'income'

export interface Category {
  id: ID
  name: string
  kind: CategoryKind
  color: AccentColor
  icon: string // lucide icon name
  parentId: ID | null // subcategories (optional in v1)
  isSystem: boolean // cannot delete/edit core (defaults)
  order: number
}

// ── Account (debit/credit) ─────────────────────────────────
export type AccountType = 'debit' | 'credit'

export interface Account {
  id: ID
  name: string // 'Nómina BBVA', 'Cred Platino'
  type: AccountType
  institution: string
  last4: string
  currency: CurrencyCode

  // debit fields
  balance?: Cents

  // credit fields
  creditLimit?: Cents
  availableCredit?: Cents
  statementCutDay?: number // 1–28
  paymentDueDay?: number // día límite de pago

  isActive: boolean
}

// ── Transaction ────────────────────────────────────────────
export type TransactionType = 'expense' | 'income' | 'transfer'

export interface Transaction {
  id: ID
  accountId: ID
  type: TransactionType
  amount: Cents // always positive; sign is derived from `type`
  categoryId: ID | null
  date: ISODate
  description: string
  merchant?: string
  msiPurchaseId?: ID // if this is an MSI installment
  transferToAccountId?: ID // if type === 'transfer'
  isReconciled: boolean
  createdAt: ISODate
}

// ── MSI Purchase (meses sin intereses) ─────────────────────
export interface MSIPurchase {
  id: ID
  accountId: ID // credit card
  description: string
  merchant?: string
  totalAmount: Cents
  installmentAmount: Cents // totalAmount / installmentCount (last absorbs remainder)
  installmentCount: number // e.g. 12
  installmentsPaid: number // how many have been charged
  startDate: ISODate // month of first installment
  nextInstallmentDate?: ISODate
  categoryId: ID | null
  status: 'active' | 'completed'
}

// ── Recurring Transaction (subscriptions) ────────────────────
export type RecurringTransactionFrequency = 'monthly' | 'yearly'

export interface RecurringTransaction {
  id: ID
  accountId: ID
  categoryId: ID | null
  description: string
  merchant?: string
  amount: Cents
  frequency: RecurringTransactionFrequency
  startDate: ISODate
  nextDate: ISODate
  isActive: boolean
}

// ── Savings Goal ───────────────────────────────────────────
export interface SavingsGoal {
  id: ID
  name: string
  targetAmount: Cents
  currentAmount: Cents
  targetDate?: ISODate
  accountId: ID | null // where the money lives (optional)
  isCompleted: boolean
  order: number
}

// ── Budget ─────────────────────────────────────────────────
export type BudgetPeriod = 'weekly' | 'monthly' | 'yearly'

export interface Budget {
  id: ID
  categoryId: ID | null // null = global budget
  amount: Cents // limit for the period
  period: BudgetPeriod
  startDate: ISODate // cycle anchor
}

// ── Categorization Rule ────────────────────────────────────
export interface Rule {
  id: ID
  field: 'merchant' | 'description'
  operator: 'contains' | 'startsWith'
  value: string
  categoryId: ID
  isActive: boolean
  priority: number
}

// ── Derived types (computed in queries, not persisted) ─────

export interface AccountWithSummary extends Account {
  // debit
  balanceOrDebt: Cents // balance for debit, current debt for credit
  // credit extras
  activeMSICount?: number
  nextMSIPayment?: Cents
  utilizationRate?: number // availableCredit / creditLimit (0–1)
}

export interface BudgetWithProgress extends Budget {
  spent: Cents
  remaining: Cents
  progress: number // 0–1
}

export interface CategoryWithSpent extends Category {
  spent: Cents
  percentage: number // 0–1 of total spending
}

export interface SavingsGoalWithProgress extends SavingsGoal {
  progress: number // 0–1
  remaining: Cents
}
