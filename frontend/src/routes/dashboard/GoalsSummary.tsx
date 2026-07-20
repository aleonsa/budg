import { Link } from 'react-router-dom'
import { Card, Progress } from '@/components/ui'
import { formatMoney } from '@/lib/format'
import type { SavingsGoalWithProgress, AccentColor } from '@/types'

const GOAL_COLORS: AccentColor[] = ['green', 'blue', 'purple', 'orange', 'cyan']

interface GoalsSummaryProps {
  goals: SavingsGoalWithProgress[]
}

export function GoalsSummary({ goals }: GoalsSummaryProps) {
  const active = goals.filter((g) => !g.isCompleted)
  if (active.length === 0) return null

  return (
    <Card>
      <div className="p-4">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Metas activas
        </h3>

        <div className="mt-3 space-y-3">
          {active.map((goal, idx) => {
            const color = GOAL_COLORS[idx % GOAL_COLORS.length]
            const isComplete = goal.progress >= 1
            return (
              <div key={goal.id}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{goal.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatMoney(goal.currentAmount)} / {formatMoney(goal.targetAmount)}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <Progress
                    value={goal.progress}
                    variant={isComplete ? 'success' : 'default'}
                    accent={isComplete ? undefined : color}
                    className="flex-1"
                  />
                  <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                    {Math.round(goal.progress * 100)}%
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        <Link
          to="/goals"
          className="mt-3 block text-xs text-muted-foreground hover:text-foreground"
        >
          Ver todas las metas →
        </Link>
      </div>
    </Card>
  )
}
