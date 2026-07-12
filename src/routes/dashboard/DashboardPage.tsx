import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Amount } from '@/components/common/Amount'
import { CategoryIcon } from '@/components/common/CategoryIcon'
import { Badge, Button, Card, Progress, Separator } from '@/components/ui'
import {
  deriveAccountSummary,
  deriveGoalProgress,
  deriveTotalBalance,
  deriveTotalDebt,
  useAccounts,
  useBudgets,
  useCategories,
  useMSIPurchases,
  useSavingsGoals,
  useTransactions,
} from '@/hooks/useQueries'
import { formatMoney } from '@/lib/format'
import type {
  Budget,
  BudgetWithProgress,
  Category,
  Cents,
  SavingsGoalWithProgress,
  Transaction,
} from '@/types'

const monthFormatter = new Intl.DateTimeFormat('es-MX', {
  month: 'long',
  year: 'numeric',
})

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

function getPeriod(transactions: Transaction[]) {
  const latestDate = transactions[0]?.date ?? new Date().toISOString().slice(0, 10)
  const date = new Date(`${latestDate}T00:00:00`)
  const start = new Date(date.getFullYear(), date.getMonth(), 1)
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0)

  return {
    label: monthFormatter.format(date),
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

function filterTransactionsByPeriod(
  transactions: Transaction[],
  start: string,
  end: string,
) {
  return transactions.filter((tx) => tx.date >= start && tx.date <= end)
}

function sumTransactions(transactions: Transaction[], type: Transaction['type']) {
  return transactions
    .filter((tx) => tx.type === type)
    .reduce((sum, tx) => sum + tx.amount, 0)
}

function deriveBudgetsForPeriod(
  budgets: Budget[],
  transactions: Transaction[],
): BudgetWithProgress[] {
  return budgets.map((budget) => {
    const spent = transactions
      .filter(
        (tx) =>
          tx.type === 'expense' &&
          tx.categoryId !== null &&
          tx.categoryId === budget.categoryId,
      )
      .reduce((sum, tx) => sum + tx.amount, 0)
    const remaining = budget.amount - spent
    const progress = budget.amount > 0 ? spent / budget.amount : 0

    return { ...budget, spent, remaining, progress }
  })
}

function buildCategoryRanking(
  transactions: Transaction[],
  categories: Map<string, Category>,
  type: 'expense' | 'income',
) {
  const total = sumTransactions(transactions, type)
  const byCategory = new Map<string, Cents>()

  for (const tx of transactions) {
    if (tx.type !== type || !tx.categoryId) continue
    byCategory.set(tx.categoryId, (byCategory.get(tx.categoryId) ?? 0) + tx.amount)
  }

  return [...byCategory.entries()]
    .map(([categoryId, amount]) => ({
      category: categories.get(categoryId),
      amount,
      percentage: total > 0 ? amount / total : 0,
    }))
    .filter(
      (item): item is { category: Category; amount: Cents; percentage: number } =>
        Boolean(item.category),
    )
    .sort((a, b) => b.amount - a.amount)
}

function MetricCard({
  label,
  value,
  tone = 'default',
  detail,
}: {
  label: string
  value: Cents
  tone?: 'default' | 'green' | 'red'
  detail?: string
}) {
  const toneClass =
    tone === 'green'
      ? 'text-[hsl(var(--color-green))]'
      : tone === 'red'
        ? 'text-[hsl(var(--color-red))]'
        : 'text-foreground'

  return (
    <Card className="min-w-[9.5rem] flex-1 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <Amount value={Math.abs(value)} size="sm" className={`mt-1 block ${toneClass}`} />
      {detail && <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>}
    </Card>
  )
}

function PeriodSelector({ label }: { label: string }) {
  return (
    <Card className="p-2.5">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="icon" disabled aria-label="Periodo anterior">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-center">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Periodo
          </p>
          <p className="text-sm font-semibold capitalize">{label}</p>
        </div>
        <Button variant="ghost" size="icon" disabled aria-label="Periodo siguiente">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  )
}

function MonthlyOverview({ income, expenses }: { income: Cents; expenses: Cents }) {
  const netSavings = income - expenses
  const savingsRate = income > 0 ? netSavings / income : 0

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Overview mensual</p>
          <p className="text-xs text-muted-foreground">Ingresos, gastos y ahorro neto.</p>
        </div>
        <Badge variant={netSavings >= 0 ? 'muted' : 'outline'} className={netSavings < 0 ? 'border-destructive text-destructive' : undefined}>
          {formatPercent(savingsRate)} ahorro
        </Badge>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-md bg-muted/40 p-2">
          <p className="text-muted-foreground">Ingresos</p>
          <p className="mt-1 font-semibold tabular-nums text-[hsl(var(--color-green))]">
            {formatMoney(income)}
          </p>
        </div>
        <div className="rounded-md bg-muted/40 p-2">
          <p className="text-muted-foreground">Gastos</p>
          <p className="mt-1 font-semibold tabular-nums text-[hsl(var(--color-red))]">
            {formatMoney(expenses)}
          </p>
        </div>
        <div className="rounded-md bg-muted/40 p-2">
          <p className="text-muted-foreground">Ahorro</p>
          <p className={netSavings < 0 ? 'mt-1 font-semibold tabular-nums text-destructive' : 'mt-1 font-semibold tabular-nums'}>
            {formatMoney(Math.abs(netSavings))}
          </p>
        </div>
      </div>
    </Card>
  )
}

