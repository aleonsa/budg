import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Header } from '@/components/layout/Header'
import { MockActionPanel } from '@/components/common/MockActionPanel'
import { Badge, Button, Card, Input, Label } from '@/components/ui'
import { useAccounts, useCategories } from '@/hooks/useQueries'
import { loanApi, type Loan, type LoanInput, type LoanPayment } from '@/lib/api/loans'
import { centsToInput, formatMoney, toCents } from '@/lib/format'
import { formatDate, today } from '@/lib/date'
import { queryKeys } from '@/lib/query-keys'

type Action = 'create' | 'edit' | 'pay' | 'extra' | 'reconcile' | 'undo' | 'delete'
type Fields = {
  account: string
  description: string
  lender: string
  principal: string
  rate: string
  months: string
  monthly: string
  date: string
  day: string
  total: string
  interest: string
  category: string
}
const emptyFields = (): Fields => ({
  account: '',
  description: '',
  lender: '',
  principal: '',
  rate: '',
  months: '60',
  monthly: '',
  date: today(),
  day: '13',
  total: '',
  interest: '',
  category: '',
})
const titles: Record<Action, string> = {
  create: 'Nuevo préstamo',
  edit: 'Editar préstamo',
  pay: 'Registrar mensualidad',
  extra: 'Aportación a capital',
  reconcile: 'Conciliar saldo',
  undo: 'Deshacer registro',
  delete: 'Eliminar préstamo',
}

function Field({
  name,
  label,
  type = 'text',
  value,
  onChange,
}: {
  name: string
  label: string
  type?: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={`loan-${name}`}>{label}</Label>
      <Input
        id={`loan-${name}`}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        step={type === 'number' ? '0.01' : undefined}
      />
    </div>
  )
}

