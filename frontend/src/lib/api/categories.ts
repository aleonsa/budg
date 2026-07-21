import { authFetch } from '@/lib/api/backend'
import type { Category } from '@/types'

/**
 * Category API client.
 *
 * Talks to the Go backend via `authFetch` (Bearer-token authenticated). The
 * signatures match the previous mock client so callsites in hooks and pages
 * do not need to change.
 */

const SORT_DELAY = 0

export async function getCategories(): Promise<Category[]> {
  const res = await authFetch('/v1/categories')
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`)
  }
  const body = (await res.json()) as { data: BackendCategory[] }
  return body.data.map(toFrontend)
}

export async function createCategory(
  input: Omit<Category, 'id' | 'order' | 'isSystem'>,
): Promise<Category> {
  const res = await authFetch('/v1/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toBackend(input, SORT_DELAY)),
  })
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`)
  }
  return toFrontend((await res.json()) as BackendCategory)
}

export async function updateCategory(id: string, patch: Partial<Category>): Promise<void> {
  const res = await authFetch(`/v1/categories/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toBackendPatch(patch)),
  })
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`)
  }
}

export async function deleteCategory(id: string): Promise<void> {
  const res = await authFetch(`/v1/categories/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`)
  }
}

// ── Wire format ──────────────────────────────────────────────
// Backend JSON uses the same camelCase contract the frontend already uses,
// but `order` maps to the column `sort_order`. Keeping the translation in one
// place means future schema drift only needs to be fixed here.

interface BackendCategory {
  id: string
  name: string
  kind: 'expense' | 'income'
  color: string
  icon: string
  parentId: string | null
  isSystem: boolean
  order: number
}

function toFrontend(c: BackendCategory): Category {
  return {
    id: c.id,
    name: c.name,
    kind: c.kind,
    color: c.color as Category['color'],
    icon: c.icon,
    parentId: c.parentId,
    isSystem: c.isSystem,
    order: c.order,
  }
}

function toBackend(
  input: Omit<Category, 'id' | 'order' | 'isSystem'>,
  order: number,
): BackendCategory {
  return {
    id: '',
    name: input.name,
    kind: input.kind,
    color: input.color,
    icon: input.icon,
    parentId: input.parentId,
    isSystem: false,
    order,
  }
}

function toBackendPatch(patch: Partial<Category>): Partial<BackendCategory> {
  const out: Partial<BackendCategory> = {}
  if (patch.name !== undefined) out.name = patch.name
  if (patch.color !== undefined) out.color = patch.color
  if (patch.icon !== undefined) out.icon = patch.icon
  if (patch.parentId !== undefined) out.parentId = patch.parentId
  if (patch.order !== undefined) out.order = patch.order
  return out
}
