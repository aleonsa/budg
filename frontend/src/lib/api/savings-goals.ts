import { authFetch } from '@/lib/api/backend'
import type { SavingsGoal, SavingsOverview } from '@/types'

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

export type SavingsGoalPatch = Omit<
  Partial<SavingsGoal>,
  'targetDate' | 'currentAmount' | 'isCompleted'
> & {
  targetDate?: string | null
}

export async function updateSavingsGoal(id: string, patch: SavingsGoalPatch): Promise<void> {
  const res = await authFetch(`/v1/savings-goals/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toBackendPatch(patch)),
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

export async function getSavingsOverview(): Promise<SavingsOverview> {
  const res = await authFetch('/v1/savings-goals/overview')
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  return (await res.json()) as SavingsOverview
}

export interface SaveToGoalInput {
  sourceAccountId: string
  destinationAccountId: string
  amount: number
  date: string
  description: string
}

export interface SavingsAllocationInput {
  accountId: string
  amount: number
  date: string
}

export interface SavingsReallocationInput {
  toGoalId: string
  accountId: string
  amount: number
  date: string
}

function idempotentHeaders(key: string) {
  return new Headers({ 'Content-Type': 'application/json', 'Idempotency-Key': key })
}

export async function saveToGoal(
  id: string,
  input: SaveToGoalInput,
  options: { idempotencyKey: string },
): Promise<void> {
  const res = await authFetch(`/v1/savings-goals/${id}/savings`, {
    method: 'POST',
    headers: idempotentHeaders(options.idempotencyKey),
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
}

export async function allocateSavings(
  id: string,
  input: SavingsAllocationInput,
  options: { idempotencyKey: string },
): Promise<void> {
  const res = await authFetch(`/v1/savings-goals/${id}/allocations`, {
    method: 'POST',
    headers: idempotentHeaders(options.idempotencyKey),
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
}

export async function reallocateSavings(
  id: string,
  input: SavingsReallocationInput,
  options: { idempotencyKey: string },
): Promise<void> {
  const res = await authFetch(`/v1/savings-goals/${id}/reallocations`, {
    method: 'POST',
    headers: idempotentHeaders(options.idempotencyKey),
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
}

// ── Wire format ──────────────────────────────────────────────

interface BackendSavingsGoal {
  id: string
  name: string
  targetAmount: number
  currentAmount: number
  targetDate: string | null
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
    targetDate: g.targetDate ?? undefined,
    accountId: g.accountId,
    isCompleted: g.isCompleted,
    order: g.order,
  }
}

function toBackend(input: Omit<SavingsGoal, 'id' | 'order'>, order: number) {
  return {
    name: input.name,
    targetAmount: input.targetAmount,
    currentAmount: input.currentAmount,
    targetDate: input.targetDate ?? null,
    accountId: input.accountId ?? null,
    order,
  }
}

function toBackendPatch(patch: SavingsGoalPatch): Partial<BackendSavingsGoal> {
  const out: Partial<BackendSavingsGoal> = {}
  if (patch.name !== undefined) out.name = patch.name
  if (patch.targetAmount !== undefined) out.targetAmount = patch.targetAmount
  if (patch.targetDate !== undefined) out.targetDate = patch.targetDate
  if (patch.accountId !== undefined) out.accountId = patch.accountId
  if (patch.order !== undefined) out.order = patch.order
  return out
}
