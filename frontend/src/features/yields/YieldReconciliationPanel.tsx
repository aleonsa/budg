import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MockActionPanel } from '@/components/common/MockActionPanel'
import { Button, Input, Label } from '@/components/ui'
import { useSavingsGoals, useYieldReconciliations } from '@/hooks/useQueries'
import { api } from '@/lib/api'
import { formatDate, today } from '@/lib/date'
import { formatMoney, toCents } from '@/lib/format'
import { queryKeys } from '@/lib/query-keys'
import {
  blendedAnnualYieldBps,
  daysBetween,
  estimateYieldCents,
  formatBps,
  suggestYieldSplit,
} from '@/lib/yield'
import type { Account, Category, YieldReconciliation } from '@/types'

const selectClass = 'h-8 w-full rounded-[7px] border border-input bg-background px-2.5 text-[13px]'
const MONEY_PATTERN = /^-?\d+(?:\.\d{1,2})?$/

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2)
}

function defaultCategoryId(categories: Category[]): string {
  const income = categories.filter((category) => category.kind === 'income')
  return (
    income.find((category) => /rendim|interes|inter[eé]s|inversi/i.test(category.name))?.id ?? ''
  )
}

interface YieldReconciliationPanelProps {
  open: boolean
  onClose: () => void
  account: Account
  categories: Category[]
}

export function YieldReconciliationPanel(props: YieldReconciliationPanelProps) {
  if (!props.open) return null
  return <YieldReconciliationForm {...props} />
}

