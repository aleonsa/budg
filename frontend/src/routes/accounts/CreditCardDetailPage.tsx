import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CalendarDays, CreditCard, Landmark, ReceiptText } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { Header, PageSection, SectionTitle } from '@/components/layout/Header'
import { MockActionPanel } from '@/components/common/MockActionPanel'
import { Badge, Button, Card, Input, Label, Progress, Separator } from '@/components/ui'
import { TransactionRow } from '@/features/transactions/TransactionRow'
import {
  useAccounts,
  useCategories,
  useCreditCardStatements,
  useMSIPurchases,
  useTransactions,
} from '@/hooks/useQueries'
import { api } from '@/lib/api'
import { getCreditCardCycles } from '@/lib/credit-card-cycle'
import { today } from '@/lib/date'
import { formatMoney, toCents } from '@/lib/format'
import { queryKeys } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import type { Account, CreditCardStatement, CreditCardStatementStatus, Transaction } from '@/types'

const statementStatus: Record<
  CreditCardStatementStatus,
  { label: string; accent: 'green' | 'yellow' | 'red' | 'blue' }
> = {
  pending: { label: 'Pendiente', accent: 'blue' },
  partial: { label: 'Pago parcial', accent: 'yellow' },
  paid: { label: 'Pagado', accent: 'green' },
  overdue: { label: 'Vencido', accent: 'red' },
}

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function cycleTotal(transactions: Transaction[], accountId: string, start: string, end: string) {
  return transactions
    .filter(
      (tx) =>
        tx.accountId === accountId && tx.date >= start && tx.date <= end && tx.date <= today(),
    )
    .reduce((total, tx) => {
      if (tx.type === 'expense') return total + tx.amount
      if (tx.type === 'income') return total - tx.amount
      if (tx.type === 'transfer') return total + tx.amount
      return total
    }, 0)
}

function cycleTransactions(
  transactions: Transaction[],
  accountId: string,
  start: string,
  end: string,
) {
  return transactions.filter(
    (tx) => tx.accountId === accountId && tx.date >= start && tx.date <= end,
  )
}

function isValidMoney(value: string, allowZero = false): boolean {
  const normalized = value.trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return false
  const cents = toCents(normalized)
  return allowZero ? cents >= 0 : cents > 0
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-muted/55 p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-base font-semibold tabular-nums', tone)}>{value}</p>
    </div>
  )
}

