import { useId, useState } from 'react'
import { Button, Input, Label } from '@/components/ui'
import { toCents } from '@/lib/format'
import { today } from '@/lib/date'
import type { Account, Category, Transaction, TransactionType } from '@/types'

export interface TransactionFormValue {
  type: TransactionType
  amount: number // cents
  date: string // ISO
  description: string
  accountId: string
  categoryId: string | null
  merchant?: string
  transferToAccountId?: string | null
}

interface TransactionFormProps {
  accounts: Account[]
  categories: Category[]
  /** When editing, seed the form from this transaction. */
  initial?: Transaction | null
  /** Locked type (e.g. user clicked "Agregar gasto"); when set the type toggle is hidden. */
  lockedType?: TransactionType
  onSubmit: (value: TransactionFormValue) => void
  onCancel: () => void
  submitting?: boolean
  submitLabel?: string
}

interface FormErrors {
  amount?: string
  date?: string
  description?: string
  accountId?: string
  transferToAccountId?: string
}

/**
 * Shared transaction form used by the Transactions and Dashboard panels.
 * Plain controlled inputs — no form library.
 */
export function TransactionForm({
  accounts,
  categories,
  initial,
  lockedType,
  onSubmit,
  onCancel,
  submitting = false,
  submitLabel = 'Guardar',
}: TransactionFormProps) {
  const [type, setType] = useState<TransactionType>(initial?.type ?? lockedType ?? 'expense')
  const [errors, setErrors] = useState<FormErrors>({})
  const id = useId()
  const isTransfer = type === 'transfer'

  const expenseCategories = categories.filter((c) => c.kind === 'expense')
  const incomeCategories = categories.filter((c) => c.kind === 'income')

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const amountInput = String(fd.get('amount') ?? '')
    const amount = toCents(amountInput)
    const date = String(fd.get('date') ?? today())
    const description = String(fd.get('description') ?? '')
    const accountId = String(fd.get('accountId') ?? accounts[0]?.id ?? '')
    const categoryIdRaw = fd.get('categoryId')
    const categoryId =
      categoryIdRaw && String(categoryIdRaw) !== 'none' ? String(categoryIdRaw) : null
    const merchant = String(fd.get('merchant') ?? '').trim() || undefined

    let transferToAccountId: string | null = null
    if (type === 'transfer') {
      const raw = fd.get('transferToAccountId')
      transferToAccountId = raw && String(raw) !== 'none' ? String(raw) : null
    }

    const nextErrors: FormErrors = {}
    if (amount <= 0) nextErrors.amount = 'Ingresa un monto mayor a cero.'
    if (!date) nextErrors.date = 'Selecciona una fecha.'
    if (!description.trim()) nextErrors.description = 'Ingresa una descripción.'
    if (!accountId) nextErrors.accountId = 'Selecciona una cuenta.'
    if (isTransfer && !transferToAccountId) {
      nextErrors.transferToAccountId = 'Selecciona una cuenta de destino.'
    } else if (isTransfer && transferToAccountId === accountId) {
      nextErrors.transferToAccountId = 'La cuenta de destino debe ser distinta.'
    }
    setErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) return

    onSubmit({
      type,
      amount,
      date,
      description: description.trim(),
      accountId,
      categoryId,
      merchant,
      transferToAccountId,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3" noValidate>
      {!lockedType && (
        <div className="grid grid-cols-3 gap-2">
          {(['expense', 'income', 'transfer'] as TransactionType[]).map((t) => (
            <Button
              key={t}
              type="button"
              size="sm"
              variant={type === t ? 'default' : 'outline'}
              aria-pressed={type === t}
              onClick={() => {
                setType(t)
                setErrors({})
              }}
            >
              {t === 'expense' ? 'Gasto' : t === 'income' ? 'Ingreso' : 'Transfer'}
            </Button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-amount`}>Monto</Label>
          <Input
            id={`${id}-amount`}
            name="amount"
            placeholder="$0.00"
            inputMode="decimal"
            defaultValue={initial ? (initial.amount / 100).toFixed(2) : ''}
            aria-invalid={!!errors.amount}
            aria-describedby={errors.amount ? `${id}-amount-error` : undefined}
            required
          />
          {errors.amount && (
            <p id={`${id}-amount-error`} role="alert" className="text-xs text-destructive">
              {errors.amount}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-date`}>Fecha</Label>
          <Input
            id={`${id}-date`}
            name="date"
            type="date"
            defaultValue={initial?.date ?? today()}
            aria-invalid={!!errors.date}
            aria-describedby={errors.date ? `${id}-date-error` : undefined}
            required
          />
          {errors.date && (
            <p id={`${id}-date-error`} role="alert" className="text-xs text-destructive">
              {errors.date}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-description`}>Descripción</Label>
        <Input
          id={`${id}-description`}
          name="description"
          placeholder={isTransfer ? 'Entre cuentas' : 'Ej. Café, nómina, súper'}
          defaultValue={initial?.description ?? ''}
          aria-invalid={!!errors.description}
          aria-describedby={errors.description ? `${id}-description-error` : undefined}
          required
        />
        {errors.description && (
          <p id={`${id}-description-error`} role="alert" className="text-xs text-destructive">
            {errors.description}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-account`}>Cuenta</Label>
          <select
            id={`${id}-account`}
            name="accountId"
            defaultValue={initial?.accountId ?? accounts[0]?.id}
            aria-invalid={!!errors.accountId}
            aria-describedby={errors.accountId ? `${id}-account-error` : undefined}
            className="h-8 w-full rounded-[7px] border border-input bg-background px-2.5 text-[13px] focus-visible:border-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
            required
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          {errors.accountId && (
            <p id={`${id}-account-error`} role="alert" className="text-xs text-destructive">
              {errors.accountId}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={isTransfer ? `${id}-destination` : `${id}-category`}>
            {isTransfer ? 'Destino' : 'Categoría'}
          </Label>
          {isTransfer ? (
            <select
              id={`${id}-destination`}
              name="transferToAccountId"
              defaultValue={initial?.transferToAccountId ?? 'none'}
              aria-invalid={!!errors.transferToAccountId}
              aria-describedby={errors.transferToAccountId ? `${id}-destination-error` : undefined}
              className="h-8 w-full rounded-[7px] border border-input bg-background px-2.5 text-[13px] focus-visible:border-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
            >
              <option value="none">Sin destino</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          ) : (
            <select
              id={`${id}-category`}
              name="categoryId"
              defaultValue={initial?.categoryId ?? 'none'}
              className="h-8 w-full rounded-[7px] border border-input bg-background px-2.5 text-[13px] focus-visible:border-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
            >
              <option value="none">Sin categoría</option>
              {(type === 'income' ? incomeCategories : expenseCategories).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {errors.transferToAccountId && (
            <p id={`${id}-destination-error`} role="alert" className="text-xs text-destructive">
              {errors.transferToAccountId}
            </p>
          )}
        </div>
      </div>

      {!isTransfer && (
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-merchant`}>Comercio (opcional)</Label>
          <Input
            id={`${id}-merchant`}
            name="merchant"
            placeholder="Ej. Uber, OXXO"
            defaultValue={initial?.merchant ?? ''}
          />
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={submitting}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? 'Guardando…' : submitLabel}
        </Button>
      </div>
    </form>
  )
}
