import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { Card, Badge, Progress, Separator, Button, Input, Label } from '@/components/ui'
import { EmptyState } from '@/components/common/EmptyState'
import { MockActionPanel } from '@/components/common/MockActionPanel'
import { formatMoney, formatMoneyCompact, toCents } from '@/lib/format'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import {
  useAccounts,
  useCategories,
  useMSIPurchases,
  deriveAccountSummary,
  deriveTotalBalance,
  deriveTotalDebt,
} from '@/hooks/useQueries'
import type {
  Account,
  AccountWithSummary,
  MSIPurchase,
  AccentColor,
  Cents,
  AccountType,
} from '@/types'

// ── Local helpers ────────────────────────────────────────────

/** Sum of available credit across all credit accounts. */
function totalAvailableCredit(accounts: AccountWithSummary[]): Cents {
  return accounts
    .filter((a) => a.type === 'credit')
    .reduce((sum, a) => sum + (a.availableCredit ?? 0), 0)
}

/** Sum of credit limits across all credit accounts. */
function totalCreditLimit(accounts: AccountWithSummary[]): Cents {
  return accounts
    .filter((a) => a.type === 'credit')
    .reduce((sum, a) => sum + (a.creditLimit ?? 0), 0)
}

/** Total monthly burden from active MSI installments. */
function msiMonthlyBurden(msiPurchases: MSIPurchase[]): Cents {
  return msiPurchases
    .filter((m) => m.status === 'active')
    .reduce((sum, m) => sum + m.installmentAmount, 0)
}

/** Format ISO date as "15 ago". */
function formatDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
  })
}

/** Credit health bucket based on utilization rate (0–1 used). */
function creditHealth(usedRate: number): { label: string; accent: AccentColor } {
  if (usedRate < 0.3) return { label: 'Saludable', accent: 'green' }
  if (usedRate < 0.7) return { label: 'Moderado', accent: 'yellow' }
  return { label: 'Alto', accent: 'red' }
}

function centsToInput(cents: number | undefined): string {
  return ((cents ?? 0) / 100).toFixed(2)
}

function todayISO(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

// ── Hero ─────────────────────────────────────────────────────

function NetWorthHero({
  netWorth,
  operatingFunds,
  totalDebt,
  availableCredit,
}: {
  netWorth: Cents
  operatingFunds: Cents
  totalDebt: Cents
  availableCredit: Cents
}) {
  const isPositive = netWorth >= 0

  return (
    <Card className="p-3.5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Patrimonio estimado</p>
        <Badge accent={isPositive ? 'green' : 'red'}>{isPositive ? 'Positivo' : 'Negativo'}</Badge>
      </div>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tabular-nums tracking-tight',
          isPositive ? 'text-[hsl(var(--color-green))]' : 'text-[hsl(var(--color-red))]',
        )}
      >
        {formatMoney(netWorth)}
      </p>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-md bg-[hsl(var(--color-green-soft))] px-2.5 py-1.5">
          <p className="text-[10px] leading-tight text-[hsl(var(--color-green))]">
            Fondos operativos
          </p>
          <p className="mt-0.5 text-xs font-semibold tabular-nums text-[hsl(var(--color-green))]">
            {formatMoneyCompact(operatingFunds)}
          </p>
        </div>
        <div className="rounded-md bg-[hsl(var(--color-red-soft))] px-2.5 py-1.5">
          <p className="text-[10px] leading-tight text-[hsl(var(--color-red))]">Deuda total</p>
          <p className="mt-0.5 text-xs font-semibold tabular-nums text-[hsl(var(--color-red))]">
            {formatMoneyCompact(totalDebt)}
          </p>
        </div>
        <div className="rounded-md bg-[hsl(var(--color-blue-soft))] px-2.5 py-1.5">
          <p className="text-[10px] leading-tight text-[hsl(var(--color-blue))]">
            Crédito disponible
          </p>
          <p className="mt-0.5 text-xs font-semibold tabular-nums text-[hsl(var(--color-blue))]">
            {formatMoneyCompact(availableCredit)}
          </p>
        </div>
      </div>
    </Card>
  )
}

// ── Debit card ───────────────────────────────────────────────

