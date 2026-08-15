import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { EmptyState } from '@/components/common/EmptyState'
import { Amount } from '@/components/common/Amount'
import { CategoryIcon } from '@/components/common/CategoryIcon'
import { MockActionPanel } from '@/components/common/MockActionPanel'
import { Badge, Button, Card, Input, Label, Progress, Separator } from '@/components/ui'
import { useBudgets, useCategories, useTransactions } from '@/hooks/useQueries'
import { formatMoney, toCents } from '@/lib/format'
import {
  deriveBudgetProgressForDate,
  getBudgetCycle,
  selectApplicableBudgets,
} from '@/lib/budget-period'
import { today } from '@/lib/date'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import type { BudgetPeriod, Cents, Category, Transaction } from '@/types'

const periodLabel: Record<BudgetPeriod, string> = {
  weekly: 'Semanal',
  monthly: 'Mensual',
  yearly: 'Anual',
}

const monthFormatter = new Intl.DateTimeFormat('es-MX', {
  month: 'long',
  year: 'numeric',
})

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

function localDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function monthKeyForDate(date: Date) {
  return localDateKey(new Date(date.getFullYear(), date.getMonth(), 1)).slice(0, 7)
}

function shiftMonth(monthKey: string, delta: number) {
  const [year, month] = monthKey.split('-').map(Number)
  return monthKeyForDate(new Date(year, month - 1 + delta, 1))
}

function monthEnd(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number)
  return localDateKey(new Date(year, month, 0))
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number)
  return monthFormatter.format(new Date(year, month - 1, 1))
}

function getUnbudgetedSpending(
  transactions: Transaction[],
  categories: Category[],
  budgetedCategoryIds: Set<string>,
  hasGlobalBudget: boolean,
  monthStart: string,
  asOf: string,
) {
  if (hasGlobalBudget) return []
  const spentByCategory = new Map<string, Cents>()

  for (const transaction of transactions) {
    if (
      transaction.type !== 'expense' ||
      !transaction.categoryId ||
      transaction.date < monthStart ||
      transaction.date > asOf ||
      budgetedCategoryIds.has(transaction.categoryId)
    ) {
      continue
    }

    spentByCategory.set(
      transaction.categoryId,
      (spentByCategory.get(transaction.categoryId) ?? 0) + transaction.amount,
    )
  }

  return [...spentByCategory.entries()]
    .map(([categoryId, spent]) => ({
      category: categories.find((category) => category.id === categoryId),
      spent,
    }))
    .filter((item): item is { category: Category; spent: Cents } => Boolean(item.category))
    .sort((a, b) => b.spent - a.spent)
}

