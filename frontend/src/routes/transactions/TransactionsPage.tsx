import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Header } from '@/components/layout/Header'
import { Button, Card } from '@/components/ui'
import { EmptyState } from '@/components/common/EmptyState'
import { FilterBar } from '@/features/transactions/FilterBar'
import { TransactionRow, DayGroupHeader } from '@/features/transactions/TransactionRow'
import { TransactionDetail } from '@/features/transactions/TransactionDetail'
import { TransactionForm, type TransactionFormValue } from '@/features/transactions/TransactionForm'
import { useFilteredTransactions } from '@/features/transactions/useFilteredTransactions'
import { groupByDate } from '@/lib/date'
import { formatMoney } from '@/lib/format'
import {
  useTransactions,
  useCategories,
  useAccounts,
} from '@/hooks/useQueries'
import {
  useCreateTransaction,
  useUpdateTransaction,
  useDeleteTransaction,
} from '@/hooks/useTransactionMutations'
import type { Transaction } from '@/types'

/** Lightweight centered modal wrapping the transaction form. */
function TransactionModal({
  open,
  title,
  description,
  accounts,
  categories,
  initial,
  lockedType,
  onClose,
}: {
  open: boolean
  title: string
  description: string
  accounts: import('@/types').Account[]
  categories: import('@/types').Category[]
  initial?: Transaction | null
  lockedType?: Transaction['type']
  onClose: () => void
}) {
  const createMut = useCreateTransaction()
  const updateMut = useUpdateTransaction()

  if (!open) return null

  const isEditing = !!initial
  const submitting = createMut.isPending || updateMut.isPending

  const handleSubmit = (value: TransactionFormValue) => {
    if (isEditing && initial) {
      updateMut.mutate(
        {
          id: initial.id,
          patch: {
            type: value.type,
            amount: value.amount,
            date: value.date,
            description: value.description,
            accountId: value.accountId,
            categoryId: value.categoryId,
            merchant: value.merchant,
            transferToAccountId: value.transferToAccountId || undefined,
          },
        },
        { onSuccess: onClose },
      )
    } else {
      createMut.mutate(
        {
          type: value.type,
          amount: value.amount,
          date: value.date,
          description: value.description,
          accountId: value.accountId,
          categoryId: value.categoryId,
          merchant: value.merchant,
          transferToAccountId: value.transferToAccountId || undefined,
        },
        { onSuccess: onClose },
      )
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 p-3 backdrop-blur-[1px] sm:items-center"
      onClick={onClose}
    >
      <Card
        className="max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto bg-[hsl(var(--card))] p-3.5 shadow-[0_16px_48px_rgba(0,0,0,0.14)]"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold">{title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cerrar
          </Button>
        </div>

        <div className="mt-3.5">
          <TransactionForm
            accounts={accounts}
            categories={categories}
            initial={initial}
            lockedType={lockedType}
            onSubmit={handleSubmit}
            onCancel={onClose}
            submitting={submitting}
            submitLabel={isEditing ? 'Guardar cambios' : 'Agregar'}
          />
        </div>

        <div className="mt-3.5 rounded-[7px] bg-muted p-2 text-[11px] text-muted-foreground">
          Ambiente demo: los cambios se guardan en memoria y se reinician al recargar.
        </div>
      </Card>
    </div>,
    document.body,
  )
}

export default function TransactionsPage() {
  const txQ = useTransactions()
  const catQ = useCategories()
  const accQ = useAccounts()
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null)
  const [action, setAction] = useState<'expense' | 'income' | 'transfer' | 'edit' | null>(null)
  const [editingTx, setEditingTx] = useState<Transaction | null>(null)

  const isLoading = txQ.isLoading || catQ.isLoading || accQ.isLoading
  const deleteMut = useDeleteTransaction()

  const openAdd = (type: 'expense' | 'income' | 'transfer') => {
    setEditingTx(null)
    setAction(type)
  }

  const openEdit = (tx: Transaction) => {
    setSelectedTx(null)
    setEditingTx(tx)
    setAction('edit')
  }

  const handleDelete = (tx: Transaction) => {
    setSelectedTx(null)
    deleteMut.mutate(tx.id)
  }

  if (isLoading) {
    return (
      <>
        <Header
          title="Movimientos"
          subtitle="Historial de transacciones"
          action={<Button size="sm" onClick={() => openAdd('expense')}>Agregar</Button>}
        />
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

  const panelTitle =
    action === 'edit'
      ? 'Editar movimiento'
      : action === 'expense'
        ? 'Agregar gasto'
        : action === 'income'
          ? 'Agregar ingreso'
          : 'Nueva transferencia'

  const lockedType =
    action === 'expense'
      ? 'expense'
      : action === 'income'
        ? 'income'
        : action === 'transfer'
          ? 'transfer'
          : undefined

  return (
    <>
      <Header
        title="Movimientos"
        subtitle="Historial de transacciones"
        action={<Button size="sm" onClick={() => openAdd('expense')}>Agregar</Button>}
      />

      <div className="space-y-3 py-3">
        <FilterBar categories={categories} accounts={accounts} />

        <TransactionsList
          transactions={transactions}
          categoryMap={categoryMap}
          accountMap={accountMap}
          onSelect={setSelectedTx}
          onAdd={() => openAdd('expense')}
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
        onEdit={openEdit}
        onDelete={handleDelete}
      />

      <TransactionModal
        open={action !== null}
        title={panelTitle}
        description={
          editingTx ? 'Modifica los campos y guarda los cambios.' : 'Captura rápida de movimiento.'
        }
        accounts={accounts}
        categories={categories}
        initial={editingTx}
        lockedType={lockedType}
        onClose={() => {
          setAction(null)
          setEditingTx(null)
        }}
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
  onAdd,
}: {
  transactions: Transaction[]
  categoryMap: Map<string, import('@/types').Category>
  accountMap: Map<string, import('@/types').Account>
  onSelect: (tx: Transaction) => void
  onAdd: () => void
}) {
  const { filtered } = useFilteredTransactions(transactions)

  if (filtered.length === 0) {
    return (
      <EmptyState
        title="Sin movimientos"
        description="No hay transacciones que coincidan con los filtros."
        action={<Button size="sm" onClick={onAdd}>Agregar movimiento</Button>}
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
