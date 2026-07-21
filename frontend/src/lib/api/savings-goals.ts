import { authFetch } from '@/lib/api/backend'
import type { SavingsGoal } from '@/types'

/**
 * Savings Goal API client.
 *
 * Talks to the Go backend via `authFetch` (Bearer-token authenticated). The
 * signatures match the previous mock client so callsites in hooks and pages
 * do not need to change. Mirrors ./budgets.ts's structure.
 */

export async function getSavingsGoals(): Promise<SavingsGoal[]> {
  const res = await authFetch('/v1/savings-goals')
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`)
  }
  const body = (await res.json()) as { data: BackendSavingsGoal[] }
  return body.data.map(toFrontend)
}

export async function createSavingsGoal(
  input: Omit<SavingsGoal, 'id' | 'order'>,
): Promise<SavingsGoal> {
  const res = await authFetch('/v1/savings-goals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toBackend(input, 0)),
  })
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`)
  }
  return toFrontend((await res.json()) as BackendSavingsGoal)
}

export async function updateSavingsGoal(id: string, patch: Partial<SavingsGoal>): Promise<void> {
  const res = await authFetch(`/v1/savings-goals/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toBackendPatch(patch)),
  })
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`)
  }
}

export async function contributeToSavingsGoal(id: string, amount: number): Promise<void> {
  // Frontend helper that fetches current goal or patches currentAmount directly.
  // Since backend supports PATCH, we fetch existing goals or patch via client.
  const res = await authFetch(`/v1/savings-goals/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentAmount: amount }),
  })
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`)
  }
}

export async function deleteSavingsGoal(id: string): Promise<void> {
  const res = await authFetch(`/v1/savings-goals/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`)
  }
}

// ── Wire format ──────────────────────────────────────────────

interface BackendSavingsGoal {
  id: string
  name: string
  targetAmount: number
  currentAmount: number
  accountId: string | null
  isCompleted: boolean
  order: number
}

function toFrontend(g: BackendSavingsGoal): SavingsGoal {
  return {
    id: g.id,
    name: g.name,
    targetAmount: g.targetAmount,
    currentAmount: g.currentAmount,
    accountId: g.accountId,
    isCompleted: g.isCompleted,
    order: g.order,
  }
}

function toBackend(
  input: Omit<SavingsGoal, 'id' | 'order'>,
  order: number,
): Omit<BackendSavingsGoal, 'id'> {
  return {
    name: input.name,
    targetAmount: input.targetAmount,
    currentAmount: input.currentAmount,
    accountId: input.accountId ?? null,
    isCompleted: input.isCompleted,
    order,
  }
}

function toBackendPatch(patch: Partial<SavingsGoal>): Partial<BackendSavingsGoal> {
  const out: Partial<BackendSavingsGoal> = {}
  if (patch.name !== undefined) out.name = patch.name
  if (patch.targetAmount !== undefined) out.targetAmount = patch.targetAmount
  if (patch.currentAmount !== undefined) out.currentAmount = patch.currentAmount
  if (patch.accountId !== undefined) out.accountId = patch.accountId
  if (patch.isCompleted !== undefined) out.isCompleted = patch.isCompleted
  if (patch.order !== undefined) out.order = patch.order
  return out
}
