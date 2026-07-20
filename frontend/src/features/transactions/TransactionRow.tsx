import { CategoryIcon } from '@/components/common/CategoryIcon'
import { Amount } from '@/components/common/Amount'
import { Badge } from '@/components/ui'
import { formatMoney } from '@/lib/format'
import type { Transaction, Category, Account } from '@/types'

interface TransactionRowProps {
  transaction: Transaction
  category?: Category
  account?: Account
  showAccount?: boolean
  onClick?: () => void
}

/** Single transaction row — used in lists, search results, etc. */
export function TransactionRow({
  transaction: tx,
  category,
  account,
  showAccount = false,
  onClick,
}: TransactionRowProps) {
  const isIncome = tx.type === 'income'
  const isTransfer = tx.type === 'transfer'
  const isMSI = !!tx.msiPurchaseId

  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-md px-1 py-2 text-left transition-colors hover:bg-accent"
    >
      <CategoryIcon name={category?.icon ?? 'Repeat'} color={category?.color} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium leading-tight">{tx.description}</p>
          {isMSI && (
            <Badge accent="purple" className="shrink-0">
              MSI
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {showAccount && account && (
            <span className="truncate text-[11px] text-muted-foreground">{account.name}</span>
          )}
          {tx.merchant && (
            <span className="truncate text-[11px] text-muted-foreground">
              {showAccount && account ? '· ' : ''}
              {tx.merchant}
            </span>
          )}
        </div>
      </div>

      <div className="shrink-0 text-right">
        <Amount value={isIncome || isTransfer ? tx.amount : -tx.amount} signed size="sm" />
        {!tx.isReconciled && <p className="text-[10px] text-muted-foreground">pendiente</p>}
      </div>
    </button>
  )
}

/** Compact summary for a group of transactions (day total). */
export function DayGroupHeader({
  date,
  totalSpent,
  totalIncome,
}: {
  date: string
  totalSpent: number
  totalIncome: number
}) {
  const net = totalIncome - totalSpent
  return (
    <div className="flex items-center justify-between px-1 pb-1 pt-2">
      <span className="text-[11px] font-medium capitalize text-muted-foreground">
        {new Date(date + 'T00:00:00').toLocaleDateString('es-MX', {
          weekday: 'long',
          day: '2-digit',
          month: 'short',
        })}
      </span>
      {net !== 0 && (
        <span
          className={
            net > 0
              ? 'text-[11px] tabular-nums text-[hsl(var(--color-green))]'
              : 'text-[11px] tabular-nums text-muted-foreground'
          }
        >
          {net > 0 ? '+' : '−'}
          {formatMoney(Math.abs(net))}
        </span>
      )}
    </div>
  )
}
