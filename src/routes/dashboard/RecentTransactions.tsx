import { Link } from 'react-router-dom'
import { Card } from '@/components/ui'
import { CategoryIcon } from '@/components/common/CategoryIcon'
import { Amount } from '@/components/common/Amount'
import { groupByDate, formatDateShort } from '@/lib/date'
import type { Transaction, Category } from '@/types'

interface RecentTransactionsProps {
  transactions: Transaction[]
  categories: Map<string, Category>
  /** Max number of transactions to show */
  limit?: number
}

export function RecentTransactions({
  transactions,
  categories,
  limit = 5,
}: RecentTransactionsProps) {
  const recent = transactions.slice(0, limit)
  const groups = groupByDate(recent, (t) => t.date)

  return (
    <Card>
      <div className="p-4">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Movimientos recientes
        </h3>

        <div className="mt-3 space-y-4">
          {groups.map(({ date, items }) => (
            <div key={date}>
              <p className="mb-1.5 text-[11px] capitalize text-muted-foreground">
                {formatDateShort(date)}
              </p>
              <div className="space-y-1">
                {items.map((tx) => {
                  const cat = tx.categoryId ? categories.get(tx.categoryId) : null
                  const isIncome = tx.type === 'income'
                  const isTransfer = tx.type === 'transfer'

                  return (
                    <div key={tx.id} className="flex items-center gap-3 py-1">
                      <CategoryIcon name={cat?.icon ?? 'Repeat'} color={cat?.color} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium leading-tight">
                          {tx.description}
                        </p>
                        {tx.merchant && (
                          <p className="truncate text-[11px] text-muted-foreground">
                            {tx.merchant}
                          </p>
                        )}
                      </div>
                      <Amount
                        value={isIncome || isTransfer ? tx.amount : -tx.amount}
                        signed
                        size="sm"
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <Link
          to="/transactions"
          className="mt-3 block text-xs text-muted-foreground hover:text-foreground"
        >
          Ver todos los movimientos →
        </Link>
      </div>
    </Card>
  )
}
