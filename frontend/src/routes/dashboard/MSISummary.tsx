import { Link } from 'react-router-dom'
import { Card, Badge } from '@/components/ui'

import { formatMoney } from '@/lib/format'
import type { MSIPurchase } from '@/types'

// Cycle through accent colors for MSI items
const MSI_COLORS = ['purple', 'blue', 'cyan', 'orange', 'pink'] as const

interface MSISummaryProps {
  purchases: MSIPurchase[]
}

export function MSISummary({ purchases }: MSISummaryProps) {
  const active = purchases.filter((p) => p.status === 'active')

  if (active.length === 0) return null

  return (
    <Card>
      <div className="p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            MSI activos
          </h3>
          <Badge accent="purple">{active.length}</Badge>
        </div>

        <div className="mt-3 space-y-3">
          {active.map((purchase, idx) => {
            const remaining = purchase.installmentCount - purchase.installmentsPaid
            const pct = (purchase.installmentCount - remaining) / purchase.installmentCount
            const color = MSI_COLORS[idx % MSI_COLORS.length]
            const colorSoftClass = {
              purple: 'bg-[hsl(var(--color-purple))]',
              blue: 'bg-[hsl(var(--color-blue))]',
              cyan: 'bg-[hsl(var(--color-cyan))]',
              orange: 'bg-[hsl(var(--color-orange))]',
              pink: 'bg-[hsl(var(--color-pink))]',
            }[color]

            return (
              <div key={purchase.id} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className={`h-2 w-2 shrink-0 rounded-full ${colorSoftClass}`} />
                      <span className="truncate text-sm font-medium">{purchase.description}</span>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {formatMoney(purchase.installmentAmount)}/mes
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${colorSoftClass}`}
                        style={{ width: `${pct * 100}%` }}
                      />
                    </div>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {remaining}/{purchase.installmentCount} restan
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <Link
          to="/accounts"
          className="mt-3 block text-xs text-muted-foreground hover:text-foreground"
        >
          Ver tarjetas →
        </Link>
      </div>
    </Card>
  )
}
