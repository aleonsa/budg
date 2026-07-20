import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Header } from '@/components/layout/Header'
import { Card, Badge, Progress, Button, Input, Label } from '@/components/ui'
import { EmptyState } from '@/components/common/EmptyState'
import { CategoryIcon } from '@/components/common/CategoryIcon'
import { MockActionPanel } from '@/components/common/MockActionPanel'
import { formatMoney } from '@/lib/format'
import { deriveBudgetProgressForDate, getBudgetCycle } from '@/lib/budget-period'
import { today } from '@/lib/date'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { useCategories, useTransactions, useBudgets } from '@/hooks/useQueries'
import type {
  AccentColor,
  BudgetWithProgress,
  Category,
  CategoryKind,
  Cents,
  Transaction,
} from '@/types'

const COLOR_OPTIONS: AccentColor[] = [
  'blue',
  'green',
  'red',
  'purple',
  'yellow',
  'orange',
  'cyan',
  'pink',
  'gray',
]

// ── Local helpers ────────────────────────────────────────────

/** Find the latest month key "YYYY-MM" from transactions. */
function latestMonthKey(txs: Transaction[]): string {
  const activity = txs.filter((t) => t.type !== 'transfer')
  if (activity.length === 0) return today().slice(0, 7)
  return activity
    .reduce((latest, t) => (t.date > latest ? t.date : latest), activity[0].date)
    .slice(0, 7)
}

/** Sum expenses in a month for a given category. */
function spentInMonth(txs: Transaction[], monthKey: string, categoryId: string): Cents {
  return txs
    .filter(
      (t) => t.type === 'expense' && t.categoryId === categoryId && t.date.startsWith(monthKey),
    )
    .reduce((s, t) => s + t.amount, 0)
}

/** Sum income in a month for a given category. */
function incomeInMonth(txs: Transaction[], monthKey: string, categoryId: string): Cents {
  return txs
    .filter(
      (t) => t.type === 'income' && t.categoryId === categoryId && t.date.startsWith(monthKey),
    )
    .reduce((s, t) => s + t.amount, 0)
}

function formatMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })
}

// ── Sub-components ───────────────────────────────────────────

function StatChip({
  label,
  value,
  accent,
}: {
  label: string
  value: string | number
  accent?: 'green' | 'red' | 'blue' | 'purple'
}) {
  const colorClass = accent
    ? {
        green: 'text-[hsl(var(--color-green))]',
        red: 'text-[hsl(var(--color-red))]',
        blue: 'text-[hsl(var(--color-blue))]',
        purple: 'text-[hsl(var(--color-purple))]',
      }[accent]
    : 'text-foreground'

  return (
    <div className="rounded-md border border-border px-2.5 py-1.5">
      <p className="text-[10px] leading-tight text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold tabular-nums leading-tight ${colorClass}`}>
        {value}
      </p>
    </div>
  )
}

