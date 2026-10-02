import { authFetch } from '@/lib/api/backend'
import type { StatementReconciliation } from '@/types'

const ERROR_MESSAGES: Record<string, string> = {
  invalid_file: 'El archivo no es un PDF válido.',
  payload_too_large: 'El PDF supera el límite de 4 MB.',
  unreadable_statement: 'El PDF no tiene texto legible (¿es un escaneo?).',
  unsupported_statement: 'Por ahora solo se soportan estados de cuenta de tarjeta Banamex.',
  not_found: 'No se encontró la tarjeta.',
  invalid_request: 'La solicitud no es válida para esta cuenta.',
}

/** Error carrying the backend error code so the UI can show a precise message. */
export class StatementReconciliationError extends Error {
  readonly code: string

  constructor(code: string) {
    super(ERROR_MESSAGES[code] ?? 'No se pudo procesar el estado de cuenta.')
    this.name = 'StatementReconciliationError'
    this.code = code
  }
}

/**
 * Uploads a credit card statement PDF for in-memory parsing and comparison
 * against the account's recorded transactions. The backend never stores it.
 */
export async function reconcileStatement(
  accountId: string,
  file: File,
): Promise<StatementReconciliation> {
  const body = new FormData()
  body.append('file', file)
  const res = await authFetch(`/v1/accounts/${accountId}/statement-reconciliations`, {
    method: 'POST',
    body,
  })
  if (!res.ok) {
    let code = 'unknown'
    try {
      const payload = (await res.json()) as { error?: { code?: string } }
      code = payload.error?.code ?? code
    } catch {
      // Non-JSON error body: fall back to the generic message.
    }
    throw new StatementReconciliationError(code)
  }
  return (await res.json()) as StatementReconciliation
}
