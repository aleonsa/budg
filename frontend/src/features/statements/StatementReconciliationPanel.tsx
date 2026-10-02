import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MockActionPanel } from '@/components/common/MockActionPanel'
import { Badge, Button, Label } from '@/components/ui'
import { api } from '@/lib/api'
import { formatDate } from '@/lib/date'
import { formatMoney } from '@/lib/format'
import { queryKeys } from '@/lib/query-keys'
import type { Account, Category, StatementMovement, StatementReconciliation } from '@/types'

const WARNING_MESSAGES: Record<string, string> = {
  charges_total_mismatch:
    'La suma de cargos leídos no cuadra con el total del PDF. Revisa la lista antes de registrar.',
  credits_total_mismatch:
    'La suma de abonos leídos no cuadra con el total del PDF. Revisa la lista antes de registrar.',
  missing_totals: 'El PDF no trae totales de cargos y abonos para validar la lectura.',
  card_last4_mismatch: 'La terminación de la tarjeta del PDF no coincide con esta cuenta.',
}

const INCOME_MODE = 'income'
const selectClass =
  'h-8 w-full rounded-[7px] border border-input bg-background px-2.5 text-[13px] disabled:opacity-50'

interface Selection {
  include: boolean
  categoryId: string
  /** For credits: a debit account id (payment transfer) or INCOME_MODE (refund). */
  creditMode: string
}

interface StatementReconciliationPanelProps {
  open: boolean
  onClose: () => void
  account: Account
  debitAccounts: Account[]
  categories: Category[]
}

function looksLikePayment(description: string): boolean {
  return /ABONO|PAGO|GRACIAS/i.test(description)
}

/**
 * Builds selections for the missing movements, keeping any choice the user
 * already made for a line that is still missing after a re-run. Payments are
 * unchecked by default: the user must pick the real source account, because a
 * payment recorded on the debit side as an expense would otherwise double up.
 */
function mergeSelections(
  result: StatementReconciliation,
  debitAccounts: Account[],
  previous: Record<number, Selection>,
): Record<number, Selection> {
  const selections: Record<number, Selection> = {}
  for (const movement of result.movements) {
    if (movement.status !== 'missing') continue
    if (previous[movement.line]) {
      selections[movement.line] = previous[movement.line]
      continue
    }
    const isPayment = movement.direction === 'credit' && looksLikePayment(movement.description)
    selections[movement.line] = {
      include: !isPayment,
      categoryId: '',
      creditMode: isPayment && debitAccounts[0] ? debitAccounts[0].id : INCOME_MODE,
    }
  }
  return selections
}

/**
 * Idempotency key for one statement line. The session nonce scopes retries to
 * a single upload: retrying within it never duplicates, while a later upload
 * (where the matcher already hides movements that exist) gets fresh keys.
 */
function idempotencyKeyFor(
  session: string,
  periodEnd: string,
  movement: StatementMovement,
): string {
  return `stmt-${session}-${periodEnd}-${movement.line}-${movement.amount}`
}