function AccountActions({
  accountName,
  onEdit,
  onDelete,
}: {
  accountName: string
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="mt-3 flex justify-end gap-1">
      <Button variant="ghost" size="sm" aria-label={`Editar ${accountName}`} onClick={onEdit}>
        Editar
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        aria-label={`Eliminar ${accountName}`}
        onClick={onDelete}
      >
        Eliminar
      </Button>
    </div>
  )
}

function DebitCardItem({
  account,
  sharePct,
  onEdit,
  onDelete,
}: {
  account: AccountWithSummary
  sharePct: number
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{account.name}</span>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {account.institution} ·•{account.last4}
          </p>
        </div>
        <Badge accent="green" className="shrink-0">
          {account.currency}
        </Badge>
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div>
          <p className="text-base font-semibold tabular-nums text-[hsl(var(--color-green))]">
            {formatMoney(account.balanceOrDebt, account.currency)}
          </p>
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {sharePct}% del total
        </span>
      </div>
      <AccountActions accountName={account.name} onEdit={onEdit} onDelete={onDelete} />
    </Card>
  )
}

// ── Credit card ──────────────────────────────────────────────

function CreditCardItem({
  account,
  msiPurchases,
  onEdit,
  onDelete,
}: {
  account: AccountWithSummary
  msiPurchases: MSIPurchase[]
  onEdit: () => void
  onDelete: () => void
}) {
  const limit = account.creditLimit ?? 0
  const available = account.availableCredit ?? 0
  const usedRate = limit > 0 ? 1 - available / limit : 0
  const health = creditHealth(usedRate)
  const msiCount = account.activeMSICount ?? 0

  return (
    <Card className="overflow-hidden">
      <div className="p-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-sm font-medium">{account.name}</span>
              <Badge accent={health.accent}>{health.label}</Badge>
              {msiCount > 0 && <Badge accent="purple">{msiCount} MSI</Badge>}
            </div>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {account.institution} ·•{account.last4} · {account.currency}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-sm font-semibold tabular-nums text-[hsl(var(--color-red))]">
              {formatMoney(account.balanceOrDebt, account.currency)}
            </p>
            <p className="text-[11px] text-muted-foreground">Deuda</p>
          </div>
        </div>

        {/* Utilization bar */}
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px]">
            <span className="truncate text-muted-foreground">
              Disp. {formatMoney(available, account.currency)}
              <span className="text-muted-foreground"> / {formatMoneyCompact(limit)}</span>
            </span>
            <span
              className={cn(
                'shrink-0 font-medium tabular-nums',
                usedRate >= 0.7
                  ? 'text-[hsl(var(--color-red))]'
                  : usedRate >= 0.3
                    ? 'text-[hsl(var(--color-yellow))]'
                    : 'text-muted-foreground',
              )}
            >
              {Math.round(usedRate * 100)}% usado
            </span>
          </div>
          <Progress
            value={usedRate}
            variant={usedRate >= 0.7 ? 'warning' : 'default'}
            aria-label={`Uso de crédito de ${account.name}`}
            className="mt-1.5"
          />
        </div>

        {/* Cut & payment days */}
        {(account.statementCutDay !== undefined || account.paymentDueDay !== undefined) && (
          <div className="mt-2.5 flex items-center gap-3 text-[11px] text-muted-foreground">
            {account.statementCutDay !== undefined && (
              <span>
                Corte <span className="font-medium text-foreground">{account.statementCutDay}</span>
              </span>
            )}
            {account.paymentDueDay !== undefined && (
              <span>
                Pago <span className="font-medium text-foreground">{account.paymentDueDay}</span>
              </span>
            )}
          </div>
        )}
        <Link
          to={`/accounts/${account.id}`}
          className="mt-3 inline-flex text-xs font-medium text-[hsl(var(--color-blue))] hover:underline"
        >
          Ver detalle y pagar
        </Link>
        <AccountActions accountName={account.name} onEdit={onEdit} onDelete={onDelete} />
      </div>

      {/* Active MSI */}
      {msiPurchases.length > 0 && (
        <>
          <Separator />
          <div className="space-y-2.5 bg-muted/30 p-3">
            {msiPurchases.map((msi) => (
              <MSIRow key={msi.id} msi={msi} />
            ))}
          </div>
        </>
      )}
    </Card>
  )
}

