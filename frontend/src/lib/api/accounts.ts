import { authFetch } from '@/lib/api/backend'
import type { Account } from '@/types'

/**
 * Account API client.
 *
 * Talks to the Go backend via `authFetch` (Bearer-token authenticated). The
 * signatures match the previous mock client so callsites in hooks and pages
 * do not need to change. Mirrors ./categories.ts's structure.
 */

export async function getAccounts(): Promise<Account[]> {
  const res = await authFetch('/v1/accounts')
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`)
  }
  const body = (await res.json()) as { data: BackendAccount[] }
  return body.data.map(toFrontend)
}

export async function createAccount(input: Omit<Account, 'id' | 'isActive'>): Promise<Account> {
  const res = await authFetch('/v1/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toBackend(input)),
  })
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`)
  }
  return toFrontend((await res.json()) as BackendAccount)
}

export async function updateAccount(id: string, patch: Partial<Account>): Promise<void> {
  const res = await authFetch(`/v1/accounts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toBackendPatch(patch)),
  })
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`)
  }
}

export async function deleteAccount(id: string): Promise<void> {
  const res = await authFetch(`/v1/accounts/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`)
  }
}

// ── Wire format ──────────────────────────────────────────────
// Backend JSON uses the same camelCase contract the frontend already uses,
// field-for-field (no `order`-style renames like categories has).

interface BackendAccount {
  id: string
  name: string
  type: 'debit' | 'credit'
  institution: string
  last4: string
  currency: 'MXN' | 'USD'
  balance?: number
  creditLimit?: number
  availableCredit?: number
  statementCutDay?: number
  paymentDueDay?: number
  isActive: boolean
}

function toFrontend(a: BackendAccount): Account {
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    institution: a.institution,
    last4: a.last4,
    currency: a.currency,
    balance: a.balance,
    creditLimit: a.creditLimit,
    availableCredit: a.availableCredit,
    statementCutDay: a.statementCutDay,
    paymentDueDay: a.paymentDueDay,
    isActive: a.isActive,
  }
}

function toBackend(
  input: Omit<Account, 'id' | 'isActive'>,
): Omit<BackendAccount, 'id' | 'isActive'> {
  return {
    name: input.name,
    type: input.type,
    institution: input.institution,
    last4: input.last4,
    currency: input.currency,
    balance: input.balance,
    creditLimit: input.creditLimit,
    availableCredit: input.availableCredit,
    statementCutDay: input.statementCutDay,
    paymentDueDay: input.paymentDueDay,
  }
}

function toBackendPatch(patch: Partial<Account>): Partial<BackendAccount> {
  const out: Partial<BackendAccount> = {}
  if (patch.name !== undefined) out.name = patch.name
  if (patch.institution !== undefined) out.institution = patch.institution
  if (patch.last4 !== undefined) out.last4 = patch.last4
  if (patch.currency !== undefined) out.currency = patch.currency
  if (patch.isActive !== undefined) out.isActive = patch.isActive
  if (patch.balance !== undefined) out.balance = patch.balance
  if (patch.creditLimit !== undefined) out.creditLimit = patch.creditLimit
  if (patch.availableCredit !== undefined) out.availableCredit = patch.availableCredit
  if (patch.statementCutDay !== undefined) out.statementCutDay = patch.statementCutDay
  if (patch.paymentDueDay !== undefined) out.paymentDueDay = patch.paymentDueDay
  return out
}