export default function BudgetsPage() {
  const [isBudgetPanelOpen, setIsBudgetPanelOpen] = useState(false)
  const currentDate = today()
  const currentMonthKey = currentDate.slice(0, 7)
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey)
  const previousCurrentMonth = useRef(currentMonthKey)
  const budgetsQuery = useBudgets()
  const transactionsQuery = useTransactions()
  const categoriesQuery = useCategories()
  const queryClient = useQueryClient()

  const [fCategory, setFCategory] = useState('')
  const [fLimit, setFLimit] = useState('')
  const [fPeriod, setFPeriod] = useState<BudgetPeriod>('monthly')
  const [limitValidationError, setLimitValidationError] = useState(false)

  useEffect(() => {
    const previous = previousCurrentMonth.current
    if (previous === currentMonthKey) return
    previousCurrentMonth.current = currentMonthKey
    setSelectedMonth((selected) => (selected === previous ? currentMonthKey : selected))
  }, [currentMonthKey])

  const createMut = useMutation({
    mutationFn: api.createBudget,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.budgets })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
  })

  const openPanel = () => {
    createMut.reset()
    setFCategory('')
    setFLimit('')
    setFPeriod('monthly')
    setLimitValidationError(false)
    setIsBudgetPanelOpen(true)
  }

  const closePanel = () => {
    createMut.reset()
    setLimitValidationError(false)
    setIsBudgetPanelOpen(false)
  }

  const handleSubmit = () => {
    const amount = toCents(fLimit)
    if (amount <= 0) {
      setLimitValidationError(true)
      return
    }
    setLimitValidationError(false)
    createMut.reset()
    createMut.mutate(
      {
        categoryId: fCategory || null,
        amount,
        period: fPeriod,
        startDate: today(),
      },
      { onSuccess: closePanel },
    )
  }

  const isLoading =
    budgetsQuery.isLoading || transactionsQuery.isLoading || categoriesQuery.isLoading

  if (isLoading) {
    return (
      <>
        <Header
          title="Presupuestos"
          subtitle="Límites por categoría"
          action={
            <Button size="sm" onClick={() => openPanel()}>
              Crear
            </Button>
          }
        />
        <div className="space-y-3 py-4">
          <Card className="h-24 animate-pulse bg-muted/40" />
          <Card className="h-28 animate-pulse bg-muted/40" />
          <Card className="h-28 animate-pulse bg-muted/40" />
        </div>
      </>
    )
  }

  if (budgetsQuery.isError || transactionsQuery.isError || categoriesQuery.isError) {
    return (
      <>
        <Header title="Presupuestos" subtitle="Límites por categoría" />
        <div role="alert" className="py-10 text-center text-sm text-destructive">
          No se pudieron cargar los presupuestos.
        </div>
      </>
    )
  }

  const budgets = budgetsQuery.data ?? []
  const transactions = transactionsQuery.data ?? []
  const categories = categoriesQuery.data ?? []
  const budgetError = createMut.error
    ? 'No se pudo crear el presupuesto. Intenta de nuevo.'
    : limitValidationError
      ? 'Ingresa un límite mayor a cero.'
      : null
  const budgetPanel = (
    <MockActionPanel
      open={isBudgetPanelOpen}
      title="Crear presupuesto"
      description="Define límite, categoría y periodo."
      submitLabel="Crear"
      submitting={createMut.isPending}
      onClose={closePanel}
      onSubmit={handleSubmit}
    >
      <div className="space-y-1.5">
        <Label htmlFor="budget-category">Categoría</Label>
        <select
          id="budget-category"
          className="h-8 w-full rounded-[7px] border border-input bg-background px-2.5 text-[13px] focus-visible:border-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
          value={fCategory}
          onChange={(e) => setFCategory(e.target.value)}
        >
          <option value="">General (sin categoría)</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="budget-limit">Límite</Label>
          <Input
            id="budget-limit"
            placeholder="$0.00"
            inputMode="decimal"
            value={fLimit}
            aria-invalid={Boolean(budgetError)}
            aria-describedby={budgetError ? 'budget-limit-error' : undefined}
            onChange={(e) => {
              setFLimit(e.target.value)
              setLimitValidationError(false)
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="budget-period">Periodo</Label>
          <select
            id="budget-period"
            className="h-8 w-full rounded-[7px] border border-input bg-background px-2.5 text-[13px] focus-visible:border-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
            value={fPeriod}
            onChange={(e) => setFPeriod(e.target.value as BudgetPeriod)}
          >
            <option value="monthly">Mensual</option>
            <option value="weekly">Semanal</option>
            <option value="yearly">Anual</option>
          </select>
        </div>
      </div>
      {budgetError && (
        <p id="budget-limit-error" role="alert" className="text-xs text-destructive">
          {budgetError}
        </p>
      )}
    </MockActionPanel>
  )

  if (budgets.length === 0) {
    return (
      <>
        <Header
          title="Presupuestos"
          subtitle="Límites por categoría"
          action={
            <Button size="sm" onClick={() => openPanel()}>
              Crear
            </Button>
          }
        />
        <div className="py-4">
          <EmptyState
            title="Sin presupuestos"
            description="Crea un presupuesto para trackear tu gasto por categoría."
            action={
              <Button size="sm" onClick={() => openPanel()}>
                Crear presupuesto
              </Button>
            }
          />
        </div>
        {budgetPanel}
      </>
    )
  }

  const categoryMap = new Map(categories.map((category) => [category.id, category]))
  const selectedAsOf = selectedMonth === currentMonthKey ? currentDate : monthEnd(selectedMonth)
  const activeBudgets = deriveBudgetProgressForDate(budgets, transactions, selectedAsOf).filter(
    (budget) => getBudgetCycle(budget, selectedAsOf) !== null,
  )
  const applicableBudgets = selectApplicableBudgets(activeBudgets, selectedAsOf).sort((a, b) => {
    const aExceeded = a.progress > 1
    const bExceeded = b.progress > 1
    if (aExceeded !== bExceeded) return aExceeded ? -1 : 1
    return b.progress - a.progress
  })
  const totalSpent = applicableBudgets.reduce((sum, budget) => sum + budget.spent, 0)
  const totalLimit = applicableBudgets.reduce((sum, budget) => sum + budget.amount, 0)
  const totalRemaining = totalLimit - totalSpent
  const totalProgress = totalLimit > 0 ? totalSpent / totalLimit : 0
  const exceededBudgets = applicableBudgets.filter((budget) => budget.progress > 1)
  const nearLimitBudgets = applicableBudgets.filter(
    (budget) => budget.progress >= 0.8 && budget.progress <= 1,
  )
  const criticalBudgets = [...exceededBudgets, ...nearLimitBudgets].slice(0, 3)
  const budgetedCategoryIds = new Set(
    applicableBudgets
      .map((budget) => budget.categoryId)
      .filter((categoryId): categoryId is string => Boolean(categoryId)),
  )
  const unbudgetedSpending = getUnbudgetedSpending(
    transactions,
    categories,
    budgetedCategoryIds,
    applicableBudgets.some((budget) => budget.categoryId === null),
    `${selectedMonth}-01`,
    selectedAsOf,
  )

  return (
    <>
      <Header
        title="Presupuestos"
        subtitle="Límites por categoría"
        action={
          <Button size="sm" onClick={() => openPanel()}>
            Crear
          </Button>
        }
      />
      <div className="space-y-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Mes anterior"
              onClick={() => setSelectedMonth((month) => shiftMonth(month, -1))}
            >
              <ChevronLeft />
            </Button>
            <div className="min-w-32 text-center">
              <p className="text-xs font-medium text-muted-foreground">Periodo</p>
              <time
                dateTime={`${selectedMonth}-01`}
                aria-live="polite"
                className="text-sm font-semibold capitalize"
              >
                {formatMonthLabel(selectedMonth)}
              </time>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Mes siguiente"
              disabled={selectedMonth >= currentMonthKey}
              onClick={() => setSelectedMonth((month) => shiftMonth(month, 1))}
            >
              <ChevronRight />
            </Button>
          </div>
          <Badge
            variant={totalRemaining < 0 || applicableBudgets.length === 0 ? 'outline' : 'muted'}
            className={totalRemaining < 0 ? 'border-destructive text-destructive' : undefined}
          >
            {applicableBudgets.length === 0
              ? 'Sin presupuestos'
              : totalRemaining < 0
                ? 'Excedido'
                : 'En control'}
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr_1fr]">
          <Card className="p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Gasto del periodo</p>
                <Amount value={totalSpent} size="lg" className="mt-1 block" />
              </div>
              <div className="text-right">
                <p className="text-[11px] text-muted-foreground">Presupuestado</p>
                <p className="mt-1 text-sm font-semibold tabular-nums">{formatMoney(totalLimit)}</p>
                <p
                  className={`mt-1 text-xs font-medium tabular-nums ${
                    totalProgress > 1 ? 'text-destructive' : 'text-muted-foreground'
                  }`}
                >
                  {formatPercent(totalProgress)} usado
                </p>
              </div>
            </div>
            <Progress
              value={totalProgress}
              variant={totalProgress > 1 ? 'warning' : 'default'}
              aria-label="Uso total del presupuesto"
              className="mt-4"
            />
            <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-md bg-muted/40 p-2">
                <p className="text-muted-foreground">Restante</p>
                <p
                  className={
                    totalRemaining < 0
                      ? 'mt-1 font-semibold tabular-nums text-destructive'
                      : 'mt-1 font-semibold tabular-nums'
                  }
                >
                  {formatMoney(Math.abs(totalRemaining))}
                </p>
              </div>
              <div className="rounded-md bg-muted/40 p-2">
                <p className="text-muted-foreground">Excedidas</p>
                <p
                  className={
                    exceededBudgets.length > 0
                      ? 'mt-1 font-semibold tabular-nums text-destructive'
                      : 'mt-1 font-semibold tabular-nums'
                  }
                >
                  {exceededBudgets.length}
                </p>
              </div>
              <div className="rounded-md bg-muted/40 p-2">
                <p className="text-muted-foreground">Cerca</p>
                <p className="mt-1 font-semibold tabular-nums">{nearLimitBudgets.length}</p>
              </div>
            </div>
          </Card>

          <Card className="p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Atención</p>
                <p className="text-xs text-muted-foreground">Categorías críticas del periodo.</p>
              </div>
              <Badge variant="muted">{criticalBudgets.length}</Badge>
            </div>
            <div className="mt-3 space-y-2.5">
              {criticalBudgets.length === 0 ? (
                <p className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                  No hay categorías excedidas o cerca del límite.
                </p>
              ) : (
                criticalBudgets.map((budget) => {
                  const category = budget.categoryId
                    ? categoryMap.get(budget.categoryId)
                    : undefined
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
                          <span className="truncate font-medium">
                            {category?.name ?? 'General'}
                          </span>
                          <span
                            className={
                              isExceeded
                                ? 'shrink-0 tabular-nums text-destructive'
                                : 'shrink-0 tabular-nums text-muted-foreground'
                            }
                          >
                            {formatPercent(budget.progress)}
                          </span>
                        </div>
                        <Progress
                          value={budget.progress}
                          variant={isExceeded ? 'warning' : 'default'}
                          accent={isExceeded ? undefined : category?.color}
                          aria-label={`Uso del presupuesto de ${category?.name ?? 'General'}`}
                          className="mt-1.5"
                        />
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </Card>
        </div>

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Ranking por categoría</p>
              <p className="text-xs text-muted-foreground">Ordenado por prioridad financiera.</p>
            </div>
            <Badge variant="muted">{applicableBudgets.length}</Badge>
          </div>
          {applicableBudgets.length === 0 ? (
            <Card className="p-3 text-xs text-muted-foreground">
              Sin presupuestos activos en este periodo.
            </Card>
          ) : (
            applicableBudgets.map((budget) => {
              const category = budget.categoryId ? categoryMap.get(budget.categoryId) : undefined
              const isExceeded = budget.remaining < 0
              const isNearLimit = !isExceeded && budget.progress >= 0.8
              const status = isExceeded ? 'Excedido' : isNearLimit ? 'Cerca' : 'Bien'
              const statusVariant = isExceeded ? 'outline' : isNearLimit ? 'secondary' : 'muted'

              return (
                <Card key={budget.id} className="p-3">
                  <div className="flex items-start gap-3">
                    <CategoryIcon
                      name={category?.icon ?? 'HelpCircle'}
                      color={category?.color ?? 'gray'}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {category?.name ?? 'General'}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {periodLabel[budget.period]}
                          </p>
                        </div>
                        <Badge
                          variant={statusVariant}
                          className={isExceeded ? 'border-destructive text-destructive' : undefined}
                        >
                          {status}
                        </Badge>
                      </div>

                      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <p className="text-muted-foreground">Gastado</p>
                          <p className="mt-0.5 font-medium tabular-nums">
                            {formatMoney(budget.spent)}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Límite</p>
                          <p className="mt-0.5 font-medium tabular-nums">
                            {formatMoney(budget.amount)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-muted-foreground">
                            {isExceeded ? 'Excedido' : 'Restante'}
                          </p>
                          <p
                            className={`mt-0.5 font-medium tabular-nums ${
                              isExceeded ? 'text-destructive' : ''
                            }`}
                          >
                            {formatMoney(Math.abs(budget.remaining))}
                          </p>
                        </div>
                      </div>

                      <div className="mt-3 flex items-center gap-2">
                        <Progress
                          value={budget.progress}
                          variant={isExceeded ? 'warning' : 'default'}
                          accent={isExceeded ? undefined : category?.color}
                          aria-label={`Uso del presupuesto de ${category?.name ?? 'General'}`}
                          className="flex-1"
                        />
                        <span
                          className={`w-11 shrink-0 text-right text-[11px] tabular-nums ${
                            isExceeded ? 'text-destructive' : 'text-muted-foreground'
                          }`}
                        >
                          {formatPercent(budget.progress)}
                        </span>
                      </div>
                    </div>
                  </div>
                </Card>
              )
            })
          )}
        </section>

        {unbudgetedSpending.length > 0 && (
          <Card className="p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Sin presupuesto</p>
                <p className="text-xs text-muted-foreground">
                  Categorías con gasto en este periodo fuera de tus límites.
                </p>
              </div>
              <Badge variant="muted">{unbudgetedSpending.length}</Badge>
            </div>
            <Separator className="my-3" />
            <div className="space-y-2">
              {unbudgetedSpending.map(({ category, spent }) => (
                <div key={category.id} className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <CategoryIcon name={category.icon} color={category.color} className="h-7 w-7" />
                    <span className="truncate text-sm">{category.name}</span>
                  </div>
                  <span className="shrink-0 text-sm font-medium tabular-nums">
                    {formatMoney(spent)}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {budgetPanel}
    </>
  )
}
