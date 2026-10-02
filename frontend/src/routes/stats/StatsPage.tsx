import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Card, Badge, Button, Input, Progress } from '@/components/ui'
import { EmptyState } from '@/components/common/EmptyState'
import { TrendChart } from '@/components/common/TrendChart'
import { formatMoney, formatMoneyCompact } from '@/lib/format'
import { formatDate, today } from '@/lib/date'
import { deriveBudgetProgressForDate, selectApplicableBudgets } from '@/lib/budget-period'
import {
  previousRange,
  rangeDays,
  resolveRange,
  snapshotDates,
  type RangePreset,
} from '@/lib/stats-range'
import { netWorthTimeline } from '@/lib/net-worth-timeline'
import { computeCashFlowForecast, sampleForecastTimeline } from '@/lib/cash-flow-forecast'
import { cn } from '@/lib/utils'
import {
  useTransactions,
  useCategories,
  useAccounts,
  useBudgets,
  useRecurringTransactions,
  useMSIPurchases,
} from '@/hooks/useQueries'
import type { Transaction, Category, Cents, AccentColor } from '@/types'

// ── Local helpers ────────────────────────────────────────────

interface PeriodData {
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

/** Group transactions by month and compute income/expense/net per month. */
function monthlyBreakdown(txs: Transaction[]): Array<PeriodData & { key: string; label: string }> {
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

function inRange(txs: Transaction[], start: string, end: string): Transaction[] {
  return txs.filter((t) => t.date >= start && t.date <= end)
}

function sumPeriod(txs: Transaction[]): PeriodData {
  let income = 0
  let expense = 0
  for (const t of txs) {
    if (t.type === 'income') income += t.amount
    else if (t.type === 'expense') expense += t.amount
  }
  return { income, expense, net: income - expense }
}

interface CatBreakdown {
  category: Category
  amount: Cents
  pct: number
}

/** Spending per category inside a date range, sorted desc. */
function spendingByCategory(
  txs: Transaction[],
  categories: Category[],
  type: 'expense' | 'income',
): CatBreakdown[] {
  const totals = new Map<string, Cents>()
  for (const t of txs) {
    if (t.type !== type || !t.categoryId) continue
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

interface MerchantTotal {
  merchant: string
  amount: Cents
  pct: number
}

/** Expenses grouped by merchant inside a date range, sorted desc. */
function topMerchants(txs: Transaction[], limit = 5): MerchantTotal[] {
  const totals = new Map<string, Cents>()
  let total = 0
  for (const t of txs) {
    const merchant = t.merchant?.trim()
    if (t.type !== 'expense' || !merchant) continue
    totals.set(merchant, (totals.get(merchant) ?? 0) + t.amount)
    total += t.amount
  }
  return Array.from(totals.entries())
    .map(([merchant, amount]) => ({ merchant, amount, pct: total > 0 ? amount / total : 0 }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit)
}

/** Signed percentage change between two amounts, null when not comparable. */
function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return (current - previous) / Math.abs(previous)
}

function formatDelta(pct: number | null): string {
  if (pct === null) return '—'
  const sign = pct > 0 ? '+' : ''
  return `${sign}${Math.round(pct * 100)}%`
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

const PRESETS: Array<{ id: RangePreset; label: string }> = [
  { id: 'month', label: 'Mes' },
  { id: '3m', label: '3M' },
  { id: '6m', label: '6M' },
  { id: '12m', label: '12M' },
  { id: 'ytd', label: 'Año' },
  { id: 'custom', label: 'Personalizado' },
]

// ── Page ─────────────────────────────────────────────────────

export default function StatsPage() {
  const txQ = useTransactions()
  const catQ = useCategories()
  const accQ = useAccounts()
  const budQ = useBudgets()
  const recQ = useRecurringTransactions()
  const msiQ = useMSIPurchases()
  const currentDate = today()
  const currentMonthKey = currentDate.slice(0, 7)
  const [preset, setPreset] = useState<RangePreset>('month')
  const [monthKey, setMonthKey] = useState(currentMonthKey)
  const [customStart, setCustomStart] = useState(() => {
    const [y, m] = currentMonthKey.split('-').map(Number)
    const start = new Date(y, m - 3, 1)
    return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(
      start.getDate(),
    ).padStart(2, '0')}`
  })
  const [customEnd, setCustomEnd] = useState(currentDate)
  const [forecastHorizon, setForecastHorizon] = useState<30 | 60 | 90>(30)
  const [includeDiscretionary, setIncludeDiscretionary] = useState(false)
  const [showAllEvents, setShowAllEvents] = useState(false)
  const previousCurrentMonth = useRef(currentMonthKey)

  useEffect(() => {
    const previous = previousCurrentMonth.current
    if (previous === currentMonthKey) return
    previousCurrentMonth.current = currentMonthKey
    setMonthKey((selected) => (selected === previous ? currentMonthKey : selected))
  }, [currentMonthKey])

  const range = useMemo(() => {
    try {
      return resolveRange(preset, {
        anchor: currentDate,
        monthKey,
        custom: { start: customStart, end: customEnd },
      })
    } catch {
      return resolveRange('month', { anchor: currentDate })
    }
  }, [preset, monthKey, customStart, customEnd, currentDate])

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
  const rangeTxs = inRange(historicalTransactions, range.start, range.end)
  const prev = previousRange(range)
  const prevTxs = inRange(historicalTransactions, prev.start, prev.end)

  const { income, expense, net } = sumPeriod(rangeTxs)
  const prevPeriod = sumPeriod(prevTxs)
  const savingsRate = income > 0 ? net / income : 0
  const txCount = rangeTxs.filter((t) => t.type !== 'transfer').length
  const expenseTxCount = rangeTxs.filter((t) => t.type === 'expense').length
  // Average daily spend uses elapsed days only — no credit for future days.
  const elapsedDays = Math.max(
    1,
    rangeDays({ start: range.start, end: range.end < currentDate ? range.end : currentDate }),
  )

  // Distributions
  const expenseDist = spendingByCategory(rangeTxs, categories, 'expense')
  const incomeDist = spendingByCategory(rangeTxs, categories, 'income')
  const maxExpense = expenseDist[0]?.amount ?? 1
  const maxIncome = incomeDist[0]?.amount ?? 1
  const merchants = topMerchants(rangeTxs)

  // Net worth timeline
  const worthPoints = netWorthTimeline(accounts, transactions, snapshotDates(range))

  // Cash flow forecast
  const recurring = recQ.data ?? []
  const msi = msiQ.data ?? []
  const dailyBurnRate = elapsedDays > 0 ? Math.round(expense / elapsedDays) : 0
  const forecast = computeCashFlowForecast({
    accounts,
    recurringTransactions: recurring,
    msiPurchases: msi,
    currentDate,
    horizonDays: forecastHorizon,
    discretionaryDailyBurnRateCents: includeDiscretionary ? dailyBurnRate : 0,
  })
  const forecastChartPoints = sampleForecastTimeline(forecast.timeline, 11)

  // Insights
  const topCat = expenseDist[0]
  const accountMap = new Map(accounts.map((a) => [a.id, a]))
  const accountUsage = new Map<string, number>()
  for (const t of rangeTxs) {
    if (t.type === 'transfer') continue
    accountUsage.set(t.accountId, (accountUsage.get(t.accountId) ?? 0) + 1)
  }
  const topAccountId = Array.from(accountUsage.entries()).sort((a, b) => b[1] - a[1])[0]?.[0]
  const topAccount = topAccountId ? accountMap.get(topAccountId) : undefined

  // Budget exceeded
  const catMap = new Map(categories.map((c) => [c.id, c]))
  const referenceDate = range.end < currentDate ? range.end : currentDate
  const exceededBudgets =
    range.start > currentDate
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
        {/* Preset filter */}
        <div
          className="flex flex-wrap items-center gap-1"
          role="group"
          aria-label="Periodo de análisis"
        >
          {PRESETS.map((option) => (
            <Button
              key={option.id}
              variant={preset === option.id ? 'default' : 'outline'}
              size="sm"
              className="h-7 px-2.5 text-[11px]"
              aria-pressed={preset === option.id}
              onClick={() => setPreset(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </div>

        {/* Period selector */}
        {preset === 'month' ? (
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
        ) : preset === 'custom' ? (
          <div className="flex items-center justify-between gap-2 px-1">
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Rango
            </h2>
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                aria-label="Inicio del rango"
                className="h-7 w-[130px] text-[11px]"
                value={customStart}
                max={customEnd}
                onChange={(e) => setCustomStart(e.target.value)}
              />
              <span className="text-xs text-muted-foreground">a</span>
              <Input
                type="date"
                aria-label="Fin del rango"
                className="h-7 w-[130px] text-[11px]"
                value={customEnd}
                min={customStart}
                onChange={(e) => setCustomEnd(e.target.value)}
              />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Periodo
            </h2>
            <Badge variant="outline" className="capitalize">
              <time dateTime={range.start} aria-live="polite">
                {formatDate(range.start)} – {formatDate(range.end)}
              </time>
            </Badge>
          </div>
        )}

        {/* Key metrics */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <MetricCard
            label="Ingresos"
            value={formatMoney(income)}
            accent="green"
            sub={`vs anterior ${formatDelta(deltaPct(income, prevPeriod.income))}`}
          />
          <MetricCard
            label="Gastos"
            value={formatMoney(expense)}
            accent="red"
            sub={`vs anterior ${formatDelta(deltaPct(expense, prevPeriod.expense))}`}
          />
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
          <MetricCard
            label="Promedio diario"
            value={formatMoney(Math.round(expense / elapsedDays))}
          />
          <MetricCard
            label="Gasto por mov."
            value={formatMoney(expenseTxCount > 0 ? Math.round(expense / expenseTxCount) : 0)}
          />
        </div>

        {/* Net worth timeline */}
        {worthPoints.length >= 2 && (
          <div className="space-y-2">
            <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Patrimonio
            </h2>
            <Card className="p-3">
              <TrendChart
                labels={worthPoints.map((p) => formatDate(p.date))}
                series={[
                  { name: 'Activos', color: 'green', values: worthPoints.map((p) => p.assets) },
                  { name: 'Deuda', color: 'red', values: worthPoints.map((p) => p.debt) },
                  {
                    name: 'Patrimonio',
                    color: 'blue',
                    filled: true,
                    values: worthPoints.map((p) => p.net),
                  },
                ]}
                formatValue={formatMoneyCompact}
                ariaLabel="Evolución del patrimonio: activos, deuda y patrimonio neto en el tiempo"
                height={190}
              />
            </Card>
          </div>
        )}

        {/* Cash flow forecast */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-1.5">
              <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Proyección de liquidez
              </h2>
              {forecast.isLiquidityRisk && (
                <Badge
                  variant="outline"
                  className="h-5 border-destructive/40 px-1.5 text-[10px] font-semibold text-destructive"
                >
                  Riesgo de liquidez
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              {([30, 60, 90] as const).map((h) => (
                <Button
                  key={h}
                  variant={forecastHorizon === h ? 'default' : 'outline'}
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  aria-pressed={forecastHorizon === h}
                  onClick={() => setForecastHorizon(h)}
                >
                  {h}D
                </Button>
              ))}
              <Button
                variant={includeDiscretionary ? 'secondary' : 'ghost'}
                size="sm"
                className="h-6 px-2 text-[10px]"
                aria-pressed={includeDiscretionary}
                onClick={() => setIncludeDiscretionary((v) => !v)}
                title="Simular ritmo de gasto diario habitual"
              >
                + Gasto habitual
              </Button>
            </div>
          </div>

          <Card className="space-y-3 p-3">
            {/* Forecast KPIs */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg bg-muted/40 p-2">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Saldo actual
                </span>
                <p className="text-xs font-semibold tabular-nums text-foreground">
                  {formatMoney(forecast.startingLiquidBalanceCents)}
                </p>
                <span className="text-[10px] text-muted-foreground">Cuentas de débito</span>
              </div>
              <div className="rounded-lg bg-muted/40 p-2">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Compromisos {forecastHorizon}d
                </span>
                <p className="text-xs font-semibold tabular-nums text-[hsl(var(--color-red))]">
                  -{formatMoney(forecast.totalScheduledOutflowCents)}
                </p>
                <span className="text-[10px] text-muted-foreground">
                  {forecast.events.length} pagos programados
                </span>
              </div>
              <div className="rounded-lg bg-muted/40 p-2">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Punto más bajo
                </span>
                <p
                  className={cn(
                    'text-xs font-semibold tabular-nums',
                    (includeDiscretionary
                      ? forecast.minRealisticBalanceCents
                      : forecast.minScheduledBalanceCents) < 0
                      ? 'text-destructive'
                      : 'text-[hsl(var(--color-blue))]',
                  )}
                >
                  {formatMoney(
                    includeDiscretionary
                      ? forecast.minRealisticBalanceCents
                      : forecast.minScheduledBalanceCents,
                  )}
                </p>
                <span className="text-[10px] text-muted-foreground">
                  el{' '}
                  {formatDate(
                    includeDiscretionary ? forecast.minRealisticDate : forecast.minScheduledDate,
                  )}
                </span>
              </div>
              <div className="rounded-lg bg-muted/40 p-2">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Saldo final {forecastHorizon}d
                </span>
                <p
                  className={cn(
                    'text-xs font-semibold tabular-nums',
                    (includeDiscretionary
                      ? forecast.projectedRealisticBalanceCents
                      : forecast.projectedScheduledBalanceCents) < 0
                      ? 'text-destructive'
                      : 'text-foreground',
                  )}
                >
                  {formatMoney(
                    includeDiscretionary
                      ? forecast.projectedRealisticBalanceCents
                      : forecast.projectedScheduledBalanceCents,
                  )}
                </p>
                <span className="text-[10px] text-muted-foreground">
                  {includeDiscretionary
                    ? `con ${formatMoney(dailyBurnRate)}/día`
                    : 'solo fijos y MSI'}
                </span>
              </div>
            </div>

            {/* Projection Chart */}
            <div className="pt-1">
              <TrendChart
                labels={forecastChartPoints.map((p) => p.label)}
                series={[
                  {
                    name: 'Compromisos fijos',
                    color: 'blue',
                    filled: !includeDiscretionary,
                    values: forecastChartPoints.map((p) => p.scheduledBalanceCents),
                  },
                  ...(includeDiscretionary
                    ? [
                        {
                          name: 'Con gasto habitual',
                          color: 'yellow' as const,
                          filled: true,
                          values: forecastChartPoints.map((p) => p.discretionaryBalanceCents),
                        },
                      ]
                    : []),
                ]}
                formatValue={formatMoneyCompact}
                ariaLabel={`Proyección de saldo a ${forecastHorizon} días`}
                height={180}
              />
            </div>

            {/* Upcoming payments timeline */}
            {forecast.events.length > 0 && (
              <div className="border-t border-border pt-2.5">
                <div className="flex items-center justify-between pb-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    Calendario de pagos ({forecast.events.length})
                  </span>
                  {forecast.events.length > 5 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1.5 text-[10px]"
                      onClick={() => setShowAllEvents((v) => !v)}
                    >
                      {showAllEvents ? 'Ver menos' : `Ver todos (${forecast.events.length})`}
                    </Button>
                  )}
                </div>
                <div className="divide-y divide-border/60">
                  {(showAllEvents ? forecast.events : forecast.events.slice(0, 5)).map((ev) => (
                    <div key={ev.id} className="flex items-center justify-between gap-2 py-1.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <Badge
                          variant="outline"
                          className={cn(
                            'h-5 px-1.5 text-[10px] font-normal tabular-nums',
                            ev.type === 'msi'
                              ? 'border-purple-500/30 text-purple-600 dark:text-purple-400'
                              : 'border-orange-500/30 text-orange-600 dark:text-orange-400',
                          )}
                        >
                          {ev.type === 'msi' ? 'MSI' : 'Recurrente'}
                        </Badge>
                        <div className="min-w-0 truncate">
                          <p className="truncate text-xs font-medium">{ev.description}</p>
                          <span className="text-[10px] text-muted-foreground">
                            {formatDate(ev.date)} · {ev.accountName}
                          </span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-medium tabular-nums text-[hsl(var(--color-red))]">
                          -{formatMoney(ev.amountCents)}
                        </p>
                        <span className="text-[10px] tabular-nums text-muted-foreground">
                          Queda {formatMoney(ev.projectedBalanceAfterCents)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
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

        {/* Top merchants */}
        {merchants.length > 0 && (
          <div className="space-y-2">
            <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Top comercios
            </h2>
            <Card className="divide-y divide-border px-3">
              {merchants.map((item, index) => (
                <div key={item.merchant} className="flex items-center justify-between gap-2 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="w-4 shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="truncate text-xs font-medium">{item.merchant}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {Math.round(item.pct * 100)}%
                    </span>
                    <span className="text-xs font-medium tabular-nums">
                      {formatMoney(item.amount)}
                    </span>
                  </div>
                </div>
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
              label={preset === 'month' ? 'Carga MSI mensual' : 'Carga MSI del periodo'}
              value={formatMoney(
                rangeTxs.filter((t) => t.msiPurchaseId).reduce((s, t) => s + t.amount, 0),
              )}
              accent="purple"
            />
          </Card>
        </div>
      </div>
    </>
  )
}
