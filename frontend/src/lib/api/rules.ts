import { authFetch } from '@/lib/api/backend'
import type { Rule } from '@/types'

export async function getRules(): Promise<Rule[]> {
  const res = await authFetch('/v1/rules')
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`)
  }
  const body = (await res.json()) as { data: BackendRule[] }
  return body.data.map(toFrontend)
}

export async function createRule(input: Omit<Rule, 'id' | 'priority'>): Promise<Rule> {
  const res = await authFetch('/v1/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`)
  }
  return toFrontend((await res.json()) as BackendRule)
}

export async function toggleRule(id: string): Promise<void> {
  const res = await authFetch(`/v1/rules/${id}/toggle`, { method: 'POST' })
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`)
  }
}

export async function deleteRule(id: string): Promise<void> {
  const res = await authFetch(`/v1/rules/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`)
  }
}

interface BackendRule {
  id: string
  field: Rule['field']
  operator: Rule['operator']
  value: string
  categoryId: string
  isActive: boolean
  priority: number
}

function toFrontend(rule: BackendRule): Rule {
  return rule
}
