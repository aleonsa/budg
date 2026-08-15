import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Card, Badge, Button, Progress } from '@/components/ui'
import { EmptyState } from '@/components/common/EmptyState'
import { formatMoney, formatMoneyCompact } from '@/lib/format'
import { today } from '@/lib/date'
import { deriveBudgetProgressForDate, selectApplicableBudgets } from '@/lib/budget-period'
import { cn } from '@/lib/utils'
import { useTransactions, useCategories, useAccounts, useBudgets } from '@/hooks/useQueries'
import type { Transaction, Category, Cents, AccentColor } from '@/types'

// ── Local helpers ────────────────────────────────────────────

interface MonthData {
  key: string
  label: string
  income: Cents
  expense: Cents
  net: Cents
}

function monthKeyForDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split('-').map(Number)
  return monthKeyForDate(new Date(year, month - 1 + delta, 1))
}

function monthEnd(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number)
  const day = new Date(year, month, 0).getDate()
  return `${monthKey}-${String(day).padStart(2, '0')}`
}

/** Group transactions by month and compute income/expense/net per month. */
function monthlyBreakdown(txs: Transaction[]): MonthData[] {
  const months = new Map<string, { income: Cents; expense: Cents }>()

  for (const t of txs) {
    const monthKey = t.date.slice(0, 7)
    const entry = months.get(monthKey) ?? { income: 0, expense: 0 }
    if (t.type === 'income') entry.income += t.amount
    else if (t.type === 'expense') entry.expense += t.amount
    months.set(monthKey, entry)
  }

  return Array.from(months.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, v]) => {
      const [y, m] = key.split('-')
      const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('es-MX', {
        month: 'short',
        year: '2-digit',
      })
      return { key, label, income: v.income, expense: v.expense, net: v.income - v.expense }
    })
}

interface CatBreakdown {
  category: Category
  amount: Cents
  pct: number
}

/** Spending per category in a given month key, sorted desc. */
function spendingByCategory(
  txs: Transaction[],
  categories: Category[],
  monthKey: string,
  type: 'expense' | 'income',
): CatBreakdown[] {
  const totals = new Map<string, Cents>()
  for (const t of transactions_filter(txs, type, monthKey)) {
    if (!t.categoryId) continue
    totals.set(t.categoryId, (totals.get(t.categoryId) ?? 0) + t.amount)
  }

  const total = Array.from(totals.values()).reduce((s, v) => s + v, 0)
  return categories
    .filter((c) => totals.has(c.id))
    .map((c) => ({
      category: c,
      amount: totals.get(c.id) ?? 0,
      pct: total > 0 ? (totals.get(c.id) ?? 0) / total : 0,
    }))
    .sort((a, b) => b.amount - a.amount)
}

function transactions_filter(
  txs: Transaction[],
  type: 'expense' | 'income',
  monthKey: string,
): Transaction[] {
  return txs.filter((t) => t.type === type && t.date.startsWith(monthKey))
}

// ── Sub-components ───────────────────────────────────────────

function MetricCard({
  label,
  value,
  accent,
  sub,
}: {
  label: string
  value: string
  accent?: 'green' | 'red' | 'blue' | 'purple' | 'yellow'
  sub?: string
}) {
  const colorClass = accent
    ? {
        green: 'text-[hsl(var(--color-green))]',
        red: 'text-[hsl(var(--color-red))]',
        blue: 'text-[hsl(var(--color-blue))]',
        purple: 'text-[hsl(var(--color-purple))]',
        yellow: 'text-[hsl(var(--color-yellow))]',
      }[accent]
    : 'text-foreground'

  return (
    <Card className="p-3">
      <p className="text-[10px] leading-tight text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 text-sm font-semibold leading-tight tabular-nums', colorClass)}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[10px] text-muted-foreground">{sub}</p>}
    </Card>
  )
}

function CategoryBarRow({
  name,
  metric,
  color,
  amount,
  pct,
  maxAmount,
}: {
  name: string
  metric: string
  color: AccentColor
  amount: Cents
  pct: number
  maxAmount: Cents
}) {
  const barPct = maxAmount > 0 ? amount / maxAmount : 0
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="w-20 shrink-0 truncate text-xs text-foreground sm:w-24">{name}</span>
      <Progress
        value={barPct}
        accent={color}
        aria-label={`Participación de ${name} en ${metric}`}
        className="h-2 flex-1"
      />
      <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
        {Math.round(pct * 100)}%
      </span>
      <span className="hidden w-16 shrink-0 text-right text-[11px] tabular-nums sm:block">
        {formatMoneyCompact(amount)}
      </span>
    </div>
  )
}