function MSIRow({ msi }: { msi: MSIPurchase }) {
  const pct = msi.installmentsPaid / msi.installmentCount
  const remaining = msi.installmentCount - msi.installmentsPaid

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-xs font-medium">{msi.description}</span>
          {msi.merchant && (
            <span className="hidden shrink-0 truncate text-[11px] text-muted-foreground sm:inline">
              · {msi.merchant}
            </span>
          )}
        </div>
        <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
          {formatMoney(msi.installmentAmount)}/mes
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <Progress
          value={pct}
          accent="purple"
          aria-label={`Cuotas pagadas de ${msi.description}`}
          className="h-1 flex-1"
        />
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {msi.installmentsPaid}/{msi.installmentCount}
        </span>
        {msi.nextInstallmentDate && (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            · {formatDate(msi.nextInstallmentDate)}
          </span>
        )}
        {remaining > 0 && (
          <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
            · {remaining} restan
          </span>
        )}
      </div>
    </div>
  )
}

// ── Section header with right-side metric ────────────────────

function SectionHeader({
  title,
  count,
  right,
}: {
  title: string
  count?: number
  right?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-1">
      <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
        {count !== undefined && ` · ${count}`}
      </h2>
      {right}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────

export default function AccountsPage() {
  const [isAccountPanelOpen, setIsAccountPanelOpen] = useState(false)
  const [isMSIPanelOpen, setIsMSIPanelOpen] = useState(false)
  const [editingAccount, setEditingAccount] = useState<Account | null>(null)
  const [deletingAccount, setDeletingAccount] = useState<Account | null>(null)
  const accountsQ = useAccounts()
  const categoriesQ = useCategories()
  const msiQ = useMSIPurchases()
  const queryClient = useQueryClient()

  // Form state
  const [fName, setFName] = useState('')
  const [fType, setFType] = useState<AccountType>('debit')
  const [fInstitution, setFInstitution] = useState('')
  const [fBalance, setFBalance] = useState('')
  const [fDebt, setFDebt] = useState('')
  const [fLast4, setFLast4] = useState('')
  const [fCutDay, setFCutDay] = useState('')
  const [fDueDay, setFDueDay] = useState('')
  const [showNameError, setShowNameError] = useState(false)
  const [fMSIAccount, setFMSIAccount] = useState('')
  const [fMSICategory, setFMSICategory] = useState('')
  const [fMSIDescription, setFMSIDescription] = useState('')
  const [fMSIMerchant, setFMSIMerchant] = useState('')
  const [fMSITotal, setFMSITotal] = useState('')
  const [fMSIMonths, setFMSIMonths] = useState('12')
  const [fMSIStartDate, setFMSIStartDate] = useState(todayISO)
  const [showMSIFormError, setShowMSIFormError] = useState(false)

  const createMut = useMutation({
    mutationFn: api.createAccount,
    onSuccess: invalidateAccountQueries,
  })

  const updateMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Account> }) =>
      api.updateAccount(id, patch),
    onSuccess: invalidateAccountQueries,
  })

  const deleteMut = useMutation({
    mutationFn: api.deleteAccount,
    onSuccess: invalidateAccountQueries,
  })

  const createMSIMut = useMutation({
    mutationFn: api.createMSIPurchase,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.msiPurchases })
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions })
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
  })

  function invalidateAccountQueries() {
    queryClient.invalidateQueries({ queryKey: queryKeys.accounts })
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
  }

  const openMSIPanel = (creditAccountID: string) => {
    createMSIMut.reset()
    setFMSIAccount(creditAccountID)
    setFMSICategory('')
    setFMSIDescription('')
    setFMSIMerchant('')
    setFMSITotal('')
    setFMSIMonths('12')
    setFMSIStartDate(todayISO())
    setShowMSIFormError(false)
    setIsMSIPanelOpen(true)
  }

  const closeMSIPanel = () => {
    createMSIMut.reset()
    setShowMSIFormError(false)
    setIsMSIPanelOpen(false)
  }

  const openCreatePanel = () => {
    createMut.reset()
    setEditingAccount(null)
    setFName('')
    setFType('debit')
    setFInstitution('')
    setFBalance('')
    setFDebt('')
    setFLast4('')
    setFCutDay('')
    setFDueDay('')
    setShowNameError(false)
    setIsAccountPanelOpen(true)
  }

  const openEditPanel = (account: Account) => {
    updateMut.reset()
    setEditingAccount(account)
    setFName(account.name)
    setFType(account.type)
    setFInstitution(account.institution)
    setFBalance(centsToInput(account.type === 'credit' ? account.creditLimit : account.balance))
    setFDebt(
      account.type === 'credit'
        ? centsToInput((account.creditLimit ?? 0) - (account.availableCredit ?? 0))
        : '',
    )
    setFLast4(account.last4)
    setFCutDay(account.statementCutDay ? String(account.statementCutDay) : '')
    setFDueDay(account.paymentDueDay ? String(account.paymentDueDay) : '')
    setShowNameError(false)
    setIsAccountPanelOpen(true)
  }

  const closePanel = () => {
    createMut.reset()
    updateMut.reset()
    setEditingAccount(null)
    setShowNameError(false)
    setIsAccountPanelOpen(false)
  }

  const openDeletePanel = (account: Account) => {
    deleteMut.reset()
    setDeletingAccount(account)
  }

  const closeDeletePanel = () => {
    deleteMut.reset()
    setDeletingAccount(null)
  }

  const handleSubmit = () => {
    if (!fName.trim()) {
      setShowNameError(true)
      return
    }
    const isCredit = fType === 'credit'
    const balance = toCents(fBalance)
    // For credit accounts, the user enters how much they currently owe
    // ("Deuda actual"), which we store as the derived availableCredit
    // (limit - debt) — the field the rest of the app already reads.
    const debt = isCredit ? toCents(fDebt || '0') : 0
    const availableCredit = balance - debt
    const cutDay = Number(fCutDay)
    const dueDay = Number(fDueDay)
    const creditSchedule = {
      ...(Number.isInteger(cutDay) && cutDay >= 1 && cutDay <= 28
        ? { statementCutDay: cutDay }
        : {}),
      ...(Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 28 ? { paymentDueDay: dueDay } : {}),
    }
    if (editingAccount) {
      updateMut.reset()
      updateMut.mutate(
        {
          id: editingAccount.id,
          patch: {
            name: fName.trim(),
            institution: fInstitution.trim() || 'Banco',
            last4: fLast4.trim().slice(-4) || '0000',
            ...(!editingAccount.balanceTrackingEnabled
              ? isCredit
                ? { creditLimit: balance, availableCredit }
                : { balance }
              : isCredit
                ? { creditLimit: balance }
                : {}),
            ...(isCredit && cutDay !== editingAccount.statementCutDay
              ? { statementCutDay: creditSchedule.statementCutDay }
              : {}),
            ...(isCredit && dueDay !== editingAccount.paymentDueDay
              ? { paymentDueDay: creditSchedule.paymentDueDay }
              : {}),
          },
        },
        { onSuccess: closePanel },
      )
      return
    }
    createMut.reset()
    createMut.mutate(
      {
        name: fName.trim(),
        type: fType,
        institution: fInstitution.trim() || 'Banco',
        last4: fLast4.trim().slice(-4) || '0000',
        currency: 'MXN',
        ...(isCredit ? { creditLimit: balance, availableCredit, ...creditSchedule } : { balance }),
      },
      { onSuccess: closePanel },
    )
  }

  const handleMSISubmit = () => {
    const totalAmount = toCents(fMSITotal)
    const installmentCount = Number(fMSIMonths)
    if (
      !fMSIAccount ||
      !fMSIDescription.trim() ||
      totalAmount <= 0 ||
      !Number.isInteger(installmentCount) ||
      installmentCount < 2 ||
      installmentCount > 60 ||
      !fMSIStartDate
    ) {
      setShowMSIFormError(true)
      return
    }
    createMSIMut.reset()
    createMSIMut.mutate(
      {
        accountId: fMSIAccount,
        categoryId: fMSICategory || null,
        description: fMSIDescription.trim(),
        merchant: fMSIMerchant.trim() || undefined,
        totalAmount,
        installmentCount,
        startDate: fMSIStartDate,
      },
      { onSuccess: closeMSIPanel },
    )
  }

  const isLoading = accountsQ.isLoading || categoriesQ.isLoading || msiQ.isLoading

  if (isLoading) {
    return (
      <>
        <Header
          title="Cuentas"
          subtitle="Centro de control financiero"
          action={
            <Button size="sm" onClick={openCreatePanel}>
              Agregar cuenta
            </Button>
          }
        />
        <div className="flex h-64 items-center justify-center">
          <span className="text-xs text-muted-foreground">Cargando…</span>
        </div>
      </>
    )
  }

  if (accountsQ.isError || categoriesQ.isError || msiQ.isError) {
    return (
      <>
        <Header title="Cuentas" subtitle="Centro de control financiero" />
        <div role="alert" className="py-10 text-center text-sm text-destructive">
          No se pudieron cargar las cuentas.
        </div>
      </>
    )
  }

  const accounts = accountsQ.data ?? []
  const categories = (categoriesQ.data ?? []).filter((category) => category.kind === 'expense')
  const creditAccountOptions = accounts.filter((account) => account.type === 'credit')
  const msiPurchases = msiQ.data ?? []
  const activeMutation = editingAccount ? updateMut : createMut
  const accountPanel = (
    <MockActionPanel
      open={isAccountPanelOpen}
      title={editingAccount ? 'Editar cuenta' : 'Agregar cuenta'}
      description={
        editingAccount
          ? 'Actualiza los datos de esta cuenta. El tipo no se puede cambiar.'
          : 'Registra una nueva cuenta de débito o crédito.'
      }
      submitLabel={editingAccount ? 'Guardar cambios' : 'Agregar'}
      submitting={activeMutation.isPending}
      onClose={closePanel}
      onSubmit={handleSubmit}
    >
      <div className="space-y-1.5">
        <Label htmlFor="account-name">Nombre</Label>
        <Input
          id="account-name"
          placeholder="Ej. Nómina BBVA"
          value={fName}
          onChange={(e) => setFName(e.target.value)}
          aria-invalid={showNameError || Boolean(activeMutation.error) || undefined}
          aria-describedby={
            showNameError
              ? 'account-name-error'
              : activeMutation.error
                ? 'account-create-error'
                : undefined
          }
        />
        {showNameError && (
          <p id="account-name-error" role="alert" className="text-xs text-destructive">
            El nombre es obligatorio.
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="account-type">Tipo</Label>
          <select
            id="account-type"
            className="h-8 w-full rounded-[7px] border border-input bg-background px-2.5 text-[13px] focus-visible:border-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
            value={fType}
            onChange={(e) => setFType(e.target.value as AccountType)}
            disabled={Boolean(editingAccount)}
          >
            <option value="debit">Débito</option>
            <option value="credit">Crédito</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="account-institution">Institución</Label>
          <Input
            id="account-institution"
            placeholder="Banco"
            value={fInstitution}
            onChange={(e) => setFInstitution(e.target.value)}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="account-balance">
            {fType === 'credit' ? 'Límite de crédito' : 'Saldo inicial'}
          </Label>
          <Input
            id="account-balance"
            placeholder="$0.00"
            inputMode="decimal"
            value={fBalance}
            onChange={(e) => setFBalance(e.target.value)}
            disabled={Boolean(editingAccount?.balanceTrackingEnabled && fType === 'debit')}
          />
        </div>
        {fType === 'credit' ? (
          <div className="space-y-1.5">
            <Label htmlFor="account-debt">Deuda actual</Label>
            <Input
              id="account-debt"
              placeholder="$0.00"
              inputMode="decimal"
              value={fDebt}
              onChange={(e) => setFDebt(e.target.value)}
              disabled={Boolean(editingAccount?.balanceTrackingEnabled)}
            />
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="account-last4">Últimos 4</Label>
            <Input
              id="account-last4"
              placeholder="1234"
              inputMode="numeric"
              maxLength={4}
              value={fLast4}
              onChange={(e) => setFLast4(e.target.value)}
            />
          </div>
        )}
      </div>
      {fType === 'credit' && (
        <div className="space-y-3">
          {editingAccount?.balanceTrackingEnabled && (
            <p className="rounded-[7px] bg-muted px-2.5 py-2 text-[11px] text-muted-foreground">
              La deuda se corrige desde el detalle de la tarjeta. Cambiar el límite conserva la
              deuda actual.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="account-cut-day">Día de corte</Label>
              <Input
                id="account-cut-day"
                type="number"
                min="1"
                max="28"
                value={fCutDay}
                onChange={(event) => setFCutDay(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-due-day">Día límite de pago</Label>
              <Input
                id="account-due-day"
                type="number"
                min="1"
                max="28"
                value={fDueDay}
                onChange={(event) => setFDueDay(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="account-last4-credit">Últimos 4</Label>
            <Input
              id="account-last4-credit"
              placeholder="1234"
              inputMode="numeric"
              maxLength={4}
              value={fLast4}
              onChange={(e) => setFLast4(e.target.value)}
            />
          </div>
        </div>
      )}
      {activeMutation.error && (
        <p id="account-create-error" role="alert" className="text-xs text-destructive">
          {editingAccount
            ? 'No se pudo actualizar la cuenta. Intenta de nuevo.'
            : 'No se pudo crear la cuenta. Intenta de nuevo.'}
        </p>
      )}
    </MockActionPanel>
  )

  const msiPanel = (
    <MockActionPanel
      open={isMSIPanelOpen}
      title="Registrar compra a MSI"
      description="Genera una mensualidad por cada mes y las enlaza a esta compra."
      submitLabel={`Programar ${fMSIMonths || '0'} mensualidades`}
      submitting={createMSIMut.isPending}
      onClose={closeMSIPanel}
      onSubmit={handleMSISubmit}
    >
      <div className="space-y-1.5">
        <Label htmlFor="msi-account">Tarjeta de crédito</Label>
        <select
          id="msi-account"
          className="h-8 w-full rounded-[7px] border border-input bg-background px-2.5 text-[13px] focus-visible:border-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
          value={fMSIAccount}
          onChange={(event) => setFMSIAccount(event.target.value)}
        >
          {creditAccountOptions.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="msi-description">Descripción</Label>
        <Input
          id="msi-description"
          placeholder="Ej. MacBook Air"
          value={fMSIDescription}
          onChange={(event) => setFMSIDescription(event.target.value)}
          aria-invalid={showMSIFormError || Boolean(createMSIMut.error) || undefined}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="msi-merchant">Comercio</Label>
        <Input
          id="msi-merchant"
          placeholder="Ej. Apple Store"
          value={fMSIMerchant}
          onChange={(event) => setFMSIMerchant(event.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="msi-total">Monto total</Label>
          <Input
            id="msi-total"
            placeholder="$0.00"
            inputMode="decimal"
            value={fMSITotal}
            onChange={(event) => setFMSITotal(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="msi-months">Meses</Label>
          <Input
            id="msi-months"
            type="number"
            min="2"
            max="60"
            inputMode="numeric"
            value={fMSIMonths}
            onChange={(event) => setFMSIMonths(event.target.value)}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="msi-category">Categoría</Label>
          <select
            id="msi-category"
            className="h-8 w-full rounded-[7px] border border-input bg-background px-2.5 text-[13px] focus-visible:border-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
            value={fMSICategory}
            onChange={(event) => setFMSICategory(event.target.value)}
          >
            <option value="">Sin categoría</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="msi-start-date">Primera mensualidad</Label>
          <Input
            id="msi-start-date"
            type="date"
            value={fMSIStartDate}
            onChange={(event) => setFMSIStartDate(event.target.value)}
          />
        </div>
      </div>
      <p className="rounded-[7px] bg-muted px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
        Se crearán {fMSIMonths || '0'} gastos futuros. La última mensualidad absorbe cualquier
        centavo restante para que el total cuadre exactamente.
      </p>
      {(showMSIFormError || createMSIMut.error) && (
        <p role="alert" className="text-xs text-destructive">
          {createMSIMut.error
            ? 'No se pudo registrar la compra a MSI. Intenta de nuevo.'
            : 'Completa descripción, monto, meses (2–60) y primera mensualidad.'}
        </p>
      )}
    </MockActionPanel>
  )

  const headerAction = (
    <div className="flex items-center gap-1.5">
      {creditAccountOptions.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => openMSIPanel(creditAccountOptions[0].id)}
        >
          Registrar MSI
        </Button>
      )}
      <Button size="sm" onClick={openCreatePanel}>
        Agregar cuenta
      </Button>
    </div>
  )

  const deletePanel = (
    <MockActionPanel
      open={deletingAccount !== null}
      title="Eliminar cuenta"
      description={`¿Eliminar “${deletingAccount?.name ?? ''}”? Esta acción no se puede deshacer.`}
      submitLabel="Eliminar cuenta"
      submitVariant="destructive"
      submitting={deleteMut.isPending}
      onClose={closeDeletePanel}
      onSubmit={() => {
        if (!deletingAccount) return
        deleteMut.reset()
        deleteMut.mutate(deletingAccount.id, { onSuccess: closeDeletePanel })
      }}
    >
      {deleteMut.error && (
        <p role="alert" className="text-xs text-destructive">
          {deleteMut.error instanceof Error
            ? deleteMut.error.message
            : 'No se pudo eliminar la cuenta.'}
        </p>
      )}
    </MockActionPanel>
  )

  if (accounts.length === 0) {
    return (
      <>
        <Header
          title="Cuentas"
          subtitle="Centro de control financiero"
          action={
            <Button size="sm" onClick={openCreatePanel}>
              Agregar cuenta
            </Button>
          }
        />
        <div className="py-4">
          <EmptyState
            title="Sin cuentas registradas"
            description="Agrega tarjetas de débito o crédito para empezar."
          />
        </div>
        {accountPanel}
        {msiPanel}
      </>
    )
  }

  const accountSummary = deriveAccountSummary(accounts, msiPurchases)
  const debitAccounts = accountSummary.filter((a) => a.type === 'debit')
  const creditAccounts = accountSummary.filter((a) => a.type === 'credit')

  const totalDebit = deriveTotalBalance(accountSummary)
  const totalDebt = deriveTotalDebt(accountSummary)
  const totalAvail = totalAvailableCredit(accountSummary)
  const totalLimit = totalCreditLimit(accountSummary)
  const netWorth = totalDebit - totalDebt
  const monthlyMSI = msiMonthlyBurden(msiPurchases)
  const overallUtilization = totalLimit > 0 ? 1 - totalAvail / totalLimit : 0
  const activeMSICount = msiPurchases.filter((m) => m.status === 'active').length

  return (
    <>
      <Header title="Cuentas" subtitle="Centro de control financiero" action={headerAction} />
      <div className="space-y-3.5 py-3">
        {/* Hero summary */}
        <NetWorthHero
          netWorth={netWorth}
          operatingFunds={totalDebit}
          totalDebt={totalDebt}
          availableCredit={totalAvail}
        />

        {/* Operating accounts (debit) */}
        {debitAccounts.length > 0 && (
          <div className="space-y-2">
            <SectionHeader title="Cuentas operativas" count={debitAccounts.length} />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {debitAccounts.map((acc) => {
                const sharePct =
                  totalDebit > 0 ? Math.round((acc.balanceOrDebt / totalDebit) * 100) : 0
                return (
                  <DebitCardItem
                    key={acc.id}
                    account={acc}
                    sharePct={sharePct}
                    onEdit={() => openEditPanel(acc)}
                    onDelete={() => openDeletePanel(acc)}
                  />
                )
              })}
            </div>
          </div>
        )}

        {/* Credit cards */}
        {creditAccounts.length > 0 && (
          <div className="space-y-2">
            <SectionHeader
              title="Tarjetas de crédito"
              count={creditAccounts.length}
              right={
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  {monthlyMSI > 0 && (
                    <span>
                      MSI{' '}
                      <span className="font-medium tabular-nums text-foreground">
                        {formatMoneyCompact(monthlyMSI)}
                      </span>
                      /mes
                    </span>
                  )}
                  <span>
                    Uso global{' '}
                    <span
                      className={cn(
                        'font-medium tabular-nums',
                        overallUtilization >= 0.7
                          ? 'text-[hsl(var(--color-red))]'
                          : 'text-foreground',
                      )}
                    >
                      {Math.round(overallUtilization * 100)}%
                    </span>
                  </span>
                </div>
              }
            />
            <div className="space-y-2">
              {creditAccounts.map((acc) => (
                <CreditCardItem
                  key={acc.id}
                  account={acc}
                  msiPurchases={msiPurchases.filter(
                    (m) => m.accountId === acc.id && m.status === 'active',
                  )}
                  onEdit={() => openEditPanel(acc)}
                  onDelete={() => openDeletePanel(acc)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Consolidated MSI summary */}
        {activeMSICount > 0 && (
          <div className="space-y-2">
            <SectionHeader title="MSI activos" count={activeMSICount} />
            <Card className="p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] text-muted-foreground">Carga mensual total</p>
                  <p className="mt-0.5 text-sm font-semibold tabular-nums text-[hsl(var(--color-purple))]">
                    {formatMoney(monthlyMSI)}/mes
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-muted-foreground">Compras a MSI</p>
                  <p className="mt-0.5 text-sm font-semibold tabular-nums">{activeMSICount}</p>
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>

      {accountPanel}
      {msiPanel}
      {deletePanel}
    </>
  )
}