function CategoryRow({
  category,
  spent,
  budget,
}: {
  category: Category
  spent: Cents
  budget?: BudgetWithProgress
}) {
  const hasBudget = !!budget
  const overBudget = (budget?.progress ?? 0) > 1

  return (
    <div className="flex items-center gap-3 py-2.5">
      <CategoryIcon name={category.icon} color={category.color} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{category.name}</span>
          {category.isSystem && (
            <Badge variant="muted" className="shrink-0">
              Sistema
            </Badge>
          )}
        </div>
        {hasBudget && (
          <div className="mt-1 flex items-center gap-2">
            <Progress
              value={budget?.progress ?? 0}
              variant={overBudget ? 'warning' : 'default'}
              accent={overBudget ? undefined : category.color}
              aria-label={`Uso del presupuesto de ${category.name}`}
              className="h-1 flex-1"
            />
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {formatMoney(budget!.spent)} / {formatMoney(budget!.amount)}
            </span>
          </div>
        )}
      </div>
      <div className="shrink-0 text-right">
        {spent > 0 ? (
          <>
            <p className="text-xs font-medium tabular-nums">{formatMoney(spent)}</p>
            <p className="text-[10px] text-muted-foreground">este mes</p>
          </>
        ) : (
          <span className="text-[11px] text-muted-foreground">Sin movimiento</span>
        )}
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────

export default function CategoriesPage() {
  const [isCategoryPanelOpen, setIsCategoryPanelOpen] = useState(false)
  const catQ = useCategories()
  const txQ = useTransactions()
  const budQ = useBudgets()
  const queryClient = useQueryClient()

  const [fName, setFName] = useState('')
  const [fKind, setFKind] = useState<CategoryKind>('expense')
  const [fColor, setFColor] = useState<AccentColor>('blue')
  const [fIcon, setFIcon] = useState('Tag')
  const [formError, setFormError] = useState('')

  const createMut = useMutation({
    mutationFn: api.createCategory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.categories })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
  })

  const openPanel = () => {
    createMut.reset()
    setFName('')
    setFKind('expense')
    setFColor('blue')
    setFIcon('Tag')
    setFormError('')
    setIsCategoryPanelOpen(true)
  }

  const handleSubmit = () => {
    if (!fName.trim()) {
      setFormError('Ingresa un nombre para la categoría.')
      return
    }
    createMut.reset()
    createMut.mutate(
      {
        name: fName.trim(),
        kind: fKind,
        color: fColor,
        icon: fIcon || 'Tag',
        parentId: null,
      },
      { onSuccess: () => setIsCategoryPanelOpen(false) },
    )
  }

  const isLoading = catQ.isLoading || txQ.isLoading || budQ.isLoading

  const categoryPanel = (
    <MockActionPanel
      open={isCategoryPanelOpen}
      title="Crear categoría"
      description="Configura una categoría para gastos o ingresos."
      submitLabel="Crear"
      submitting={createMut.isPending}
      onClose={() => {
        createMut.reset()
        setIsCategoryPanelOpen(false)
      }}
      onSubmit={handleSubmit}
    >
      <div className="space-y-1.5">
        <Label htmlFor="category-name">Nombre</Label>
        <Input
          id="category-name"
          placeholder="Ej. Mascotas"
          value={fName}
          aria-invalid={Boolean(formError)}
          aria-describedby={formError ? 'category-name-error' : undefined}
          onChange={(e) => {
            setFName(e.target.value)
            if (formError) setFormError('')
          }}
        />
        {formError && (
          <p id="category-name-error" role="alert" className="text-xs text-destructive">
            {formError}
          </p>
        )}
        {createMut.isError && (
          <p role="alert" className="text-xs text-destructive">
            {createMut.error instanceof Error
              ? createMut.error.message
              : 'No se pudo crear la categoría.'}
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="category-kind">Tipo</Label>
          <select
            id="category-kind"
            className="h-8 w-full rounded-[7px] border border-input bg-background px-2.5 text-[13px] focus-visible:border-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
            value={fKind}
            onChange={(e) => setFKind(e.target.value as CategoryKind)}
          >
            <option value="expense">Gasto</option>
            <option value="income">Ingreso</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="category-color">Color</Label>
          <select
            id="category-color"
            className="h-8 w-full rounded-[7px] border border-input bg-background px-2.5 text-[13px] focus-visible:border-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
            value={fColor}
            onChange={(e) => setFColor(e.target.value as AccentColor)}
          >
            {COLOR_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c.charAt(0).toUpperCase() + c.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="category-icon">Icono (nombre lucide)</Label>
        <Input
          id="category-icon"
          placeholder="Ej. UtensilsCrossed, Car, Film"
          value={fIcon}
          onChange={(e) => setFIcon(e.target.value)}
        />
      </div>
    </MockActionPanel>
  )

  if (isLoading) {
    return (
      <>
        <Header
          title="Categorías"
          subtitle="Clasificación de transacciones"
          action={
            <Button size="sm" onClick={() => openPanel()}>
              Crear
            </Button>
          }
        />
        <div className="flex h-64 items-center justify-center">
          <span className="text-xs text-muted-foreground">Cargando…</span>
        </div>
        {categoryPanel}
      </>
    )
  }

  if (catQ.isError || txQ.isError || budQ.isError) {
    return (
      <>
        <Header title="Categorías" subtitle="Clasificación de transacciones" />
        <div role="alert" className="py-10 text-center text-sm text-destructive">
          No se pudieron cargar las categorías.
        </div>
      </>
    )
  }

  const categories = catQ.data ?? []
  const transactions = txQ.data ?? []
  const budgets = budQ.data ?? []

  if (categories.length === 0) {
    return (
      <>
        <Header
          title="Categorías"
          subtitle="Clasificación de transacciones"
          action={
            <Button size="sm" onClick={() => openPanel()}>
              Crear
            </Button>
          }
        />
        <div className="py-4">
          <EmptyState
            title="Sin categorías"
            description="No hay categorías configuradas todavía."
            action={
              <Button size="sm" onClick={() => openPanel()}>
                Crear categoría
              </Button>
            }
          />
        </div>
        {categoryPanel}
      </>
    )
  }

  const monthKey = latestMonthKey(transactions)
  const monthLabel = formatMonthLabel(monthKey)

  const expenseCats = categories
    .filter((c) => c.kind === 'expense')
    .sort((a, b) => a.order - b.order)
  const incomeCats = categories.filter((c) => c.kind === 'income').sort((a, b) => a.order - b.order)
  const categoryIds = new Set(categories.map((category) => category.id))
  const asOf = today()
  const budgetByCat = new Map<string, BudgetWithProgress>()
  for (const budget of deriveBudgetProgressForDate(budgets, transactions, asOf)) {
    if (
      !budget.categoryId ||
      !categoryIds.has(budget.categoryId) ||
      getBudgetCycle(budget, asOf) === null
    ) {
      continue
    }
    const selected = budgetByCat.get(budget.categoryId)
    if (
      !selected ||
      budget.startDate > selected.startDate ||
      (budget.startDate === selected.startDate && budget.id > selected.id)
    ) {
      budgetByCat.set(budget.categoryId, budget)
    }
  }
  const categorizedBudgetCount = budgetByCat.size

  return (
    <>
      <Header
        title="Categorías"
        subtitle="Clasificación de transacciones"
        action={
          <Button size="sm" onClick={() => openPanel()}>
            Crear
          </Button>
        }
      />
      <div className="space-y-3.5 py-3">
        {/* Summary */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatChip label="Total" value={categories.length} />
          <StatChip label="Gasto" value={expenseCats.length} accent="red" />
          <StatChip label="Ingreso" value={incomeCats.length} accent="green" />
          <StatChip label="Con presupuesto" value={categorizedBudgetCount} accent="blue" />
        </div>

        {/* Expense categories */}
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Gasto · {expenseCats.length}
            </h2>
            <span className="text-[11px] text-muted-foreground">{monthLabel}</span>
          </div>
          <Card className="divide-y divide-border px-3">
            {expenseCats.map((cat) => {
              const spent = spentInMonth(transactions, monthKey, cat.id)
              const budget = budgetByCat.get(cat.id)
              return <CategoryRow key={cat.id} category={cat} spent={spent} budget={budget} />
            })}
          </Card>
        </div>

        {/* Income categories */}
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Ingreso · {incomeCats.length}
            </h2>
          </div>
          <Card className="divide-y divide-border px-3">
            {incomeCats.map((cat) => {
              const income = incomeInMonth(transactions, monthKey, cat.id)
              return <CategoryRow key={cat.id} category={cat} spent={income} />
            })}
          </Card>
        </div>

        {categoryPanel}
      </div>
    </>
  )
}
