import { Header } from '@/components/layout/Header'
import { Card, Badge, Progress } from '@/components/ui'
import { EmptyState } from '@/components/common/EmptyState'
import { CategoryIcon } from '@/components/common/CategoryIcon'
import { formatMoney } from '@/lib/format'
import { useCategories, useTransactions, useBudgets } from '@/hooks/useQueries'
import type { Category, Transaction, Budget, Cents } from '@/types'

// ── Local helpers ────────────────────────────────────────────

/** Find the latest month key "YYYY-MM" from transactions. */
function latestMonthKey(txs: Transaction[]): string {
  if (txs.length === 0) return new Date().toISOString().slice(0, 7)
  return txs.reduce((latest, t) => (t.date > latest ? t.date : latest), txs[0].date).slice(0, 7)
}

/** Sum expenses in a month for a given category. */
function spentInMonth(txs: Transaction[], monthKey: string, categoryId: string): Cents {
  return txs
    .filter((t) => t.type === 'expense' && t.categoryId === categoryId && t.date.startsWith(monthKey))
    .reduce((s, t) => s + t.amount, 0)
}

/** Sum income in a month for a given category. */
function incomeInMonth(txs: Transaction[], monthKey: string, categoryId: string): Cents {
  return txs
    .filter((t) => t.type === 'income' && t.categoryId === categoryId && t.date.startsWith(monthKey))
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
  budgetProgress,
}: {
  category: Category
  spent: Cents
  budget?: Budget
  budgetProgress?: number
}) {
  const hasBudget = !!budget
  const overBudget = (budgetProgress ?? 0) > 1

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
              value={budgetProgress ?? 0}
              variant={overBudget ? 'warning' : 'default'}
              accent={overBudget ? undefined : category.color}
              className="h-1 flex-1"
            />
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {formatMoney(spent)} / {formatMoney(budget!.amount)}
            </span>
          </div>
        )}
      </div>
      <div className="shrink-0 text-right">
        {spent > 0 ? (
          <>
            <p className="text-xs font-medium tabular-nums">
              {formatMoney(spent)}
            </p>
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
  const catQ = useCategories()
  const txQ = useTransactions()
  const budQ = useBudgets()

  const isLoading = catQ.isLoading || txQ.isLoading || budQ.isLoading

  if (isLoading) {
    return (
      <>
        <Header title="Categorías" subtitle="Clasificación de transacciones" />
        <div className="flex h-64 items-center justify-center">
          <span className="text-xs text-muted-foreground">Cargando…</span>
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
        <Header title="Categorías" subtitle="Clasificación de transacciones" />
        <div className="py-4">
          <EmptyState
            title="Sin categorías"
            description="No hay categorías configuradas todavía."
          />
        </div>
      </>
    )
  }

  const monthKey = latestMonthKey(transactions)
  const monthLabel = formatMonthLabel(monthKey)

  const expenseCats = categories.filter((c) => c.kind === 'expense').sort((a, b) => a.order - b.order)
  const incomeCats = categories.filter((c) => c.kind === 'income').sort((a, b) => a.order - b.order)
  const budgetByCat = new Map(budgets.map((b) => [b.categoryId, b]))

  // Max spending for progress scaling
  const expenseSpent = expenseCats.map((c) => spentInMonth(transactions, monthKey, c.id))
  const maxExpense = Math.max(...expenseSpent, 1)

  return (
    <>
      <Header title="Categorías" subtitle="Clasificación de transacciones" />
      <div className="space-y-5 py-4">
        {/* Summary */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatChip label="Total" value={categories.length} />
          <StatChip label="Gasto" value={expenseCats.length} accent="red" />
          <StatChip label="Ingreso" value={incomeCats.length} accent="green" />
          <StatChip label="Con presupuesto" value={budgets.length} accent="blue" />
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
              const progress = budget ? spent / budget.amount : spent / maxExpense
              return (
                <CategoryRow
                  key={cat.id}
                  category={cat}
                  spent={spent}
                  budget={budget}
                  budgetProgress={progress}
                />
              )
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
              return (
                <CategoryRow
                  key={cat.id}
                  category={cat}
                  spent={income}
                />
              )
            })}
          </Card>
        </div>
      </div>
    </>
  )
}