function InsightRow({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: AccentColor
}) {
  const colorClass = accent
    ? {
        green: 'text-[hsl(var(--color-green))]',
        red: 'text-[hsl(var(--color-red))]',
        blue: 'text-[hsl(var(--color-blue))]',
        purple: 'text-[hsl(var(--color-purple))]',
        yellow: 'text-[hsl(var(--color-yellow))]',
        orange: 'text-[hsl(var(--color-orange))]',
        cyan: 'text-[hsl(var(--color-cyan))]',
        pink: 'text-[hsl(var(--color-pink))]',
        gray: 'text-muted-foreground',
      }[accent]
    : ''

  return (
    <div className="flex items-center justify-between gap-2 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn('truncate text-right text-xs font-medium', colorClass)}>{value}</span>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────

export default function StatsPage() {
  const txQ = useTransactions()
  const catQ = useCategories()
  const accQ = useAccounts()
  const budQ = useBudgets()
  const currentDate = today()
  const currentMonthKey = currentDate.slice(0, 7)
  const [monthKey, setMonthKey] = useState(currentMonthKey)
  const previousCurrentMonth = useRef(currentMonthKey)

  useEffect(() => {
    const previous = previousCurrentMonth.current
    if (previous === currentMonthKey) return
    previousCurrentMonth.current = currentMonthKey
    setMonthKey((selected) => (selected === previous ? currentMonthKey : selected))
  }, [currentMonthKey])

  const isLoading = txQ.isLoading || catQ.isLoading || accQ.isLoading || budQ.isLoading

  if (isLoading) {
    return (
      <>
        <Header title="Estadísticas" subtitle="Análisis financiero" />
        <div className="flex h-64 items-center justify-center">
          <span className="text-xs text-muted-foreground">Cargando…</span>
        </div>
      </>
    )
  }

  if (txQ.isError || catQ.isError || accQ.isError || budQ.isError) {
    return (
      <>
        <Header title="Estadísticas" subtitle="Análisis financiero" />
        <div role="alert" className="py-10 text-center text-sm text-destructive">
          No se pudieron cargar las estadísticas.
        </div>
      </>
    )
  }

  const transactions = txQ.data ?? []
  const categories = catQ.data ?? []
  const accounts = accQ.data ?? []
  const budgets = budQ.data ?? []

  if (transactions.length === 0) {
    return (
      <>
        <Header title="Estadísticas" subtitle="Análisis financiero" />
        <div className="py-4">
          <EmptyState
            title="Sin datos suficientes"
            description="Registra movimientos para ver estadísticas."
          />
        </div>
      </>
    )
  }

  const historicalTransactions = transactions.filter(
    (transaction) => transaction.date <= currentDate,
  )
  const monthsData = monthlyBreakdown(historicalTransactions)
  const currentMonth = monthsData.find((month) => month.key === monthKey)
  const monthTxs = historicalTransactions.filter((transaction) =>
    transaction.date.startsWith(monthKey),
  )

  const income = currentMonth?.income ?? 0
  const expense = currentMonth?.expense ?? 0
  const net = currentMonth?.net ?? 0
  const savingsRate = income > 0 ? net / income : 0
  const txCount = monthTxs.filter((t) => t.type !== 'transfer').length
  const expenseTxCount = monthTxs.filter((t) => t.type === 'expense').length

  // Distributions
  const expenseDist = spendingByCategory(historicalTransactions, categories, monthKey, 'expense')
  const incomeDist = spendingByCategory(historicalTransactions, categories, monthKey, 'income')
  const maxExpense = expenseDist[0]?.amount ?? 1
  const maxIncome = incomeDist[0]?.amount ?? 1

  // Insights
  const topCat = expenseDist[0]
  const accountMap = new Map(accounts.map((a) => [a.id, a]))
  const accountUsage = new Map<string, number>()
  for (const t of monthTxs) {
    if (t.type === 'transfer') continue
    accountUsage.set(t.accountId, (accountUsage.get(t.accountId) ?? 0) + 1)
  }
  const topAccountId = Array.from(accountUsage.entries()).sort((a, b) => b[1] - a[1])[0]?.[0]
  const topAccount = topAccountId ? accountMap.get(topAccountId) : undefined

  // Budget exceeded
  const catMap = new Map(categories.map((c) => [c.id, c]))
  const referenceDate = monthKey === currentMonthKey ? currentDate : monthEnd(monthKey)
  const exceededBudgets =
    monthKey > currentMonthKey
      ? []
      : selectApplicableBudgets(
          deriveBudgetProgressForDate(budgets, historicalTransactions, referenceDate),
          referenceDate,
        )
          .filter((budget) => budget.progress > 1)
          .sort((a, b) => b.progress - a.progress)
  const topExceeded = exceededBudgets[0]

  return (
    <>
      <Header title="Estadísticas" subtitle="Análisis financiero" />
      <div className="space-y-3.5 py-3">
        {/* Period selector */}
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Periodo
          </h2>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label="Mes anterior"
              onClick={() => setMonthKey((month) => shiftMonth(month, -1))}
            >
              <ChevronLeft />
            </Button>
            <Badge variant="outline" className="min-w-32 justify-center capitalize">
              <time dateTime={`${monthKey}-01`} aria-live="polite">
                {new Date(monthKey + '-01T00:00:00').toLocaleDateString('es-MX', {
                  month: 'long',
                  year: 'numeric',
                })}
              </time>
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label="Mes siguiente"
              onClick={() => setMonthKey((month) => shiftMonth(month, 1))}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>

        {/* Key metrics */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <MetricCard label="Ingresos" value={formatMoney(income)} accent="green" />
          <MetricCard label="Gastos" value={formatMoney(expense)} accent="red" />
          <MetricCard
            label="Ahorro neto"
            value={formatMoney(net)}
            accent={net >= 0 ? 'green' : 'red'}
            sub={`${txCount} movimientos`}
          />
          <MetricCard
            label="Tasa de ahorro"
            value={`${Math.round(savingsRate * 100)}%`}
            accent={savingsRate >= 0.1 ? 'green' : savingsRate >= 0 ? 'yellow' : 'red'}
          />
          <MetricCard label="Promedio diario" value={formatMoney(Math.round(expense / 30))} />
          <MetricCard
            label="Gasto por mov."
            value={formatMoney(expenseTxCount > 0 ? Math.round(expense / expenseTxCount) : 0)}
          />
        </div>

        {/* Expense distribution */}
        {expenseDist.length > 0 && (
          <div className="space-y-2">
            <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Gastos por categoría
            </h2>
            <Card className="p-3">
              {expenseDist.slice(0, 8).map((item) => (
                <CategoryBarRow
                  key={item.category.id}
                  name={item.category.name}
                  metric="gastos por categoría"
                  color={item.category.color}
                  amount={item.amount}
                  pct={item.pct}
                  maxAmount={maxExpense}
                />
              ))}
            </Card>
          </div>
        )}

        {/* Income distribution */}
        {incomeDist.length > 0 && (
          <div className="space-y-2">
            <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Ingresos por categoría
            </h2>
            <Card className="p-3">
              {incomeDist.map((item) => (
                <CategoryBarRow
                  key={item.category.id}
                  name={item.category.name}
                  metric="ingresos por categoría"
                  color={item.category.color}
                  amount={item.amount}
                  pct={item.pct}
                  maxAmount={maxIncome}
                />
              ))}
            </Card>
          </div>
        )}

        {/* Monthly trend */}
        <div className="space-y-2">
          <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Tendencia mensual
          </h2>
          <Card className="overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-4 gap-2 border-b border-border px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>Mes</span>
              <span className="text-right">Ingresos</span>
              <span className="text-right">Gastos</span>
              <span className="text-right">Neto</span>
            </div>
            {/* Rows */}
            {[...monthsData].reverse().map((m) => (
              <div
                key={m.key}
                className="grid grid-cols-4 gap-2 border-b border-border px-3 py-2 last:border-0"
              >
                <span className="truncate text-xs font-medium capitalize">{m.label}</span>
                <span className="text-right text-[11px] tabular-nums text-[hsl(var(--color-green))]">
                  {formatMoneyCompact(m.income)}
                </span>
                <span className="text-right text-[11px] tabular-nums text-[hsl(var(--color-red))]">
                  {formatMoneyCompact(m.expense)}
                </span>
                <span
                  className={cn(
                    'text-right text-[11px] font-medium tabular-nums',
                    m.net >= 0 ? 'text-[hsl(var(--color-green))]' : 'text-[hsl(var(--color-red))]',
                  )}
                >
                  {formatMoneyCompact(m.net)}
                </span>
              </div>
            ))}
          </Card>
        </div>

        {/* Insights */}
        <div className="space-y-2">
          <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Insights
          </h2>
          <Card className="divide-y divide-border px-3">
            {topCat && (
              <InsightRow
                label="Mayor categoría de gasto"
                value={`${topCat.category.name} · ${formatMoney(topCat.amount)}`}
                accent={topCat.category.color}
              />
            )}
            {topExceeded && (
              <InsightRow
                label="Presupuesto más excedido"
                value={`${
                  topExceeded.categoryId
                    ? (catMap.get(topExceeded.categoryId)?.name ?? '—')
                    : 'General'
                } · ${Math.round(topExceeded.progress * 100)}%`}
                accent="red"
              />
            )}
            {topAccount && (
              <InsightRow
                label="Cuenta más usada"
                value={`${topAccount.name} · ${accountUsage.get(topAccount.id)} movs.`}
                accent="blue"
              />
            )}
            <InsightRow
              label="Carga MSI mensual"
              value={formatMoney(
                historicalTransactions
                  .filter((t) => t.msiPurchaseId && t.date.startsWith(monthKey))
                  .reduce((s, t) => s + t.amount, 0),
              )}
              accent="purple"
            />
          </Card>
        </div>
      </div>
    </>
  )
}
