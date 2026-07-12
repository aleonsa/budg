import { Card, Badge } from '@/components/ui'
import { formatMoney } from '@/lib/format'
import type { Cents } from '@/types'
import { cn } from '@/lib/utils'

interface BalanceHeroProps {
  balance: Cents
  debt: Cents
}

export function BalanceHero({ balance, debt }: BalanceHeroProps) {
  const net = balance - debt

  return (
    <Card>
      <div className="p-4">
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground">Patrimonio neto</p>
          <Badge accent="green">Total</Badge>
        </div>
        <p
          className={cn(
            'mt-1 text-3xl font-semibold tabular-nums tracking-tight',
            net >= 0 ? 'text-[hsl(var(--color-green))]' : 'text-[hsl(var(--color-red))]',
          )}
        >
          {formatMoney(net)}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-md bg-[hsl(var(--color-green-soft))] px-3 py-2">
            <p className="text-[11px] text-[hsl(var(--color-green))]">Efectivo y débito</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-[hsl(var(--color-green))]">
              {formatMoney(balance)}
            </p>
          </div>
          <div className="rounded-md bg-[hsl(var(--color-red-soft))] px-3 py-2">
            <p className="text-[11px] text-[hsl(var(--color-red))]">Deuda tarjetas</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-[hsl(var(--color-red))]">
              {formatMoney(debt)}
            </p>
          </div>
        </div>
      </div>
    </Card>
  )
}
