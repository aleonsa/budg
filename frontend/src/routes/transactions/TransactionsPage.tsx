import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Header } from '@/components/layout/Header'
import { Button, Card } from '@/components/ui'
import { EmptyState } from '@/components/common/EmptyState'
import { MockActionPanel } from '@/components/common/MockActionPanel'
import { FilterBar } from '@/features/transactions/FilterBar'
import { TransactionRow, DayGroupHeader } from '@/features/transactions/TransactionRow'
import { TransactionDetail } from '@/features/transactions/TransactionDetail'
import { TransactionForm, type TransactionFormValue } from '@/features/transactions/TransactionForm'
import { useFilteredTransactions } from '@/features/transactions/useFilteredTransactions'
import { groupByDate } from '@/lib/date'
import { formatMoney } from '@/lib/format'
import { useTransactions, useCategories, useAccounts } from '@/hooks/useQueries'
import {
  useCreateTransaction,
  useUpdateTransaction,
  useDeleteTransaction,
} from '@/hooks/useTransactionMutations'
import type { Transaction } from '@/types'

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
  const isEditing = !!initial
  const activeReset = isEditing ? updateMut.reset : createMut.reset

  useEffect(() => {
    if (open) activeReset()
  }, [activeReset, open])

  if (!open) return null

  const submitting = createMut.isPending || updateMut.isPending
  const mutationError = isEditing ? updateMut.error : createMut.error

  const handleClose = () => {
    if (submitting) return
    activeReset()
    onClose()
  }

  const handleSubmit = (value: TransactionFormValue) => {
    activeReset()
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
        { onSuccess: handleClose },
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
        { onSuccess: handleClose },
      )
    }
  }

  return (
    <MockActionPanel
      open={open}
      title={title}
      description={description}
      onClose={handleClose}
      submitting={submitting}
    >
      <TransactionForm
        accounts={accounts}
        categories={categories}
        initial={initial}
        lockedType={lockedType}
        onSubmit={handleSubmit}
        onCancel={handleClose}
        submitting={submitting}
        submitLabel={isEditing ? 'Guardar cambios' : 'Agregar'}
      />
      {mutationError && (
        <p role="alert" className="text-xs text-destructive">
          {mutationError instanceof Error
            ? mutationError.message
            : 'No se pudo guardar el movimiento.'}
        </p>
      )}
    </MockActionPanel>
  )
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function DeleteConfirmation({
  transaction,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  transaction: Transaction | null
  pending: boolean
  error: unknown
  onCancel: () => void
  onConfirm: () => void
}) {
  const titleId = useId()
  const descriptionId = useId()
  const cancelButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!transaction) return

    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancelButtonRef.current?.focus()

    return () => {
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [transaction])

  if (!transaction) return null

  const handleClose = () => {
    if (!pending) onCancel()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      handleClose()
      return
    }
    if (event.key !== 'Tab') return

    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    )
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first || !last) return

    const active = document.activeElement
    if (event.shiftKey && (active === first || !event.currentTarget.contains(active))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (active === last || !event.currentTarget.contains(active))) {
      event.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-3 backdrop-blur-[1px]"
      onClick={handleClose}
    >
      <Card
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={handleKeyDown}
        onClick={(event: React.MouseEvent) => event.stopPropagation()}
        className="w-full max-w-sm bg-[hsl(var(--card))] p-4 shadow-[0_16px_48px_rgba(0,0,0,0.14)]"
      >
        <p id={titleId} className="text-sm font-semibold">
          Eliminar movimiento
        </p>
        <p id={descriptionId} className="mt-1 text-xs text-muted-foreground">
          ¿Eliminar “{transaction.description}”? Esta acción no se puede deshacer.
        </p>
        {error != null && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {error instanceof Error ? error.message : 'No se pudo eliminar el movimiento.'}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button
            ref={cancelButtonRef}
            variant="outline"
            size="sm"
            onClick={handleClose}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button variant="destructive" size="sm" onClick={onConfirm} disabled={pending}>
            {pending ? 'Eliminando…' : 'Eliminar movimiento'}
          </Button>
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
  const [deletingTx, setDeletingTx] = useState<Transaction | null>(null)

  const isLoading = txQ.isLoading || catQ.isLoading || accQ.isLoading
  const hasQueryError = txQ.isError || catQ.isError || accQ.isError
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
    deleteMut.reset()
    setDeletingTx(tx)
  }

  const closeDelete = () => {
    deleteMut.reset()
    setDeletingTx(null)
  }

  const confirmDelete = () => {
    if (!deletingTx) return
    deleteMut.reset()
    deleteMut.mutate(deletingTx.id, {
      onSuccess: () => {
        closeDelete()
        setSelectedTx(null)
      },
    })
  }

  if (hasQueryError) {
    return (
      <>
        <Header title="Movimientos" subtitle="Historial de transacciones" />
        <div className="flex h-64 items-center justify-center px-4">
          <p role="alert" className="text-center text-sm text-destructive">
            No se pudieron cargar los movimientos. Intenta de nuevo más tarde.
          </p>
        </div>
      </>
    )
  }

  if (isLoading) {
    return (
      <>
        <Header
          title="Movimientos"
          subtitle="Historial de transacciones"
          action={
            <Button size="sm" onClick={() => openAdd('expense')}>
              Agregar
            </Button>
          }
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
        action={
          <Button size="sm" onClick={() => openAdd('expense')}>
            Agregar
          </Button>
        }
      />

      <div className="space-y-3 py-3">
        <FilterBar categories={categories} accounts={accounts} />

        <TransactionsList
          transactions={transactions}
          accounts={accounts}
          categories={categories}
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

      <DeleteConfirmation
        transaction={deletingTx}
        pending={deleteMut.isPending}
        error={deleteMut.error}
        onCancel={closeDelete}
        onConfirm={confirmDelete}
      />
    </>
  )
}

// ── List with grouping ──────────────────────────────────────

function TransactionsList({
  transactions,
  accounts,
  categories,
  categoryMap,
  accountMap,
  onSelect,
  onAdd,
}: {
  transactions: Transaction[]
  accounts: import('@/types').Account[]
  categories: import('@/types').Category[]
  categoryMap: Map<string, import('@/types').Category>
  accountMap: Map<string, import('@/types').Account>
  onSelect: (tx: Transaction) => void
  onAdd: () => void
}) {
  const { filtered } = useFilteredTransactions(transactions, accounts, categories)

  if (filtered.length === 0) {
    return (
      <EmptyState
        title="Sin movimientos"
        description="No hay transacciones que coincidan con los filtros."
        action={
          <Button size="sm" onClick={onAdd}>
            Agregar movimiento
          </Button>
        }
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
          const spent = items.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
          const income = items.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0)

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
  const spent = items.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  const income = items.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0)

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
