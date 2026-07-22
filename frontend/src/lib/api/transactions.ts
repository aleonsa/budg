import { authFetch } from '@/lib/api/backend'
import type { Transaction } from '@/types'

/**
 * Transaction API client.
 *
 * Talks to the Go backend via `authFetch` (Bearer-token authenticated). The
 * signatures match the previous mock client so callsites in hooks and pages
 * do not need to change. Mirrors ./accounts.ts's structure.
 */

export async function getTransactions(): Promise<Transaction[]> {
  const res = await authFetch('/v1/transactions')
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`)
  }
  const body = (await res.json()) as { data: BackendTransaction[] }
  return body.data.map(toFrontend)
}

export async function createTransaction(
  input: Omit<Transaction, 'id' | 'createdAt' | 'isReconciled'>,
  options?: { idempotencyKey?: string },
): Promise<Transaction> {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (options?.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey)
  const res = await authFetch('/v1/transactions', {
    method: 'POST',
    headers,
    body: JSON.stringify(toBackend(input)),
  })
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`)
  }
  return toFrontend((await res.json()) as BackendTransaction)
}

export async function updateTransaction(id: string, patch: Partial<Transaction>): Promise<void> {
  const res = await authFetch(`/v1/transactions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toBackendPatch(patch)),
  })
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`)
  }
}

export async function deleteTransaction(id: string): Promise<void> {
  const res = await authFetch(`/v1/transactions/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`)
  }
}

// ── Wire format ──────────────────────────────────────────────

interface BackendTransaction {
  id: string
  accountId: string
  type: 'expense' | 'income' | 'transfer'
  amount: number
  categoryId: string | null
  date: string
  description: string
  merchant?: string
  msiPurchaseId?: string
  transferToAccountId?: string
  creditCardStatementId?: string
  affectsBalance?: boolean
  isReconciled: boolean
  createdAt: string
}

function toFrontend(t: BackendTransaction): Transaction {
  return {
    id: t.id,
    accountId: t.accountId,
    type: t.type,
    amount: t.amount,
    categoryId: t.categoryId,
    date: t.date,
    description: t.description,
    merchant: t.merchant,
    msiPurchaseId: t.msiPurchaseId,
    transferToAccountId: t.transferToAccountId,
    creditCardStatementId: t.creditCardStatementId,
    affectsBalance: t.affectsBalance,
    isReconciled: t.isReconciled,
    createdAt: t.createdAt,
  }
}

function toBackend(
  input: Omit<Transaction, 'id' | 'createdAt' | 'isReconciled'>,
): Omit<BackendTransaction, 'id' | 'createdAt' | 'isReconciled'> {
  return {
    accountId: input.accountId,
    type: input.type,
    amount: input.amount,
    categoryId: input.categoryId ?? null,
    date: input.date,
    description: input.description,
    merchant: input.merchant,
    msiPurchaseId: input.msiPurchaseId,
    transferToAccountId: input.transferToAccountId,
    creditCardStatementId: input.creditCardStatementId,
    affectsBalance: input.affectsBalance,
  }
}

function toBackendPatch(patch: Partial<Transaction>): Partial<BackendTransaction> {
  const out: Partial<BackendTransaction> = {}
  if (patch.accountId !== undefined) out.accountId = patch.accountId
  if (patch.type !== undefined) out.type = patch.type
  if (patch.amount !== undefined) out.amount = patch.amount
  if (patch.categoryId !== undefined) out.categoryId = patch.categoryId
  if (patch.date !== undefined) out.date = patch.date
  if (patch.description !== undefined) out.description = patch.description
  if (patch.merchant !== undefined) out.merchant = patch.merchant
  if (patch.msiPurchaseId !== undefined) out.msiPurchaseId = patch.msiPurchaseId
  if (patch.transferToAccountId !== undefined) out.transferToAccountId = patch.transferToAccountId
  if (patch.creditCardStatementId !== undefined)
    out.creditCardStatementId = patch.creditCardStatementId
  if (patch.affectsBalance !== undefined) out.affectsBalance = patch.affectsBalance
  if (patch.isReconciled !== undefined) out.isReconciled = patch.isReconciled
  return out
}