export default function LoansPage() {
  const { loanId } = useParams()
  const navigate = useNavigate()
  const client = useQueryClient()
  const accountsQ = useAccounts()
  const categoriesQ = useCategories()
  const listQ = useQuery({ queryKey: queryKeys.loans, queryFn: loanApi.list })
  const detailQ = useQuery({
    queryKey: [...queryKeys.loans, loanId],
    queryFn: () => loanApi.get(loanId!),
    enabled: !!loanId,
  })
  const [action, setAction] = useState<Action | null>(null)
  const [fields, setFields] = useState<Fields>(emptyFields)
  const [selectedPayment, setSelectedPayment] = useState<LoanPayment | null>(null)
  const [error, setError] = useState('')
  const operationKey = useRef('')
  const loan = detailQ.data?.loan
  const payments = detailQ.data?.payments ?? []
  const pending = payments.filter((p) => p.status === 'pending')
  const accounts = (accountsQ.data ?? []).filter(
    (a) => a.isActive && a.type === 'debit' && a.currency === 'MXN' && a.balanceTrackingEnabled,
  )
  const categories = (categoriesQ.data ?? []).filter((c) => c.kind === 'expense')

  async function invalidate() {
    await Promise.all(
      [queryKeys.loans, queryKeys.accounts, queryKeys.transactions, queryKeys.dashboard].map(
        (queryKey) => client.invalidateQueries({ queryKey }),
      ),
    )
  }
  const mutation = useMutation({
    mutationFn: async ({ mode, input }: { mode: Action; input: Fields }) => {
      const principal = toCents(input.principal)
      switch (mode) {
        case 'create': {
          const terms: LoanInput = {
            accountId: input.account,
            description: input.description,
            lender: input.lender || undefined,
            principalCents: principal,
            annualRateBps: Math.round(Number(input.rate) * 100),
            termMonths: Number(input.months),
            monthlyPaymentCents: toCents(input.monthly),
            startDate: input.date,
            dayOfMonth: Number(input.day),
          }
          return loanApi.create(terms, operationKey.current)
        }
        case 'edit':
          return loanApi.update(loan!.id, {
            accountId: input.account,
            description: input.description,
            lender: input.lender || null,
          })
        case 'pay':
          return loanApi.pay(loan!.id, selectedPayment!.id, {
            date: input.date,
            paidTotalCents: toCents(input.total),
            paidPrincipalCents: principal,
            paidInterestCents: toCents(input.interest),
            categoryId: input.category || null,
          })
        case 'extra':
          return loanApi.extra(
            loan!.id,
            { date: input.date, amountCents: principal, categoryId: input.category || null },
            operationKey.current,
          )
        case 'reconcile':
          return loanApi.reconcile(loan!.id, {
            asOfDate: input.date,
            actualBalanceCents: principal,
          })
        case 'undo':
          return loanApi.undo(loan!.id, selectedPayment!.id)
        case 'delete':
          return loanApi.delete(loan!.id)
      }
    },
    onSuccess: async (_result, { mode }) => {
      setAction(null)
      await invalidate()
      if (mode === 'delete') navigate('/loans')
    },
  })

  function open(mode: Action, payment?: LoanPayment) {
    mutation.reset()
    setError('')
    operationKey.current = crypto.randomUUID()
    setSelectedPayment(payment ?? null)
    const values = emptyFields()
    values.account = loan?.accountId ?? accounts[0]?.id ?? ''
    if (loan) {
      values.description = loan.description
      values.lender = loan.lender ?? ''
      values.principal = centsToInput(loan.remainingCents)
    }
    if (mode === 'extra') values.principal = ''
    if (payment) {
      values.principal = centsToInput(payment.principalCents)
      values.total = centsToInput(payment.totalCents)
      values.interest = centsToInput(payment.interestCents)
    }
    setFields(values)
    setAction(mode)
  }
  function change(key: keyof Fields, value: string) {
    setFields((f) => ({ ...f, [key]: value }))
    setError('')
  }
  function submit() {
    if (!action) return
    const money = (v: string, zero = false) =>
      v.trim() !== '' &&
      Number.isFinite(Number(v)) &&
      Number(v) >= (zero ? 0 : 0.01) &&
      Number(v) <= 10_000_000_000
    if (
      (action === 'create' || action === 'edit') &&
      (!fields.account || !fields.description.trim())
    ) {
      setError('Elige cuenta y nombre.')
      return
    }
    if (
      action === 'create' &&
      (!money(fields.principal) ||
        !money(fields.monthly) ||
        !Number.isFinite(Number(fields.rate)) ||
        Number(fields.rate) < 0 ||
        Number(fields.rate) > 1000 ||
        !Number.isInteger(Number(fields.months)) ||
        Number(fields.months) < 1 ||
        Number(fields.months) > 600 ||
        !Number.isInteger(Number(fields.day)) ||
        Number(fields.day) < 1 ||
        Number(fields.day) > 31)
    ) {
      setError('Revisa capital, tasa, plazo y mensualidad.')
      return
    }
    if (
      (action === 'extra' || action === 'reconcile') &&
      !money(fields.principal, action === 'reconcile')
    ) {
      setError('Ingresa un monto válido.')
      return
    }
    if (
      action === 'pay' &&
      (!money(fields.total) ||
        !money(fields.principal, true) ||
        !money(fields.interest, true) ||
        toCents(fields.principal) + toCents(fields.interest) > toCents(fields.total))
    ) {
      setError('El total debe cubrir capital e intereses.')
      return
    }
    mutation.mutate({ mode: action, input: fields })
  }
  const field = (key: keyof Fields, label: string, type = 'text') => (
    <Field
      key={key}
      name={key}
      label={label}
      value={fields[key]}
      type={type}
      onChange={(v) => change(key, v)}
    />
  )
  const selectClass = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm'
  const latestHistory = [...payments]
    .filter((p) => p.status !== 'pending')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]

  return (
    <>
      <Header
        title={loan?.description ?? 'Préstamos'}
        subtitle="Capital, intereses y aportaciones"
        action={
          <Button size="sm" onClick={() => open('create')}>
            Nuevo préstamo
          </Button>
        }
      />
      <main className="mx-auto max-w-5xl space-y-4 p-3">
        <p className="text-xs text-muted-foreground">
          Seguimiento de capital e intereses. Proyecciones mensuales estimadas; confirma aplicación
          de abonos y saldo con tu financiera. Seguros anuales se registran aparte.
        </p>
        {(listQ.isLoading || (loanId && detailQ.isLoading)) && <p>Cargando…</p>}
        {(listQ.isError || detailQ.isError || accountsQ.isError) && (
          <p role="alert">No se pudieron cargar los préstamos o cuentas.</p>
        )}
        {!loanId && (
          <div className="grid gap-3 sm:grid-cols-2">
            {(listQ.data ?? []).map((item) => (
              <Card key={item.id} className="space-y-2 p-4">
                <Link to={`/loans/${item.id}`} className="font-medium underline">
                  {item.description}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {item.lender} · {(item.annualRateBps / 100).toFixed(2)}% anual
                </p>
                <p className="text-xl font-semibold">{formatMoney(item.remainingCents)}</p>
                <p className="text-xs">
                  Capital pendiente · Pago P&amp;I {formatMoney(item.monthlyPaymentCents)}
                </p>
                <Badge accent={item.status === 'paid_off' ? 'green' : 'blue'}>
                  {item.status === 'paid_off' ? 'Liquidado' : 'Activo'}
                </Badge>
              </Card>
            ))}
            {listQ.data?.length === 0 && (
              <p>Agrega tu financiamiento para generar tabla de amortización.</p>
            )}
          </div>
        )}
        {loan && (
          <>
            <Link to="/loans" className="text-sm underline">
              ← Todos los préstamos
            </Link>
            <Card className="space-y-3 p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Metric label="Capital pendiente" value={formatMoney(loan.remainingCents)} />
                <Metric
                  label="Capital amortizado"
                  value={formatMoney(loan.principalCents - loan.remainingCents)}
                />
                <Metric
                  label="Interés pagado"
                  value={formatMoney(
                    payments.reduce((sum, p) => sum + (p.paidInterestCents ?? 0), 0),
                  )}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {loan.lender} · {(loan.annualRateBps / 100).toFixed(2)}% anual · Capital inicial{' '}
                {formatMoney(loan.principalCents)} · Cuenta:{' '}
                {accountsQ.data?.find((a) => a.id === loan.accountId)?.name}
              </p>
              <progress
                className="w-full"
                value={Math.max(0, loan.principalCents - loan.remainingCents)}
                max={loan.principalCents}
                aria-label="Capital amortizado"
              />
              <p className="text-sm">
                {pending[0]
                  ? `Próximo pago P&I: ${formatMoney(pending[0].totalCents)} · ${formatDate(pending[0].dueDate)}`
                  : 'Préstamo liquidado'}
                {pending.length > 0 && ` · ${pending.length} mensualidades pendientes`}
              </p>
              <div className="flex flex-wrap gap-2">
                {pending[0] && (
                  <Button onClick={() => open('pay', pending[0])}>Registrar mensualidad</Button>
                )}
                {loan.remainingCents > 0 && (
                  <Button variant="outline" onClick={() => open('extra')}>
                    Aportar a capital
                  </Button>
                )}
                <Button variant="outline" onClick={() => open('reconcile')}>
                  Conciliar saldo
                </Button>
                <Button variant="ghost" onClick={() => open('edit')}>
                  Editar cuenta / nombre
                </Button>
                {latestHistory && (
                  <Button variant="ghost" onClick={() => open('undo', latestHistory)}>
                    Deshacer último registro
                  </Button>
                )}
                {payments.every((p) => p.status === 'pending') && (
                  <Button variant="ghost" onClick={() => open('delete')}>
                    Eliminar
                  </Button>
                )}
              </div>
            </Card>
            {pending.length > 0 && (
              <LoanCalculator
                key={`${loan.id}-${loan.remainingCents}-${pending.length}`}
                loan={loan}
              />
            )}
            <Card className="overflow-x-auto p-3">
              <h2 className="mb-2 font-medium">Amortización e historial</h2>
              <table className="w-full whitespace-nowrap text-right text-xs">
                <thead>
                  <tr>
                    <th className="p-2 text-left">Pago</th>
                    <th>Fecha</th>
                    <th>Capital</th>
                    <th>Interés</th>
                    <th>Total P&amp;I / real</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-t border-border">
                      <td className="p-2 text-left">
                        {p.sequence > 0
                          ? p.sequence
                          : p.status === 'adjustment'
                            ? 'Conciliación'
                            : 'Abono a capital'}
                      </td>
                      <td>{formatDate(p.paidAt ?? p.dueDate)}</td>
                      <td>{formatMoney(p.paidPrincipalCents ?? p.principalCents)}</td>
                      <td>{formatMoney(p.paidInterestCents ?? p.interestCents)}</td>
                      <td>{formatMoney(p.paidTotalCents ?? p.totalCents)}</td>
                      <td>
                        {p.status === 'pending'
                          ? 'Pendiente'
                          : p.status === 'paid'
                            ? 'Pagado'
                            : 'Ajuste'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </main>
      <MockActionPanel
        open={action !== null}
        title={action ? titles[action] : ''}
        description={
          action === 'reconcile'
            ? 'Usa saldo de capital del vehículo después del último pago registrado. La diferencia quedará en historial; no genera un gasto.'
            : action === 'pay'
              ? 'Se creará un movimiento en la cuenta elegida. Revisa el desglose real; cualquier monto adicional queda como otros cargos.'
              : action === 'undo'
                ? 'Revierte el último registro y su movimiento bancario, si existe. Los pagos futuros se recalculan.'
                : 'Solo capital e intereses del vehículo. Enganche y costos iniciales quedan fuera.'
        }
        onClose={() => {
          if (!mutation.isPending) setAction(null)
        }}
        onSubmit={submit}
        submitting={mutation.isPending}
        submitLabel={action === 'undo' ? 'Deshacer' : action === 'delete' ? 'Eliminar' : 'Guardar'}
        submitVariant={action === 'undo' || action === 'delete' ? 'destructive' : 'default'}
      >
        <div className="space-y-3">
          {action === 'create' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setFields((f) => ({
                  ...f,
                  description: 'KIA K4 Hatchback 2027',
                  lender: 'Inbursa',
                  principal: '276900',
                  rate: '13.73',
                  months: '60',
                  monthly: '6404.28',
                  date: '2026-12-13',
                  day: '13',
                }))
              }
            >
              Usar cotización K4
            </Button>
          )}
          {(action === 'create' || action === 'edit') && (
            <>
              {field('description', 'Nombre')}
              {field('lender', 'Financiera')}
              <Label htmlFor="loan-account">Cuenta de pago (débito MXN)</Label>
              <select
                id="loan-account"
                className={selectClass}
                value={fields.account}
                onChange={(e) => change('account', e.target.value)}
              >
                <option value="">Elegir cuenta</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              {!accounts.length && <p>Activa seguimiento de saldo en una cuenta débito MXN.</p>}
            </>
          )}
          {action === 'create' && (
            <>
              {field('principal', 'Capital inicial (MXN)', 'number')}
              {field(
                'rate',
                'Tasa anual nominal para cálculo (%; incluir IVA si aplica)',
                'number',
              )}
              {field('months', 'Plazo (meses)', 'number')}
              {field('monthly', 'Pago mensual de capital + interés (MXN)', 'number')}
              {field('day', 'Día de vencimiento', 'number')}
              <p className="text-xs text-muted-foreground">
                Cotización K4: $6,404.28 P&amp;I; el cobro del primer año incluye además $336.90 de
                seguro de vida. Confirma mensualidad con financiera al pagar seguro auto al contado.
              </p>
            </>
          )}
          {(action === 'create' ||
            action === 'pay' ||
            action === 'extra' ||
            action === 'reconcile') &&
            field('date', action === 'create' ? 'Primer vencimiento' : 'Fecha', 'date')}
          {action === 'pay' && (
            <>
              {field('total', 'Total real cobrado (incluye seguros / otros cargos)', 'number')}
              {field('principal', 'Capital aplicado', 'number')}
              {field('interest', 'Interés con IVA aplicado', 'number')}
            </>
          )}
          {(action === 'extra' || action === 'reconcile') &&
            field(
              'principal',
              action === 'extra'
                ? 'Monto aplicado íntegramente a capital'
                : 'Saldo real de capital pendiente',
              'number',
            )}
          {(action === 'pay' || action === 'extra') && (
            <>
              <Label htmlFor="loan-category">Categoría del movimiento</Label>
              <select
                id="loan-category"
                className={selectClass}
                value={fields.category}
                onChange={(e) => change('category', e.target.value)}
              >
                <option value="">Sin categoría</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </>
          )}
          {action === 'reconcile' && loan && (
            <p className="text-sm">
              Diferencia: {formatMoney(toCents(fields.principal || '0') - loan.remainingCents)}{' '}
              (saldo banco − Budg).
            </p>
          )}
          {(error || mutation.isError) && (
            <p role="alert" className="text-sm text-destructive">
              {error || mutation.error?.message}
            </p>
          )}
        </div>
      </MockActionPanel>
    </>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function LoanCalculator({ loan }: { loan: Loan }) {
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today)
  const simulation = useMutation({
    mutationFn: () => loanApi.calculate(loan.id, { amountCents: toCents(amount), date }),
  })
  const valid = Number.isFinite(Number(amount)) && Number(amount) > 0 && !!date
  return (
    <Card className="space-y-3 p-4">
      <h2 className="font-medium">Simular aportación a capital</h2>
      <p className="text-xs text-muted-foreground">
        Mantiene pago P&amp;I y reduce plazo. Aportaciones futuras suponen mensualidades previas
        pagadas; cálculo mensual aproximado, sin interés diario, comisiones ni seguros.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          name="simulate-amount"
          label="Monto (MXN)"
          type="number"
          value={amount}
          onChange={(v) => {
            setAmount(v)
            simulation.reset()
          }}
        />
        <Field
          name="simulate-date"
          label="Fecha de aportación"
          type="date"
          value={date}
          onChange={(v) => {
            setDate(v)
            simulation.reset()
          }}
        />
        <Button
          className="self-end"
          disabled={!valid || simulation.isPending}
          onClick={() => simulation.mutate()}
        >
          Simular
        </Button>
      </div>
      {simulation.isError && <p role="alert">{simulation.error.message}</p>}
      {simulation.data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric
              label="Interés estimado ahorrado"
              value={formatMoney(simulation.data.interestSavedCents)}
            />
            <Metric label="Meses menos" value={String(simulation.data.monthsSaved)} />
            <Metric
              label="Liquidación estimada"
              value={formatDate(simulation.data.newPayoffDate)}
            />
          </div>
          <details>
            <summary className="cursor-pointer text-sm">Ver tabla simulada</summary>
            <div className="max-h-72 overflow-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Capital</th>
                    <th>Interés</th>
                    <th>Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {simulation.data.schedule.map((r) => (
                    <tr key={r.sequence}>
                      <td>{formatDate(r.dueDate)}</td>
                      <td>{formatMoney(r.principalCents)}</td>
                      <td>{formatMoney(r.interestCents)}</td>
                      <td>{formatMoney(r.remainingCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </Card>
  )
}
