import { authFetch } from '@/lib/api/backend'
import { toFrontend, type BackendAccount } from '@/lib/api/accounts'
import type { Account, YieldReconciliation, YieldReconciliationInput } from '@/types'

const ERROR_MESSAGES: Record<string, string> = {
  invalid_request:
    'Revisa los montos: el rendimiento no puede superar la diferencia y la fecha no puede ser anterior a la última conciliación.',
  balance_tracking_conflict: 'Activa el seguimiento de saldo de esta cuenta antes de conciliar.',
  not_found: 'No se encontró la cuenta o la conciliación.',
  idempotency_conflict:
    'Esta conciliación ya se registró con otros datos. Cierra y vuelve a abrir.',
  idempotency_resource_deleted: 'Esta conciliación se registró y luego se deshizo.',
  yield_reconciliation_not_latest: 'Solo se puede deshacer la conciliación más reciente.',
  yield_date_before_movements:
    'Hay movimientos posteriores a esa fecha. Concilia con el saldo de hoy de tu banco.',
  goal_allocation_conflict:
    'Las metas ya usaron parte de ese rendimiento. Libera fondos de las metas antes de deshacer.',
}

/** Error carrying the backend code for precise user messages. */
export class YieldReconciliationError extends Error {
  readonly code: string

  constructor(code: string) {
    super(ERROR_MESSAGES[code] ?? 'No se pudo completar la conciliación de rendimientos.')
    this.name = 'YieldReconciliationError'
    this.code = code
  }
}

async function failure(res: Response): Promise<never> {
  let code = 'unknown'
  try {
    const payload = (await res.json()) as { error?: { code?: string } }
    code = payload.error?.code ?? code
  } catch {
    // Non-JSON body: generic message.
  }
  throw new YieldReconciliationError(code)
}

export async function getYieldReconciliations(): Promise<YieldReconciliation[]> {
  const res = await authFetch('/v1/yield-reconciliations')
  if (!res.ok) return failure(res)
  const body = (await res.json()) as { data: YieldReconciliation[] }
  return body.data
}

export async function reconcileYield(
  accountId: string,
  input: YieldReconciliationInput,
  options: { idempotencyKey: string },
): Promise<{ reconciliation: YieldReconciliation; account: Account }> {
  const res = await authFetch(`/v1/accounts/${accountId}/yield-reconciliations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': options.idempotencyKey },
    body: JSON.stringify(input),
  })
  if (!res.ok) return failure(res)
  const body = (await res.json()) as {
    reconciliation: YieldReconciliation
    account: BackendAccount
  }
  return { reconciliation: body.reconciliation, account: toFrontend(body.account) }
}

export async function undoYieldReconciliation(accountId: string, id: string): Promise<Account> {
  const res = await authFetch(`/v1/accounts/${accountId}/yield-reconciliations/${id}`, {
    method: 'DELETE',
  })
  if (!res.ok) return failure(res)
  return toFrontend((await res.json()) as BackendAccount)
}