export function StatementReconciliationPanel({
  open,
  onClose,
  account,
  debitAccounts,
  categories,
}: StatementReconciliationPanelProps) {
  const queryClient = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [session, setSession] = useState('')
  const [result, setResult] = useState<StatementReconciliation | null>(null)
  const [selections, setSelections] = useState<Record<number, Selection>>({})
  const [cardConfirmed, setCardConfirmed] = useState(false)
  const [notice, setNotice] = useState('')
  const [failedLines, setFailedLines] = useState<number[]>([])

  const analyze = useMutation({
    mutationFn: (pdf: File) => api.reconcileStatement(account.id, pdf),
    onSuccess: (next) => {
      setResult(next)
      setSelections((previous) => mergeSelections(next, debitAccounts, previous))
    },
  })

  const cardMismatch = result?.statement.warnings.includes('card_last4_mismatch') ?? false
  const blockedByCard = cardMismatch && !cardConfirmed

  const missing = (result?.movements ?? []).filter((movement) => movement.status === 'missing')
  const selected = missing.filter((movement) => selections[movement.line]?.include)

  const apply = useMutation({
    mutationFn: async () => {
      if (!result) return { created: 0, failed: [] as number[] }
      let created = 0
      const failed: number[] = []
      for (const movement of selected) {
        const selection = selections[movement.line]
        const key = idempotencyKeyFor(session, result.statement.periodEnd, movement)
        const base = {
          amount: movement.amount,
          date: movement.operationDate,
          description: movement.description,
        }
        try {
          if (movement.direction === 'charge') {
            await api.createTransaction(
              {
                ...base,
                accountId: account.id,
                type: 'expense',
                categoryId: selection.categoryId || null,
              },
              { idempotencyKey: key },
            )
          } else if (selection.creditMode === INCOME_MODE) {
            await api.createTransaction(
              {
                ...base,
                accountId: account.id,
                type: 'income',
                categoryId: selection.categoryId || null,
              },
              { idempotencyKey: key },
            )
          } else {
            await api.createTransaction(
              {
                ...base,
                accountId: selection.creditMode,
                transferToAccountId: account.id,
                type: 'transfer',
                categoryId: null,
              },
              { idempotencyKey: key },
            )
          }
          created++
        } catch {
          failed.push(movement.line)
        }
      }
      return { created, failed }
    },
    onSuccess: ({ created, failed }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions })
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
      setFailedLines(failed)
      setNotice(
        failed.length > 0
          ? `${created} registrado(s), ${failed.length} con error. Reintentar no duplica los ya creados.`
          : `${created} movimiento(s) registrados.`,
      )
      if (file) analyze.mutate(file)
    },
  })

  const saveStatement = useMutation({
    mutationFn: () => {
      if (!result) throw new Error('missing statement')
      const { statement } = result
      return api.confirmCreditCardStatement(account.id, {
        cycleStartDate: statement.periodStart,
        cycleEndDate: statement.periodEnd,
        paymentDueDate: statement.paymentDueDate,
        statementBalance: statement.paymentToAvoidInterest,
        minimumPayment: statement.minimumPayment ?? undefined,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.creditCardStatements(account.id) })
      setNotice('Corte guardado en budg.')
    },
  })

  const reset = () => {
    analyze.reset()
    apply.reset()
    saveStatement.reset()
    setFile(null)
    setSession('')
    setResult(null)
    setSelections({})
    setCardConfirmed(false)
    setFailedLines([])
    setNotice('')
  }

  const close = () => {
    reset()
    onClose()
  }

  const updateSelection = (line: number, patch: Partial<Selection>) =>
    setSelections((current) => ({ ...current, [line]: { ...current[line], ...patch } }))

  const expenseCategories = categories.filter((category) => category.kind === 'expense')
  const incomeCategories = categories.filter((category) => category.kind === 'income')
  const money = (amount: number) => formatMoney(amount, account.currency)

  const installments = (result?.movements ?? []).filter(
    (movement) => movement.status === 'installment_unmatched',
  )

  return (
    <MockActionPanel
      open={open}
      title="Conciliar estado de cuenta"
      description="Sube el PDF de tu tarjeta. Budg lo lee en su servidor, no lo guarda ni lo envía a terceros."
      submitLabel={`Registrar ${selected.length} movimiento(s)`}
      submitting={apply.isPending || analyze.isPending}
      onClose={close}
      onSubmit={result && selected.length > 0 && !blockedByCard ? () => apply.mutate() : undefined}
    >
      {!result ? (
        <div className="space-y-1.5">
          <Label htmlFor="statement-pdf">Estado de cuenta (PDF)</Label>
          <input
            id="statement-pdf"
            type="file"
            accept="application/pdf"
            disabled={analyze.isPending}
            onChange={(event) => {
              const picked = event.target.files?.[0]
              event.target.value = ''
              if (!picked) return
              setFile(picked)
              setSession(crypto.randomUUID())
              setNotice('')
              analyze.mutate(picked)
            }}
            className="block w-full text-xs file:mr-2 file:rounded-md file:border file:border-input file:bg-background file:px-2 file:py-1 file:text-xs"
          />
          <p className="text-[11px] text-muted-foreground">
            Soportado: tarjetas de crédito Banamex (Joy, Oro, Platinum).
          </p>
          {analyze.isPending && <p className="text-xs text-muted-foreground">Leyendo PDF…</p>}
          {analyze.error && (
            <p role="alert" className="text-xs text-destructive">
              {analyze.error.message}
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="rounded-lg bg-muted p-2.5 text-[11px] text-muted-foreground">
            <p className="font-medium text-foreground">
              {result.statement.product || 'Tarjeta'} · corte{' '}
              {formatDate(result.statement.periodEnd)}
            </p>
            <p>
              Periodo {formatDate(result.statement.periodStart)} –{' '}
              {formatDate(result.statement.periodEnd)} · vence{' '}
              {formatDate(result.statement.paymentDueDate)}
            </p>
            <p>
              Pago para no generar intereses {money(result.statement.paymentToAvoidInterest)}
              {result.statement.minimumPayment !== null &&
                ` · mínimo ${money(result.statement.minimumPayment)}`}
            </p>
          </div>

          {result.statement.warnings.map((warning) => (
            <p key={warning} role="alert" className="text-xs text-[hsl(var(--color-yellow))]">
              {WARNING_MESSAGES[warning] ?? warning}
            </p>
          ))}
          {cardMismatch && (
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={cardConfirmed}
                onChange={(event) => setCardConfirmed(event.target.checked)}
                className="mt-0.5"
              />
              <span>
                Confirmo que este estado de cuenta es de {account.name} (••{account.last4}).
              </span>
            </label>
          )}

          <div className="flex flex-wrap gap-1.5" aria-label="Resumen de conciliación">
            <Badge accent="green">{result.summary.matched} ya registrados</Badge>
            <Badge accent={result.summary.missing > 0 ? 'red' : 'green'}>
              {result.summary.missing} faltantes
            </Badge>
            <Badge accent="purple">{result.summary.installmentsMatched} mensualidades</Badge>
            {result.summary.onlyInBudg > 0 && (
              <Badge accent="yellow">{result.summary.onlyInBudg} solo en budg</Badge>
            )}
          </div>

          {missing.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-medium">Faltan en budg</p>
              {missing.map((movement) => {
                const selection = selections[movement.line]
                if (!selection) return null
                const isCredit = movement.direction === 'credit'
                const options =
                  isCredit && selection.creditMode === INCOME_MODE
                    ? incomeCategories
                    : expenseCategories
                return (
                  <div key={movement.line} className="rounded-lg border border-border p-2.5">
                    <label className="flex items-start gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={selection.include}
                        onChange={(event) =>
                          updateSelection(movement.line, { include: event.target.checked })
                        }
                        aria-label={`Registrar ${movement.description}`}
                        className="mt-0.5"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{movement.description}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {formatDate(movement.operationDate)}
                          {failedLines.includes(movement.line) && (
                            <span className="ml-1 text-destructive">· no se pudo registrar</span>
                          )}
                        </span>
                      </span>
                      <span
                        className={
                          isCredit
                            ? 'tabular-nums text-[hsl(var(--color-green))]'
                            : 'tabular-nums text-[hsl(var(--color-red))]'
                        }
                      >
                        {isCredit ? '+' : '−'}
                        {money(movement.amount)}
                      </span>
                    </label>
                    <div className="mt-2 grid gap-2">
                      {isCredit && (
                        <select
                          aria-label={`Tipo de abono ${movement.description}`}
                          value={selection.creditMode}
                          disabled={!selection.include}
                          onChange={(event) =>
                            updateSelection(movement.line, {
                              creditMode: event.target.value,
                              categoryId: '',
                            })
                          }
                          className={selectClass}
                        >
                          {debitAccounts.map((debit) => (
                            <option key={debit.id} value={debit.id}>
                              Pago desde {debit.name}
                            </option>
                          ))}
                          <option value={INCOME_MODE}>Reembolso (ingreso)</option>
                        </select>
                      )}
                      {isCredit && selection.creditMode !== INCOME_MODE && (
                        <p className="text-[11px] text-muted-foreground">
                          Revisa que este pago no esté ya capturado como gasto en la cuenta origen.
                        </p>
                      )}
                      {(!isCredit || selection.creditMode === INCOME_MODE) && (
                        <select
                          aria-label={`Categoría ${movement.description}`}
                          value={selection.categoryId}
                          disabled={!selection.include}
                          onChange={(event) =>
                            updateSelection(movement.line, { categoryId: event.target.value })
                          }
                          className={selectClass}
                        >
                          <option value="">Sin categoría</option>
                          {options.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-xs text-[hsl(var(--color-green))]">
              Todos los movimientos del PDF ya están en budg.
            </p>
          )}

          {installments.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium">Mensualidades sin MSI en budg</p>
              <p className="text-[11px] text-muted-foreground">
                No se registran como gasto: créalas como compra a meses si faltan.
              </p>
              {installments.map((movement) => (
                <p key={movement.line} className="text-[11px] tabular-nums">
                  {movement.description} {movement.installment?.number}/
                  {movement.installment?.total} · {money(movement.amount)}
                </p>
              ))}
            </div>
          )}

          {result.onlyInBudg.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium">En budg pero no en el PDF</p>
              <p className="text-[11px] text-muted-foreground">
                Pueden ser de otro corte, duplicados o montos distintos. Revísalos a mano.
              </p>
              {result.onlyInBudg.map((tx) => (
                <p key={tx.id} className="text-[11px] tabular-nums">
                  {formatDate(tx.date)} · {tx.description} · {money(tx.amount)}
                </p>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={saveStatement.isPending || blockedByCard}
              onClick={() => saveStatement.mutate()}
            >
              Guardar corte en budg
            </Button>
            <Button variant="ghost" size="sm" onClick={reset}>
              Subir otro PDF
            </Button>
          </div>

          {notice && <p className="text-xs text-[hsl(var(--color-green))]">{notice}</p>}
          {saveStatement.error && (
            <p role="alert" className="text-xs text-destructive">
              No se pudo guardar el corte.
            </p>
          )}
        </>
      )}
    </MockActionPanel>
  )
}
