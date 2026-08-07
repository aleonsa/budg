import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MockActionPanel } from '@/components/common/MockActionPanel'
import { TransactionForm, type TransactionFormValue } from '@/features/transactions/TransactionForm'
import { Input, Label } from '@/components/ui'
import { useAccounts, useCategories } from '@/hooks/useQueries'
import { useCreateTransaction } from '@/hooks/useTransactionMutations'
import { useCreateMSIPurchase } from '@/hooks/useMSIPurchaseMutations'
import { useQuickActionStore } from '@/stores/quickAction'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { toCents } from '@/lib/format'
import { today } from '@/lib/date'
import type { TransactionType } from '@/types'

export function QuickActionModal() {
  const isOpen = useQuickActionStore((s) => s.isOpen)
  const action = useQuickActionStore((s) => s.action)

  if (!isOpen || !action) return null

  return <QuickActionModalContent action={action} />
}

function QuickActionModalContent({ action }: { action: NonNullable<import('@/stores/quickAction').QuickActionType> }) {
  const defaultDate = useQuickActionStore((s) => s.defaultDate)
  const closeQuickAction = useQuickActionStore((s) => s.closeQuickAction)

  const accountsQ = useAccounts()
  const categoriesQ = useCategories()

  const createTx = useCreateTransaction()
  const createMSI = useCreateMSIPurchase()
  const msiIdempotencyKey = useRef(crypto.randomUUID())
  const queryClient = useQueryClient()

  const createAcc = useMutation({
    mutationFn: api.createAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
  })

  const [accName, setAccName] = useState('')
  const [accType, setAccType] = useState<'debit' | 'credit'>('debit')
  const [accBalance, setAccBalance] = useState('')
  const [nameValidationError, setNameValidationError] = useState(false)

  const accounts = accountsQ.data ?? []
  const categories = categoriesQ.data ?? []

  const closePanel = () => {
    createTx.reset()
    createMSI.reset()
    msiIdempotencyKey.current = crypto.randomUUID()
    createAcc.reset()
    setAccName('')
    setAccType('debit')
    setAccBalance('')
    setNameValidationError(false)
    closeQuickAction()
  }

  const title = {
    movement: 'Agregar movimiento',
    expense: 'Agregar gasto',
    income: 'Agregar ingreso',
    transfer: 'Nueva transferencia',
    account: 'Nueva cuenta',
  }[action]

  const lockedType =
    action === 'movement'
      ? undefined
      : action === 'transfer'
        ? 'transfer'
        : action === 'income'
          ? 'income'
          : 'expense'

  const handleTx = (value: TransactionFormValue) => {
    createTx.reset()
    createMSI.reset()
    if (value.msiInstallmentCount) {
      createMSI.mutate(
        {
          accountId: value.accountId,
          categoryId: value.categoryId,
          description: value.description,
          merchant: value.merchant,
          totalAmount: value.amount,
          installmentCount: value.msiInstallmentCount,
          startDate: value.date,
          idempotencyKey: msiIdempotencyKey.current,
        },
        { onSuccess: closePanel },
      )
      return
    }
    createTx.mutate(
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
      { onSuccess: closePanel },
    )
  }

  const handleAccount = () => {
    if (!accName.trim()) {
      setNameValidationError(true)
      return
    }
    setNameValidationError(false)
    const balance = toCents(accBalance)
    createAcc.reset()
    createAcc.mutate(
      {
        name: accName.trim(),
        type: accType,
        institution: 'Banco',
        last4: '0000',
        currency: 'MXN',
        ...(accType === 'credit'
          ? { creditLimit: balance, availableCredit: balance }
          : { balance }),
      },
      { onSuccess: closePanel },
    )
  }

  const accountError = createAcc.error
    ? 'No se pudo crear la cuenta. Intenta de nuevo.'
    : nameValidationError
      ? 'Ingresa un nombre de cuenta.'
      : null

  const initialTx = defaultDate
    ? {
        id: '',
        accountId: accounts[0]?.id ?? '',
        type: (action === 'transfer' ? 'transfer' : action === 'income' ? 'income' : 'expense') as TransactionType,
        amount: 0,
        categoryId: null,
        date: defaultDate,
        description: '',
        isReconciled: false,
        createdAt: today(),
      }
    : null

  return (
    <MockActionPanel
      open
      title={title}
      description="Captura rápida de movimiento."
      submitLabel="Guardar"
      onClose={closePanel}
      onSubmit={action === 'account' ? handleAccount : undefined}
      submitting={createTx.isPending || createMSI.isPending || createAcc.isPending}
    >
      {action === 'account' ? (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="quick-account-name">Nombre de cuenta</Label>
            <Input
              id="quick-account-name"
              placeholder="Ej. Nómina BBVA"
              value={accName}
              aria-invalid={Boolean(accountError)}
              aria-describedby={accountError ? 'quick-account-error' : undefined}
              onChange={(e) => {
                setAccName(e.target.value)
                setNameValidationError(false)
              }}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="quick-account-type">Tipo</Label>
              <select
                id="quick-account-type"
                className="h-8 w-full rounded-[7px] border border-input bg-background px-2.5 text-[13px] focus-visible:border-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
                value={accType}
                onChange={(e) => setAccType(e.target.value as 'debit' | 'credit')}
              >
                <option value="debit">Débito</option>
                <option value="credit">Crédito</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quick-account-balance">Saldo inicial</Label>
              <Input
                id="quick-account-balance"
                placeholder="$0.00"
                inputMode="decimal"
                value={accBalance}
                onChange={(e) => setAccBalance(e.target.value)}
              />
            </div>
          </div>
          {accountError && (
            <p id="quick-account-error" role="alert" className="text-xs text-destructive">
              {accountError}
            </p>
          )}
        </>
      ) : (
        <>
          <TransactionForm
            accounts={accounts}
            categories={categories}
            initial={initialTx}
            lockedType={lockedType}
            allowMSI={action === 'movement' || action === 'expense'}
            onSubmit={handleTx}
            onCancel={closePanel}
            submitting={createTx.isPending || createMSI.isPending}
            submitLabel="Agregar"
          />
          {(createTx.error || createMSI.error) && (
            <p role="alert" className="text-xs text-destructive">
              No se pudo crear el movimiento. Intenta de nuevo.
            </p>
          )}
        </>
      )}
    </MockActionPanel>
  )
}
