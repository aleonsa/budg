import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
  useMSIPurchases,
  deriveAccountSummary,
  deriveTotalBalance,
  deriveTotalDebt,
} from '@/hooks/useQueries'
import type { AccountWithSummary, MSIPurchase, AccentColor, Cents, AccountType } from '@/types'

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
        <Badge accent={isPositive ? 'green' : 'red'}>
          {isPositive ? 'Positivo' : 'Negativo'}
        </Badge>
      </div>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tabular-nums tracking-tight',
          isPositive
            ? 'text-[hsl(var(--color-green))]'
            : 'text-[hsl(var(--color-red))]',
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
          <p className="text-[10px] leading-tight text-[hsl(var(--color-red))]">
            Deuda total
          </p>
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

function DebitCardItem({
  account,
  sharePct,
}: {
  account: AccountWithSummary
  sharePct: number
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
    </Card>
  )
}

// ── Credit card ──────────────────────────────────────────────

function CreditCardItem({
  account,
  msiPurchases,
}: {
  account: AccountWithSummary
  msiPurchases: MSIPurchase[]
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
              <span className="text-muted-foreground">
                {' '}/ {formatMoneyCompact(limit)}
              </span>
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
            className="mt-1.5"
          />
        </div>

        {/* Cut & payment days */}
        {(account.statementCutDay !== undefined ||
          account.paymentDueDay !== undefined) && (
          <div className="mt-2.5 flex items-center gap-3 text-[11px] text-muted-foreground">
            {account.statementCutDay !== undefined && (
              <span>
                Corte{' '}
                <span className="font-medium text-foreground">
                  {account.statementCutDay}
                </span>
              </span>
            )}
            {account.paymentDueDay !== undefined && (
              <span>
                Pago{' '}
                <span className="font-medium text-foreground">
                  {account.paymentDueDay}
                </span>
              </span>
            )}
          </div>
        )}
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
        <Progress value={pct} accent="purple" className="h-1 flex-1" />
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
  const accountsQ = useAccounts()
  const msiQ = useMSIPurchases()
  const queryClient = useQueryClient()

  // Form state
  const [fName, setFName] = useState('')
  const [fType, setFType] = useState<AccountType>('debit')
  const [fInstitution, setFInstitution] = useState('')
  const [fBalance, setFBalance] = useState('')
  const [fLast4, setFLast4] = useState('')

  const createMut = useMutation({
    mutationFn: api.createAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
  })

  const openPanel = () => {
    setFName('')
    setFType('debit')
    setFInstitution('')
    setFBalance('')
    setFLast4('')
    setIsAccountPanelOpen(true)
  }

  const handleSubmit = () => {
    if (!fName.trim()) return
    const isCredit = fType === 'credit'
    const balance = toCents(fBalance)
    createMut.mutate(
      {
        name: fName.trim(),
        type: fType,
        institution: fInstitution.trim() || 'Banco',
        last4: fLast4.trim().slice(-4) || '0000',
        currency: 'MXN',
        ...(isCredit
          ? { creditLimit: balance, availableCredit: balance }
          : { balance }),
      },
      { onSuccess: () => setIsAccountPanelOpen(false) },
    )
  }

  const isLoading = accountsQ.isLoading || msiQ.isLoading

  if (isLoading) {
    return (
      <>
        <Header
          title="Cuentas"
          subtitle="Centro de control financiero"
          action={<Button size="sm" onClick={openPanel}>Agregar cuenta</Button>}
        />
        <div className="flex h-64 items-center justify-center">
          <span className="text-xs text-muted-foreground">Cargando…</span>
        </div>
      </>
    )
  }

  const accounts = accountsQ.data ?? []
  const msiPurchases = msiQ.data ?? []

  if (accounts.length === 0) {
    return (
      <>
        <Header
          title="Cuentas"
          subtitle="Centro de control financiero"
          action={<Button size="sm" onClick={openPanel}>Agregar cuenta</Button>}
        />
        <div className="py-4">
          <EmptyState
            title="Sin cuentas registradas"
            description="Agrega tarjetas de débito o crédito para empezar."
          />
        </div>
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
      <Header
        title="Cuentas"
        subtitle="Centro de control financiero"
        action={<Button size="sm" onClick={openPanel}>Agregar cuenta</Button>}
      />
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
                  totalDebit > 0
                    ? Math.round((acc.balanceOrDebt / totalDebit) * 100)
                    : 0
                return (
                  <DebitCardItem key={acc.id} account={acc} sharePct={sharePct} />
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
                  <p className="text-[11px] text-muted-foreground">
                    Carga mensual total
                  </p>
                  <p className="mt-0.5 text-sm font-semibold tabular-nums text-[hsl(var(--color-purple))]">
                    {formatMoney(monthlyMSI)}/mes
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-muted-foreground">
                    Compras a MSI
                  </p>
                  <p className="mt-0.5 text-sm font-semibold tabular-nums">
                    {activeMSICount}
                  </p>
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>

      <MockActionPanel
        open={isAccountPanelOpen}
        title="Agregar cuenta"
        description="Registra una nueva cuenta de débito o crédito."
        submitLabel="Agregar"
        submitting={createMut.isPending}
        onClose={() => setIsAccountPanelOpen(false)}
        onSubmit={handleSubmit}
      >
        <div className="space-y-1.5">
          <Label>Nombre</Label>
          <Input
            placeholder="Ej. Nómina BBVA"
            value={fName}
            onChange={(e) => setFName(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <select
              className="h-8 w-full rounded-[7px] border border-input bg-background px-2.5 text-[13px] focus-visible:border-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
              value={fType}
              onChange={(e) => setFType(e.target.value as AccountType)}
            >
              <option value="debit">Débito</option>
              <option value="credit">Crédito</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Institución</Label>
            <Input
              placeholder="Banco"
              value={fInstitution}
              onChange={(e) => setFInstitution(e.target.value)}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>{fType === 'credit' ? 'Límite de crédito' : 'Saldo inicial'}</Label>
            <Input
              placeholder="$0.00"
              inputMode="decimal"
              value={fBalance}
              onChange={(e) => setFBalance(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Últimos 4</Label>
            <Input
              placeholder="1234"
              inputMode="numeric"
              maxLength={4}
              value={fLast4}
              onChange={(e) => setFLast4(e.target.value)}
            />
          </div>
        </div>
      </MockActionPanel>
    </>
  )
}