function BudgetAlerts({
  budgets,
  categories,
}: {
  budgets: BudgetWithProgress[]
  categories: Map<string, Category>
}) {
  const critical = budgets
    .filter((budget) => budget.progress >= 0.8)
    .sort((a, b) => {
      const aExceeded = a.progress > 1
      const bExceeded = b.progress > 1
      if (aExceeded !== bExceeded) return aExceeded ? -1 : 1
      return b.progress - a.progress
    })
    .slice(0, 3)

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Presupuestos críticos</p>
          <p className="text-xs text-muted-foreground">Excedidos o cerca del límite.</p>
        </div>
        <Link to="/budgets" className="text-xs text-muted-foreground hover:text-foreground">
          Ver todos
        </Link>
      </div>
      <div className="mt-3 space-y-3">
        {critical.length === 0 ? (
          <p className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
            Sin alertas de presupuesto en este periodo.
          </p>
        ) : (
          critical.map((budget) => {
            const category = budget.categoryId ? categories.get(budget.categoryId) : undefined
            const isExceeded = budget.progress > 1
            return (
              <div key={budget.id} className="flex items-center gap-2">
                <CategoryIcon
                  name={category?.icon ?? 'HelpCircle'}
                  color={category?.color ?? 'gray'}
                  className="h-7 w-7"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-medium">{category?.name ?? 'General'}</span>
                    <span className={isExceeded ? 'shrink-0 tabular-nums text-destructive' : 'shrink-0 tabular-nums text-muted-foreground'}>
                      {formatPercent(budget.progress)}
                    </span>
                  </div>
                  <Progress
                    value={budget.progress}
                    variant={isExceeded ? 'warning' : 'default'}
                    accent={isExceeded ? undefined : category?.color}
                    className="mt-1.5"
                  />
                </div>
              </div>
            )
          })
        )}
      </div>
    </Card>
  )
}

