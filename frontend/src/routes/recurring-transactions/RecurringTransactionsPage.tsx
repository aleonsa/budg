import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Header } from '@/components/layout/Header'
import { EmptyState } from '@/components/common/EmptyState'
import { MockActionPanel } from '@/components/common/MockActionPanel'
import { Badge, Button, Card, Input, Label } from '@/components/ui'
import { useAccounts, useCategories, useRecurringTransactions } from '@/hooks/useQueries'
import { api } from '@/lib/api'
import { formatDate, today } from '@/lib/date'
import { formatMoney, toCents } from '@/lib/format'
import { queryKeys } from '@/lib/query-keys'
import type { RecurringTransaction, RecurringTransactionFrequency } from '@/types'

function RecurringRow({
  transaction,
  accountName,
  categoryName,
}: {
  transaction: RecurringTransaction
  accountName?: string
  categoryName?: string
}) {
  const frequency = transaction.frequency === 'monthly' ? 'Mensual' : 'Anual'

  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate text-sm font-medium">{transaction.description}</p>
            <Badge accent={transaction.isActive ? 'green' : 'gray'}>
              {transaction.isActive ? 'Activa' : 'Inactiva'}
            </Badge>
          </div>
          {transaction.merchant && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{transaction.merchant}</p>
          )}
        </div>
        <p className="shrink-0 text-sm font-semibold tabular-nums">
          {formatMoney(transaction.amount)}
        </p>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          {frequency} · Próximo {formatDate(transaction.nextDate)}
        </span>
        {accountName && <span>{accountName}</span>}
        {categoryName && <span>{categoryName}</span>}
      </div>
    </Card>
  )
}

export default function RecurringTransactionsPage() {
  const accountsQ = useAccounts()
  const categoriesQ = useCategories()
  const recurringQ = useRecurringTransactions()
  const queryClient = useQueryClient()
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [accountId, setAccountId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [description, setDescription] = useState('')
  const [merchant, setMerchant] = useState('')
  const [amount, setAmount] = useState('')
  const [frequency, setFrequency] = useState<RecurringTransactionFrequency>('monthly')
  const [startDate, setStartDate] = useState(today)
  const [showFormError, setShowFormError] = useState(false)

  const createMut = useMutation({
    mutationFn: api.createRecurringTransaction,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.recurringTransactions }),
  })

  const isLoading = accountsQ.isLoading || categoriesQ.isLoading || recurringQ.isLoading
  const isError = accountsQ.isError || categoriesQ.isError || recurringQ.isError
  const accounts = accountsQ.data ?? []
  const expenseCategories = (categoriesQ.data ?? []).filter(
    (category) => category.kind === 'expense',
  )
  const transactions = recurringQ.data ?? []
  const accountMap = new Map(accounts.map((account) => [account.id, account.name]))
  const categoryMap = new Map(expenseCategories.map((category) => [category.id, category.name]))

  const openPanel = () => {
    createMut.reset()
    setAccountId(accounts.find((account) => account.isActive)?.id ?? accounts[0]?.id ?? '')
    setCategoryId('')
    setDescription('')
    setMerchant('')
    setAmount('')
    setFrequency('monthly')
    setStartDate(today())
    setShowFormError(false)
    setIsPanelOpen(true)
  }

  const closePanel = () => {
    createMut.reset()
    setShowFormError(false)
    setIsPanelOpen(false)
  }

  const handleSubmit = () => {
    const cents = toCents(amount)
    if (!accountId || !description.trim() || cents <= 0 || !startDate) {
      setShowFormError(true)
      return
    }
    createMut.reset()
    createMut.mutate(
      {
        accountId,
        categoryId: categoryId || null,
        description: description.trim(),
        merchant: merchant.trim() || undefined,
        amount: cents,
        frequency,
        startDate,
      },
      { onSuccess: closePanel },
    )
  }

  const header = (
    <Header
      title="Suscripciones"
      subtitle="Gastos programados recurrentes"
      action={
        <Button size="sm" onClick={openPanel}>
          Agregar suscripción
        </Button>
      }
    />
  )

  const panel = (
    <MockActionPanel
      open={isPanelOpen}
      title="Agregar suscripción"
      description="Programa un gasto mensual o anual que se registrará automáticamente."
      submitLabel="Agregar"
      submitting={createMut.isPending}
      onClose={closePanel}
      onSubmit={handleSubmit}
    >
      <div className="space-y-1.5">
        <Label htmlFor="recurring-account">Cuenta</Label>
        <select
          id="recurring-account"
          className="h-8 w-full rounded-[7px] border border-input bg-background px-2.5 text-[13px] focus-visible:border-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
        >
          <option value="">Selecciona una cuenta</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="recurring-description">Descripción</Label>
        <Input
          id="recurring-description"
          placeholder="Ej. Membresía del gym"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          aria-invalid={showFormError || Boolean(createMut.error) || undefined}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="recurring-merchant">Comercio</Label>
        <Input
          id="recurring-merchant"
          placeholder="Ej. Spotify"
          value={merchant}
          onChange={(event) => setMerchant(event.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="recurring-amount">Monto</Label>
          <Input
            id="recurring-amount"
            placeholder="$0.00"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="recurring-frequency">Frecuencia</Label>
          <select
            id="recurring-frequency"
            className="h-8 w-full rounded-[7px] border border-input bg-background px-2.5 text-[13px] focus-visible:border-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
            value={frequency}
            onChange={(event) => setFrequency(event.target.value as RecurringTransactionFrequency)}
          >
            <option value="monthly">Mensual</option>
            <option value="yearly">Anual</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="recurring-category">Categoría</Label>
          <select
            id="recurring-category"
            className="h-8 w-full rounded-[7px] border border-input bg-background px-2.5 text-[13px] focus-visible:border-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">Sin categoría</option>
            {expenseCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="recurring-start-date">Inicio</Label>
          <Input
            id="recurring-start-date"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </div>
      </div>
      {(showFormError || createMut.error) && (
        <p role="alert" className="text-xs text-destructive">
          {createMut.error
            ? 'No se pudo crear la suscripción. Intenta de nuevo.'
            : 'Completa cuenta, descripción, monto e inicio.'}
        </p>
      )}
    </MockActionPanel>
  )

  if (isLoading) {
    return (
      <>
        {header}
        <div className="flex h-64 items-center justify-center">
          <span className="text-xs text-muted-foreground">Cargando…</span>
        </div>
      </>
    )
  }

  if (isError) {
    return (
      <>
        {header}
        <Card role="alert" className="my-4 p-3 text-sm text-destructive">
          No se pudieron cargar las suscripciones. Intenta de nuevo.
        </Card>
      </>
    )
  }

  return (
    <>
      {header}
      <div className="space-y-2 py-3">
        {transactions.length === 0 ? (
          <EmptyState
            title="Sin suscripciones registradas"
            description="Agrega gastos mensuales o anuales para registrarlos automáticamente."
            action={<Button onClick={openPanel}>Agregar suscripción</Button>}
          />
        ) : (
          transactions.map((transaction) => (
            <RecurringRow
              key={transaction.id}
              transaction={transaction}
              accountName={accountMap.get(transaction.accountId)}
              categoryName={
                transaction.categoryId ? categoryMap.get(transaction.categoryId) : undefined
              }
            />
          ))
        )}
      </div>
      {panel}
    </>
  )
}