export default function CreditCardDetailPage() {
  const { accountId = '' } = useParams()
  const accountsQ = useAccounts()
  const transactionsQ = useTransactions()
  const statementsQ = useCreditCardStatements(accountId)
  const categoriesQ = useCategories()
  const msiQ = useMSIPurchases()
  const queryClient = useQueryClient()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [statementBalance, setStatementBalance] = useState('')
  const [minimumPayment, setMinimumPayment] = useState('')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [sourceAccountId, setSourceAccountId] = useState('')
  const [selectedStatementId, setSelectedStatementId] = useState('')
  const [paymentIdempotencyKey, setPaymentIdempotencyKey] = useState('')
  const [reconcileOpen, setReconcileOpen] = useState(false)
  const [reconcileDebt, setReconcileDebt] = useState('')
  const [formError, setFormError] = useState('')

  const account = accountsQ.data?.find((item) => item.id === accountId)
  const transactions = transactionsQ.data ?? []
  const statements = statementsQ.data ?? []
  const categories = categoriesQ.data ?? []
  const msiPurchases = (msiQ.data ?? []).filter(
    (purchase) => purchase.accountId === accountId && purchase.status === 'active',
  )
  const debitAccounts = (accountsQ.data ?? []).filter(
    (item) => item.type === 'debit' && item.currency === account?.currency && item.isActive,
  )

  const cutDay = account?.statementCutDay ?? 1
  const dueDay = account?.paymentDueDay ?? 20
  const cycles = getCreditCardCycles(cutDay, dueDay, today())
  const openTransactions = cycleTransactions(
    transactions,
    accountId,
    cycles.open.startDate,
    cycles.open.endDate,
  ).filter((transaction) => transaction.date <= today())
  const openCycleTotal = Math.max(
    0,
    cycleTotal(transactions, accountId, cycles.open.startDate, cycles.open.endDate),
  )
  const previousEstimate = Math.max(
    0,
    cycleTotal(transactions, accountId, cycles.previous.startDate, cycles.previous.endDate),
  )
  const previousStatement = statements.find(
    (statement) => statement.cycleEndDate === cycles.previous.endDate,
  )
  const unpaidStatements = statements.filter((statement) => statement.status !== 'paid')
  const currentDebt = Math.max(0, (account?.creditLimit ?? 0) - (account?.availableCredit ?? 0))
  const utilization = account?.creditLimit ? currentDebt / account.creditLimit : 0

  const confirmMutation = useMutation({
    mutationFn: () =>
      api.confirmCreditCardStatement(accountId, {
        cycleStartDate: cycles.previous.startDate,
        cycleEndDate: cycles.previous.endDate,
        paymentDueDate: cycles.previous.paymentDueDate,
        statementBalance: toCents(statementBalance),
        minimumPayment: minimumPayment ? toCents(minimumPayment) : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.creditCardStatements(accountId) })
      setConfirmOpen(false)
    },
  })

  const paymentMutation = useMutation({
    mutationFn: async () => {
      const source = debitAccounts.find((item) => item.id === sourceAccountId)
      if (!account || !source) throw new Error('missing account')
      return api.createTransaction(
        {
          accountId: source.id,
          transferToAccountId: account.id,
          creditCardStatementId: selectedStatementId || undefined,
          type: 'transfer',
          amount: toCents(paymentAmount),
          categoryId: null,
          date: today(),
          description: `Pago ${account.name}`,
          affectsBalance: true,
        },
        { idempotencyKey: paymentIdempotencyKey },
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts })
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions })
      queryClient.invalidateQueries({ queryKey: queryKeys.creditCardStatements(accountId) })
      setPaymentOpen(false)
    },
  })

  const activationMutation = useMutation({
    mutationFn: ({ id, currentAmount }: { id: string; currentAmount: number }) =>
      api.enableBalanceTracking(id, currentAmount),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts })
    },
  })

  const reconcileMutation = useMutation({
    mutationFn: () =>
      api.reconcileBalance(accountId, (account?.creditLimit ?? 0) - toCents(reconcileDebt)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts })
      setReconcileOpen(false)
    },
  })

  const isLoading =
    accountsQ.isLoading ||
    transactionsQ.isLoading ||
    statementsQ.isLoading ||
    categoriesQ.isLoading ||
    msiQ.isLoading
  const isError =
    accountsQ.isError ||
    transactionsQ.isError ||
    statementsQ.isError ||
    categoriesQ.isError ||
    msiQ.isError

  const openConfirm = () => {
    confirmMutation.reset()
    setStatementBalance((previousStatement?.statementBalance ?? previousEstimate) / 100 + '')
    setMinimumPayment(
      previousStatement?.minimumPayment ? String(previousStatement.minimumPayment / 100) : '',
    )
    setFormError('')
    setConfirmOpen(true)
  }

  const openPayment = (statement?: CreditCardStatement) => {
    paymentMutation.reset()
    const target = statement ?? unpaidStatements[0]
    setSelectedStatementId(target?.id ?? '')
    setPaymentAmount(
      target ? String(Math.max(0, target.statementBalance - target.paidAmount) / 100) : '',
    )
    setSourceAccountId(debitAccounts[0]?.id ?? '')
    setPaymentIdempotencyKey(crypto.randomUUID())
    setFormError('')
    setPaymentOpen(true)
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-xs text-muted-foreground">
        Cargando…
      </div>
    )
  }

  if (isError || !account || account.type !== 'credit') {
    return (
      <>
        <Header title="Tarjeta no disponible" />
        <div className="py-10 text-center">
          <p role="alert" className="text-sm text-destructive">
            No se pudo cargar esta tarjeta de crédito.
          </p>
          <Link to="/accounts" className="mt-3 inline-block text-xs font-medium underline">
            Volver a cuentas
          </Link>
        </div>
      </>
    )
  }

  if (!account.statementCutDay || !account.paymentDueDay) {
    return (
      <>
        <Header title={account.name} subtitle={`${account.institution} ·•${account.last4}`} />
        <div className="space-y-3 py-6">
          <Card className="p-4 text-center">
            <CalendarDays className="mx-auto h-6 w-6 text-muted-foreground" />
            <h2 className="mt-2 text-sm font-semibold">Configura corte y fecha de pago</h2>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
              Budg necesita ambos días para calcular ciclos sin inventar fechas.
            </p>
            <Link
              to="/accounts"
              className="mt-3 inline-flex text-xs font-medium text-[hsl(var(--color-blue))] hover:underline"
            >
              Volver y editar tarjeta
            </Link>
          </Card>
        </div>
      </>
    )
  }

  const categoryMap = new Map(categories.map((category) => [category.id, category]))

  return (
    <>
      <Header
        title={account.name}
        subtitle={`${account.institution} ·•${account.last4}`}
        action={
          <Button
            size="sm"
            onClick={() => openPayment()}
            disabled={debitAccounts.length === 0 || !account.balanceTrackingEnabled}
          >
            Pagar tarjeta
          </Button>
        }
      />

      <div className="space-y-4 py-3">
        <Link
          to="/accounts"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Cuentas
        </Link>

        <Card className="overflow-hidden border-0 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white shadow-lg">
          <div className="p-4 sm:p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-white/60">Deuda actual</p>
                <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
                  {formatMoney(currentDebt, account.currency)}
                </p>
              </div>
              <CreditCard className="h-6 w-6 text-white/45" />
            </div>
            <div className="mt-6 flex items-end justify-between gap-3 text-xs">
              <div>
                <p className="text-white/50">Disponible</p>
                <p className="mt-0.5 font-medium tabular-nums">
                  {formatMoney(account.availableCredit ?? 0, account.currency)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-white/50">Límite</p>
                <p className="mt-0.5 font-medium tabular-nums">
                  {formatMoney(account.creditLimit ?? 0, account.currency)}
                </p>
              </div>
            </div>
            <Progress
              value={utilization}
              aria-label="Utilización de crédito"
              className="mt-3 bg-white/15"
            />
          </div>
        </Card>

        {!account.balanceTrackingEnabled && (
          <Card className="border-[hsl(var(--color-yellow))]/30 bg-[hsl(var(--color-yellow-soft))] p-3">
            <div className="flex items-start gap-2.5">
              <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--color-yellow))]" />
              <div className="flex-1">
                <p className="text-xs font-medium">Saldo automático pendiente</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  Se activará al primer pago usando la deuda actual mostrada. Después, compras,
                  reembolsos y pagos actualizarán el disponible automáticamente.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  disabled={activationMutation.isPending}
                  onClick={() =>
                    activationMutation.mutate({
                      id: account.id,
                      currentAmount: account.availableCredit ?? 0,
                    })
                  }
                >
                  Activar con saldo actual
                </Button>
              </div>
            </div>
          </Card>
        )}

        {account.balanceTrackingEnabled && (
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                reconcileMutation.reset()
                setReconcileDebt(String(currentDebt / 100))
                setFormError('')
                setReconcileOpen(true)
              }}
            >
              Conciliar deuda
            </Button>
          </div>
        )}

        <PageSection>
          <SectionTitle>Ciclo abierto</SectionTitle>
          <Card className="p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">
                  {formatDate(cycles.open.startDate)} – {formatDate(cycles.open.endDate)}
                </p>
                <p className="mt-1 text-xl font-semibold tabular-nums">
                  {formatMoney(openCycleTotal, account.currency)}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">Compras netas al momento</p>
              </div>
              <div className="rounded-lg bg-[hsl(var(--color-blue-soft))] p-2 text-[hsl(var(--color-blue))]">
                <CalendarDays className="h-4 w-4" />
              </div>
            </div>
            <Separator className="my-3" />
            <div className="grid grid-cols-2 gap-2">
              <Metric label="Próximo corte" value={formatDate(cycles.open.endDate)} />
              <Metric label="Pago estimado" value={formatDate(cycles.open.paymentDueDate)} />
            </div>
          </Card>
        </PageSection>

        <PageSection>
          <div className="flex items-center justify-between px-0.5">
            <SectionTitle>Último corte</SectionTitle>
            <Button variant="outline" size="sm" onClick={openConfirm}>
              {previousStatement ? 'Editar estado' : 'Confirmar estado'}
            </Button>
          </div>
          <Card className="p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] text-muted-foreground">
                  Corte {formatDate(cycles.previous.endDate)}
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums">
                  {formatMoney(
                    previousStatement?.statementBalance ?? previousEstimate,
                    account.currency,
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {previousStatement ? 'Saldo confirmado' : 'Estimación de Budg'}
                </p>
              </div>
              {previousStatement ? (
                <Badge accent={statementStatus[previousStatement.status].accent}>
                  {statementStatus[previousStatement.status].label}
                </Badge>
              ) : (
                <Badge accent="yellow">Sin confirmar</Badge>
              )}
            </div>
            {previousStatement && (
              <>
                <Separator className="my-3" />
                <div className="grid grid-cols-3 gap-2">
                  <Metric
                    label="Pagado"
                    value={formatMoney(previousStatement.paidAmount, account.currency)}
                  />
                  <Metric
                    label="Restante"
                    value={formatMoney(
                      Math.max(
                        0,
                        previousStatement.statementBalance - previousStatement.paidAmount,
                      ),
                      account.currency,
                    )}
                  />
                  <Metric label="Límite" value={formatDate(previousStatement.paymentDueDate)} />
                </div>
                {previousStatement.status !== 'paid' && (
                  <Button
                    className="mt-3 w-full"
                    size="sm"
                    onClick={() => openPayment(previousStatement)}
                  >
                    Aplicar pago
                  </Button>
                )}
              </>
            )}
          </Card>
        </PageSection>

        {statements.length > 0 && (
          <PageSection>
            <SectionTitle>Historial de estados</SectionTitle>
            <Card className="divide-y divide-border">
              {statements.map((statement) => {
                const status = statementStatus[statement.status]
                return (
                  <div key={statement.id} className="flex items-center gap-3 p-3">
                    <ReceiptText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium">
                        Corte {formatDate(statement.cycleEndDate)}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Vence {formatDate(statement.paymentDueDate)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold tabular-nums">
                        {formatMoney(statement.statementBalance, account.currency)}
                      </p>
                      <Badge accent={status.accent}>{status.label}</Badge>
                    </div>
                  </div>
                )
              })}
            </Card>
          </PageSection>
        )}

        {msiPurchases.length > 0 && (
          <PageSection>
            <SectionTitle>Meses sin intereses</SectionTitle>
            <Card className="divide-y divide-border">
              {msiPurchases.map((purchase) => (
                <div key={purchase.id} className="p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">{purchase.description}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {purchase.installmentsPaid}/{purchase.installmentCount} mensualidades
                      </p>
                    </div>
                    <p className="text-xs font-semibold tabular-nums text-[hsl(var(--color-purple))]">
                      {formatMoney(purchase.installmentAmount, account.currency)}/mes
                    </p>
                  </div>
                  <Progress
                    value={purchase.installmentsPaid / purchase.installmentCount}
                    accent="purple"
                    className="mt-2 h-1"
                    aria-label={`Progreso de ${purchase.description}`}
                  />
                </div>
              ))}
            </Card>
          </PageSection>
        )}

        <PageSection>
          <SectionTitle>Movimientos del ciclo</SectionTitle>
          <Card className="divide-y divide-border px-2">
            {openTransactions.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                Sin movimientos en este ciclo.
              </p>
            ) : (
              openTransactions.map((transaction) => (
                <TransactionRow
                  key={transaction.id}
                  transaction={transaction}
                  category={
                    transaction.categoryId ? categoryMap.get(transaction.categoryId) : undefined
                  }
                  account={account}
                />
              ))
            )}
          </Card>
        </PageSection>
      </div>

      <MockActionPanel
        open={confirmOpen}
        title="Confirmar estado de cuenta"
        description={`Compara la estimación de Budg con el estado bancario del corte ${formatDate(cycles.previous.endDate)}.`}
        submitLabel="Confirmar saldo"
        submitting={confirmMutation.isPending}
        onClose={() => setConfirmOpen(false)}
        onSubmit={() => {
          if (
            !isValidMoney(statementBalance, true) ||
            (minimumPayment !== '' && !isValidMoney(minimumPayment, true))
          ) {
            setFormError('Ingresa un saldo válido.')
            return
          }
          confirmMutation.mutate()
        }}
      >
        <div className="rounded-lg bg-muted p-2.5 text-[11px] text-muted-foreground">
          Estimación Budg: {formatMoney(previousEstimate, account.currency)} · Vence{' '}
          {formatDate(cycles.previous.paymentDueDate)}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="statement-balance">Saldo para no generar intereses</Label>
          <Input
            id="statement-balance"
            inputMode="decimal"
            value={statementBalance}
            onChange={(event) => setStatementBalance(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="minimum-payment">Pago mínimo (opcional)</Label>
          <Input
            id="minimum-payment"
            inputMode="decimal"
            value={minimumPayment}
            onChange={(event) => setMinimumPayment(event.target.value)}
          />
        </div>
        {(formError || confirmMutation.error) && (
          <p role="alert" className="text-xs text-destructive">
            {formError || 'No se pudo confirmar el estado.'}
          </p>
        )}
      </MockActionPanel>

      <MockActionPanel
        open={paymentOpen}
        title="Pagar tarjeta"
        description="Registra una transferencia desde una cuenta de débito y aplícala al estado seleccionado."
        submitLabel="Registrar pago"
        submitting={paymentMutation.isPending}
        onClose={() => setPaymentOpen(false)}
        onSubmit={() => {
          const source = debitAccounts.find((item) => item.id === sourceAccountId)
          if (
            !sourceAccountId ||
            !isValidMoney(paymentAmount) ||
            !account.balanceTrackingEnabled ||
            !source?.balanceTrackingEnabled
          ) {
            setFormError('Selecciona una cuenta e ingresa un monto mayor a cero.')
            return
          }
          paymentMutation.mutate()
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="payment-source">Pagar desde</Label>
          <select
            id="payment-source"
            value={sourceAccountId}
            onChange={(event) => setSourceAccountId(event.target.value)}
            className="h-8 w-full rounded-[7px] border border-input bg-background px-2.5 text-[13px]"
          >
            {debitAccounts.map((item: Account) => (
              <option key={item.id} value={item.id}>
                {item.name} · {formatMoney(item.balance ?? 0, item.currency)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="payment-statement">Aplicar al estado</Label>
          <select
            id="payment-statement"
            value={selectedStatementId}
            onChange={(event) => setSelectedStatementId(event.target.value)}
            className="h-8 w-full rounded-[7px] border border-input bg-background px-2.5 text-[13px]"
          >
            <option value="">Sin estado asociado</option>
            {unpaidStatements.map((statement) => (
              <option key={statement.id} value={statement.id}>
                Corte {formatDate(statement.cycleEndDate)} · resta{' '}
                {formatMoney(statement.statementBalance - statement.paidAmount, account.currency)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="payment-amount">Monto</Label>
          <Input
            id="payment-amount"
            inputMode="decimal"
            value={paymentAmount}
            onChange={(event) => setPaymentAmount(event.target.value)}
          />
        </div>
        {sourceAccountId &&
          !debitAccounts.find((item) => item.id === sourceAccountId)?.balanceTrackingEnabled && (
            <div className="rounded-lg bg-muted p-2.5">
              <p className="text-[11px] text-muted-foreground">
                Activa esta cuenta antes de registrar el pago.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                disabled={activationMutation.isPending}
                onClick={() => {
                  const source = debitAccounts.find((item) => item.id === sourceAccountId)
                  if (source) {
                    activationMutation.mutate({
                      id: source.id,
                      currentAmount: source.balance ?? 0,
                    })
                  }
                }}
              >
                Activar {debitAccounts.find((item) => item.id === sourceAccountId)?.name}
              </Button>
            </div>
          )}
        {(formError || paymentMutation.error) && (
          <p role="alert" className="text-xs text-destructive">
            {formError || 'No se pudo registrar el pago.'}
          </p>
        )}
      </MockActionPanel>

      <MockActionPanel
        open={reconcileOpen}
        title="Conciliar deuda"
        description="Ingresa la deuda actual que muestra el banco. Budg ajustará el crédito disponible y guardará el ajuste en el ledger."
        submitLabel="Conciliar"
        submitting={reconcileMutation.isPending}
        onClose={() => setReconcileOpen(false)}
        onSubmit={() => {
          if (!isValidMoney(reconcileDebt, true)) {
            setFormError('Ingresa una deuda válida.')
            return
          }
          reconcileMutation.mutate()
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="reconcile-debt">Deuda actual</Label>
          <Input
            id="reconcile-debt"
            inputMode="decimal"
            value={reconcileDebt}
            onChange={(event) => setReconcileDebt(event.target.value)}
          />
        </div>
        {(formError || reconcileMutation.error) && (
          <p role="alert" className="text-xs text-destructive">
            {formError || 'No se pudo conciliar la deuda.'}
          </p>
        )}
      </MockActionPanel>
    </>
  )
}