function DistributionCard({
  title,
  description,
  items,
  empty,
}: {
  title: string
  description: string
  items: ReturnType<typeof buildCategoryRanking>
  empty: string
}) {
  return (
    <Card className="p-4">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="mt-3 space-y-3">
        {items.length === 0 ? (
          <p className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">{empty}</p>
        ) : (
          items.slice(0, 5).map(({ category, amount, percentage }) => (
            <div key={category.id} className="flex items-center gap-2">
              <CategoryIcon name={category.icon} color={category.color} className="h-7 w-7" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-medium">{category.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatMoney(amount)} · {formatPercent(percentage)}
                  </span>
                </div>
                <Progress value={percentage} accent={category.color} className="mt-1.5" />
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  )
}

function DebtAndMSI({ purchases }: { purchases: ReturnType<typeof useMSIPurchases>['data'] }) {
  const active = (purchases ?? []).filter((purchase) => purchase.status === 'active')
  const monthlyPayment = active.reduce((sum, purchase) => sum + purchase.installmentAmount, 0)

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">MSI y deuda</p>
          <p className="text-xs text-muted-foreground">Mensualidad comprometida.</p>
        </div>
        <Badge accent="purple">{active.length}</Badge>
      </div>
      <Amount value={monthlyPayment} size="lg" className="mt-3 block" />
      <div className="mt-3 space-y-2">
        {active.slice(0, 3).map((purchase) => (
          <div key={purchase.id} className="flex items-center justify-between gap-3 text-xs">
            <span className="truncate text-muted-foreground">{purchase.description}</span>
            <span className="shrink-0 font-medium tabular-nums">
              {formatMoney(purchase.installmentAmount)}
            </span>
          </div>
        ))}
      </div>
      <Link to="/accounts" className="mt-3 block text-xs text-muted-foreground hover:text-foreground">
        Ver cuentas
      </Link>
    </Card>
  )
}

function GoalsOverview({ goals }: { goals: SavingsGoalWithProgress[] }) {
  const active = goals.filter((goal) => !goal.isCompleted)
  const target = goals.reduce((sum, goal) => sum + goal.targetAmount, 0)
  const saved = goals.reduce((sum, goal) => sum + goal.currentAmount, 0)
  const progress = target > 0 ? saved / target : 0

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Metas</p>
          <p className="text-xs text-muted-foreground">Progreso agregado de ahorro.</p>
        </div>
        <Badge variant="muted">{active.length} activas</Badge>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Progress value={progress} variant={progress >= 1 ? 'success' : 'default'} className="flex-1" />
        <span className="w-11 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
          {formatPercent(progress)}
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {formatMoney(saved)} de {formatMoney(target)}
      </p>
      <Link to="/goals" className="mt-3 block text-xs text-muted-foreground hover:text-foreground">
        Ver metas
      </Link>
    </Card>
  )
}

function RecentMovements({
  transactions,
  categories,
}: {
  transactions: Transaction[]
  categories: Map<string, Category>
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Últimos movimientos</p>
          <p className="text-xs text-muted-foreground">Actividad reciente de tus cuentas.</p>
        </div>
        <Link to="/transactions" className="text-xs text-muted-foreground hover:text-foreground">
          Ver todos
        </Link>
      </div>
      <div className="mt-3 space-y-3">
        {transactions.slice(0, 5).map((tx, index) => {
          const category = tx.categoryId ? categories.get(tx.categoryId) : undefined
          const isIncome = tx.type === 'income'
          const isTransfer = tx.type === 'transfer'
          return (
            <div key={tx.id}>
              {index > 0 && <Separator className="mb-3" />}
              <div className="flex items-center gap-3">
                <CategoryIcon
                  name={category?.icon ?? 'Repeat'}
                  color={category?.color ?? 'gray'}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{tx.description}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {tx.merchant ?? tx.date}
                  </p>
                </div>
                <Amount
                  value={isIncome || isTransfer ? tx.amount : -tx.amount}
                  signed
                  size="sm"
                />
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

export default function DashboardPage() {
  const accountsQ = useAccounts()
  const transactionsQ = useTransactions()
  const msiQ = useMSIPurchases()
  const goalsQ = useSavingsGoals()
  const budgetsQ = useBudgets()
  const categoriesQ = useCategories()

  const isLoading =
    accountsQ.isLoading ||
    transactionsQ.isLoading ||
    msiQ.isLoading ||
    goalsQ.isLoading ||
    budgetsQ.isLoading ||
    categoriesQ.isLoading

  if (isLoading) {
    return (
      <>
        <Header title="Inicio financiero" subtitle="Centro de control" />
        <div className="flex h-64 items-center justify-center">
          <span className="text-xs text-muted-foreground">Cargando…</span>
        </div>
      </>
    )
  }

  const accounts = accountsQ.data ?? []
  const transactions = transactionsQ.data ?? []
  const msiPurchases = msiQ.data ?? []
  const goals = goalsQ.data ?? []
  const budgets = budgetsQ.data ?? []
  const categories = categoriesQ.data ?? []

  const categoryMap = new Map(categories.map((category) => [category.id, category]))
  const period = getPeriod(transactions)
  const periodTransactions = filterTransactionsByPeriod(transactions, period.start, period.end)
  const accountSummary = deriveAccountSummary(accounts, msiPurchases)
  const availableFunds = deriveTotalBalance(accountSummary)
  const debt = deriveTotalDebt(accountSummary)
  const netWorth = availableFunds - debt
  const monthIncome = sumTransactions(periodTransactions, 'income')
  const monthExpenses = sumTransactions(periodTransactions, 'expense')
  const budgetProgress = deriveBudgetsForPeriod(budgets, periodTransactions)
  const goalProgress = deriveGoalProgress(goals)
  const expenseDistribution = buildCategoryRanking(periodTransactions, categoryMap, 'expense')
  const incomeDistribution = buildCategoryRanking(periodTransactions, categoryMap, 'income')

  return (
    <>
      <Header title="Inicio financiero" subtitle="Centro de control" />

      <div className="space-y-4 py-4">
        <PeriodSelector label={period.label} />

        <div className="flex gap-3 overflow-x-auto pb-1 sm:grid sm:grid-cols-4 sm:overflow-visible">
          <MetricCard label="Disponible" value={availableFunds} tone="green" detail="Fondos operativos" />
          <MetricCard label="Gasto mes" value={monthExpenses} tone="red" detail="Periodo seleccionado" />
          <MetricCard label="Deuda" value={debt} tone="red" detail="Tarjetas y crédito" />
          <MetricCard
            label="Patrimonio"
            value={netWorth}
            tone={netWorth >= 0 ? 'green' : 'red'}
            detail="Disponible menos deuda"
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <MonthlyOverview income={monthIncome} expenses={monthExpenses} />
            <BudgetAlerts budgets={budgetProgress} categories={categoryMap} />
            <DistributionCard
              title="Distribución de gastos"
              description="Top categorías del periodo."
              items={expenseDistribution}
              empty="No hay gastos registrados en este periodo."
            />
            <RecentMovements transactions={transactions} categories={categoryMap} />
          </div>

          <div className="space-y-4">
            <DistributionCard
              title="Distribución de ingresos"
              description="Fuentes de ingreso del periodo."
              items={incomeDistribution}
              empty="No hay ingresos registrados en este periodo."
            />
            <DebtAndMSI purchases={msiPurchases} />
            <GoalsOverview goals={goalProgress} />
          </div>
        </div>
      </div>
    </>
  )
}