function YieldReconciliationForm({ onClose, account, categories }: YieldReconciliationPanelProps) {
  const queryClient = useQueryClient()
  const reconciliationsQ = useYieldReconciliations()
  const goalsQ = useSavingsGoals()
  const currentDate = today()
  const balance = account.balance ?? 0
  const since = account.yieldReconciledOn ?? account.balanceTrackingStartedAt?.slice(0, 10) ?? null

  const [date, setDate] = useState(currentDate)
  const days = since ? Math.max(0, daysBetween(since, date)) : 0
  const estimate = estimateYieldCents(
    balance,
    account.annualYieldBps,
    days,
    account.annualYieldTiers,
  )

  const [bankBalance, setBankBalance] = useState('')
  const [yieldInput, setYieldInput] = useState('')
  const [yieldTouched, setYieldTouched] = useState(false)
  const [categoryId, setCategoryId] = useState(() => defaultCategoryId(categories))
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const [formError, setFormError] = useState('')
  const [lastResult, setLastResult] = useState<YieldReconciliation | null>(null)

  const bankValid = MONEY_PATTERN.test(bankBalance.trim())
  const bankCents = bankValid ? toCents(bankBalance.trim()) : balance
  const difference = bankCents - balance
  const suggestion = suggestYieldSplit(difference, estimate)
  const yieldCents = yieldTouched
    ? MONEY_PATTERN.test(yieldInput.trim())
      ? toCents(yieldInput.trim())
      : NaN
    : suggestion.yieldAmount
  const adjustment = difference - (Number.isNaN(yieldCents) ? 0 : yieldCents)
  const money = (cents: number) => formatMoney(cents, account.currency)

  const history = (reconciliationsQ.data ?? []).filter((rec) => rec.accountId === account.id)
  const latest = history[0]
  const goalNames = new Map((goalsQ.data ?? []).map((goal) => [goal.id, goal.name]))

  const invalidate = () => {
    for (const key of [
      queryKeys.accounts,
      queryKeys.transactions,
      queryKeys.dashboard,
      queryKeys.savingsGoals,
      queryKeys.savingsOverview,
      queryKeys.yieldReconciliations,
    ]) {
      queryClient.invalidateQueries({ queryKey: key })
    }
  }

  const reconcile = useMutation({
    mutationFn: () =>
      api.reconcileYield(
        account.id,
        {
          currentBalance: bankCents,
          yieldAmount: yieldCents,
          categoryId: categoryId || null,
          date,
        },
        { idempotencyKey },
      ),
    onSuccess: ({ reconciliation }) => {
      setLastResult(reconciliation)
      invalidate()
    },
  })

  const undo = useMutation({
    mutationFn: (id: string) => api.undoYieldReconciliation(account.id, id),
    onSuccess: () => {
      // The budg balance changes after undo; start over from a blank form.
      setBankBalance('')
      setYieldInput('')
      setYieldTouched(false)
      setDate(currentDate)
      invalidate()
    },
  })

  const submit = () => {
    if (!bankValid) {
      setFormError('Ingresa el saldo que muestra tu banco.')
      return
    }
    if (
      Number.isNaN(yieldCents) ||
      yieldCents < 0 ||
      (difference >= 0 && yieldCents > difference) ||
      (difference < 0 && yieldCents !== 0)
    ) {
      setFormError('El rendimiento debe estar entre $0 y la diferencia positiva.')
      return
    }
    setFormError('')
    reconcile.mutate()
  }

  if (!account.balanceTrackingEnabled) {
    return (
      <MockActionPanel
        open
        title="Conciliar rendimientos"
        description={account.name}
        onClose={onClose}
      >
        <p className="text-xs text-muted-foreground">
          Activa el seguimiento de saldo de esta cuenta para poder conciliar rendimientos.
        </p>
      </MockActionPanel>
    )
  }

  if (lastResult) {
    const distributed = lastResult.allocations.reduce((sum, item) => sum + item.amount, 0)
    return (
      <MockActionPanel
        open
        title="Rendimientos conciliados"
        description={account.name}
        onClose={onClose}
      >
        <div className="space-y-1 text-xs">
          <p>
            Rendimiento registrado: <strong>{money(lastResult.yield)}</strong>
          </p>
          {lastResult.adjustment !== 0 && <p>Ajuste: {money(lastResult.adjustment)}</p>}
          <p>Saldo en budg: {money(lastResult.balanceAfter)}</p>
          {lastResult.allocations.length > 0 && (
            <div className="pt-1">
              <p className="text-muted-foreground">{money(distributed)} repartidos a tus metas:</p>
              {lastResult.allocations.map((allocation) => (
                <p key={allocation.goalId}>
                  · {goalNames.get(allocation.goalId) ?? 'Meta'}: +{money(allocation.amount)}
                </p>
              ))}
            </div>
          )}
        </div>
        <Button size="sm" onClick={onClose}>
          Listo
        </Button>
      </MockActionPanel>
    )
  }

  const incomeCategories = categories.filter((category) => category.kind === 'income')

  return (
    <MockActionPanel
      open
      title="Conciliar rendimientos"
      description={`Escribe el saldo que ves en ${account.institution}. La diferencia se registra como rendimiento.`}
      submitLabel="Conciliar"
      submitting={reconcile.isPending}
      onClose={onClose}
      onSubmit={submit}
    >
      <div className="rounded-lg bg-muted p-2.5 text-[11px] text-muted-foreground">
        <p>
          Saldo en budg: <span className="font-medium text-foreground">{money(balance)}</span>
        </p>
        <p>
          Tasa{' '}
          {formatBps(
            blendedAnnualYieldBps(balance, account.annualYieldBps, account.annualYieldTiers),
          )}{' '}
          · estimado {money(estimate)}
          {since ? ` desde ${formatDate(since)} (${days} días)` : ''}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="yield-bank-balance">Saldo en el banco</Label>
          <Input
            id="yield-bank-balance"
            inputMode="decimal"
            placeholder={`≈ ${centsToInput(balance + estimate)}`}
            value={bankBalance}
            onChange={(event) => setBankBalance(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="yield-date">Fecha</Label>
          <Input
            id="yield-date"
            type="date"
            value={date}
            min={account.yieldReconciledOn ?? undefined}
            max={currentDate}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
      </div>

      {bankValid && (
        <p className="text-xs">
          Diferencia:{' '}
          <span
            className={
              difference >= 0 ? 'text-[hsl(var(--color-green))]' : 'text-[hsl(var(--color-red))]'
            }
          >
            {difference >= 0 ? '+' : ''}
            {money(difference)}
          </span>
        </p>
      )}

      {bankValid && suggestion.suspicious && difference > 0 && (
        <p role="alert" className="text-xs text-[hsl(var(--color-yellow))]">
          La diferencia es mucho mayor que el rendimiento estimado. ¿Hubo depósitos o retiros sin
          registrar? Ajusta cuánto es rendimiento; el resto queda como ajuste.
        </p>
      )}
      {bankValid && difference < 0 && (
        <p className="text-xs text-muted-foreground">
          El saldo bajó: se registrará como ajuste, sin rendimiento.
        </p>
      )}

      {bankValid && difference > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="yield-amount">Rendimiento</Label>
            <Input
              id="yield-amount"
              inputMode="decimal"
              value={yieldTouched ? yieldInput : centsToInput(suggestion.yieldAmount)}
              onChange={(event) => {
                setYieldTouched(true)
                setYieldInput(event.target.value)
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="yield-category">Categoría</Label>
            <select
              id="yield-category"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              className={selectClass}
            >
              <option value="">Sin categoría</option>
              {incomeCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      {bankValid && adjustment !== 0 && (
        <p className="text-[11px] text-muted-foreground">
          Ajuste (no cuenta como ingreso): {money(adjustment)}
        </p>
      )}

      {latest && (
        <div className="space-y-1 border-t border-border pt-2">
          <p className="text-xs font-medium">Última conciliación</p>
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="text-muted-foreground">
              {formatDate(latest.date)} · rendimiento {money(latest.yield)}
              {latest.adjustment !== 0 && ` · ajuste ${money(latest.adjustment)}`}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={undo.isPending}
              onClick={() => undo.mutate(latest.id)}
            >
              Deshacer
            </Button>
          </div>
          {undo.error && (
            <p role="alert" className="text-xs text-destructive">
              {undo.error.message}
            </p>
          )}
        </div>
      )}

      {(formError || reconcile.error) && (
        <p role="alert" className="text-xs text-destructive">
          {formError || reconcile.error?.message}
        </p>
      )}
    </MockActionPanel>
  )
}
