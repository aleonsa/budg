import { useState } from 'react'
import { Header } from '@/components/layout/Header'
import { Card } from '@/components/ui'
import { EmptyState } from '@/components/common/EmptyState'
import { FilterBar } from '@/features/transactions/FilterBar'
import { TransactionRow, DayGroupHeader } from '@/features/transactions/TransactionRow'
import { TransactionDetail } from '@/features/transactions/TransactionDetail'
import { useFilteredTransactions } from '@/features/transactions/useFilteredTransactions'
import { groupByDate } from '@/lib/date'
import { formatMoney } from '@/lib/format'
import {
  useTransactions,
  useCategories,
  useAccounts,
} from '@/hooks/useQueries'
import type { Transaction } from '@/types'

export default function TransactionsPage() {
  const txQ = useTransactions()
  const catQ = useCategories()
  const accQ = useAccounts()
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null)

  const isLoading = txQ.isLoading || catQ.isLoading || accQ.isLoading

  if (isLoading) {
    return (
      <>
        <Header title="Movimientos" subtitle="Historial de transacciones" />
        <div className="flex h-64 items-center justify-center">
          <span className="text-xs text-muted-foreground">Cargando…</span>
        </div>
      </>
    )
  }

  const transactions = txQ.data!
  const categories = catQ.data!
  const accounts = accQ.data!

  const categoryMap = new Map(categories.map((c) => [c.id, c]))
  const accountMap = new Map(accounts.map((a) => [a.id, a]))

  return (
    <>
      <Header title="Movimientos" subtitle="Historial de transacciones" />

      <div className="space-y-3 py-3">
        <FilterBar categories={categories} accounts={accounts} />

        <TransactionsList
          transactions={transactions}
          categoryMap={categoryMap}
          accountMap={accountMap}
          onSelect={setSelectedTx}
        />
      </div>

      <TransactionDetail
        transaction={selectedTx}
        category={selectedTx?.categoryId ? categoryMap.get(selectedTx.categoryId) : undefined}
        account={selectedTx ? accountMap.get(selectedTx.accountId) : undefined}
        transferAccount={
          selectedTx?.transferToAccountId
            ? accountMap.get(selectedTx.transferToAccountId)
            : undefined
        }
        onClose={() => setSelectedTx(null)}
      />
    </>
  )
}

// ── List with grouping ──────────────────────────────────────

function TransactionsList({
  transactions,
  categoryMap,
  accountMap,
  onSelect,
}: {
  transactions: Transaction[]
  categoryMap: Map<string, import('@/types').Category>
  accountMap: Map<string, import('@/types').Account>
  onSelect: (tx: Transaction) => void
}) {
  const { filtered } = useFilteredTransactions(transactions)

  if (filtered.length === 0) {
    return (
      <EmptyState
        title="Sin movimientos"
        description="No hay transacciones que coincidan con los filtros."
      />
    )
  }

  const groups = groupByDate(filtered, (t) => t.date)

  return (
    <Card>
      <div className="p-3">
        {/* Summary line */}
        <div className="mb-3 flex items-center justify-between px-1">
          <span className="text-[11px] text-muted-foreground">
            {filtered.length} movimiento{filtered.length !== 1 ? 's' : ''}
          </span>
          <SummaryAmounts items={filtered} />
        </div>

        {groups.map(({ date, items }) => {
          const spent = items
            .filter((t) => t.type === 'expense')
            .reduce((s, t) => s + t.amount, 0)
          const income = items
            .filter((t) => t.type === 'income')
            .reduce((s, t) => s + t.amount, 0)

          return (
            <div key={date}>
              <DayGroupHeader date={date} totalSpent={spent} totalIncome={income} />
              <div className="space-y-0.5">
                {items.map((tx) => (
                  <TransactionRow
                    key={tx.id}
                    transaction={tx}
                    category={tx.categoryId ? categoryMap.get(tx.categoryId) : undefined}
                    account={accountMap.get(tx.accountId)}
                    showAccount
                    onClick={() => onSelect(tx)}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

/** Inline spending / income summary for the filtered set. */
function SummaryAmounts({ items }: { items: Transaction[] }) {
  const spent = items
    .filter((t) => t.type === 'expense')
    .reduce((s, t) => s + t.amount, 0)
  const income = items
    .filter((t) => t.type === 'income')
    .reduce((s, t) => s + t.amount, 0)

  return (
    <span className="text-[11px] tabular-nums">
      <span className="text-[hsl(var(--color-red))]">−{formatMoney(spent)}</span>
      {income > 0 && (
        <>
          {' '}
          <span className="text-[hsl(var(--color-green))]">+{formatMoney(income)}</span>
        </>
      )}
    </span>
  )
}
