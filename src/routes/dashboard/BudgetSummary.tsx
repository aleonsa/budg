import { Link } from 'react-router-dom'
import { Card } from '@/components/ui'
import { Progress } from '@/components/ui'
import { Amount } from '@/components/common/Amount'
import { formatMoney } from '@/lib/format'
import type { BudgetWithProgress, Category } from '@/types'

interface BudgetSummaryProps {
  budgets: BudgetWithProgress[]
  categories: Map<string, Category>
  monthSpent: number
}

export function BudgetSummary({ budgets, categories, monthSpent }: BudgetSummaryProps) {
  const totalLimit = budgets.reduce((s, b) => s + b.amount, 0)
  const overallProgress = totalLimit > 0 ? monthSpent / totalLimit : 0

  return (
    <Card>
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Gasto del mes</p>
            <Amount value={monthSpent} size="lg" className="mt-0.5 block" />
          </div>
          <div className="text-right">
            <p className="text-[11px] text-muted-foreground">de {formatMoney(totalLimit)}</p>
            <p
              className={`mt-0.5 text-sm font-medium tabular-nums ${
                overallProgress > 1 ? 'text-destructive' : 'text-muted-foreground'
              }`}
            >
              {Math.round(overallProgress * 100)}%
            </p>
          </div>
        </div>

        <Progress
          value={overallProgress}
          variant={overallProgress > 1 ? 'warning' : 'default'}
          className="mt-3"
        />

        {/* Top categories by budget */}
        <div className="mt-4 space-y-2">
          {budgets.slice(0, 3).map((budget) => {
            const cat = budget.categoryId ? categories.get(budget.categoryId) : null
            const overBudget = budget.progress > 1
            return (
              <div key={budget.id} className="flex items-center gap-3">
                <span className="w-20 shrink-0 truncate text-xs text-muted-foreground">
                  {cat?.name ?? 'General'}
                </span>
                <Progress
                  value={budget.progress}
                  variant={overBudget ? 'warning' : 'default'}
                  accent={overBudget ? undefined : cat?.color}
                  className="flex-1"
                />
                <span className="w-16 shrink-0 text-right text-xs tabular-nums">
                  {formatMoney(budget.spent)}
                </span>
              </div>
            )
          })}
        </div>

        <Link
          to="/budgets"
          className="mt-3 block text-xs text-muted-foreground hover:text-foreground"
        >
          Ver todos los presupuestos →
        </Link>
      </div>
    </Card>
  )
}
