import { authFetch } from '@/lib/api/backend'
import type { Budget } from '@/types'

/**
 * Budget API client.
 *
 * Talks to the Go backend via `authFetch` (Bearer-token authenticated). The
 * signatures match the previous mock client so callsites in hooks and pages
 * do not need to change. Mirrors ./transactions.ts's structure.
 */

export async function getBudgets(): Promise<Budget[]> {
  const res = await authFetch('/v1/budgets')
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`)
  }
  const body = (await res.json()) as { data: BackendBudget[] }
  return body.data.map(toFrontend)
}

export async function createBudget(input: Omit<Budget, 'id'>): Promise<Budget> {
  const res = await authFetch('/v1/budgets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toBackend(input)),
  })
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`)
  }
  return toFrontend((await res.json()) as BackendBudget)
}

export async function updateBudget(id: string, patch: Partial<Budget>): Promise<void> {
  const res = await authFetch(`/v1/budgets/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toBackendPatch(patch)),
  })
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`)
  }
}

export async function deleteBudget(id: string): Promise<void> {
  const res = await authFetch(`/v1/budgets/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`)
  }
}

// ── Wire format ──────────────────────────────────────────────

interface BackendBudget {
  id: string
  categoryId: string | null
  amount: number
  period: 'weekly' | 'monthly' | 'yearly'
  startDate: string
}

function toFrontend(b: BackendBudget): Budget {
  return {
    id: b.id,
    categoryId: b.categoryId,
    amount: b.amount,
    period: b.period,
    startDate: b.startDate,
  }
}

function toBackend(input: Omit<Budget, 'id'>): Omit<BackendBudget, 'id'> {
  return {
    categoryId: input.categoryId ?? null,
    amount: input.amount,
    period: input.period,
    startDate: input.startDate,
  }
}

function toBackendPatch(patch: Partial<Budget>): Partial<BackendBudget> {
  const out: Partial<BackendBudget> = {}
  if (patch.categoryId !== undefined) out.categoryId = patch.categoryId
  if (patch.amount !== undefined) out.amount = patch.amount
  if (patch.period !== undefined) out.period = patch.period
  if (patch.startDate !== undefined) out.startDate = patch.startDate
  return out
}
