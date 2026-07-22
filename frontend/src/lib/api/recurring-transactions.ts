import { authFetch } from '@/lib/api/backend'
import type { RecurringTransaction } from '@/types'

export interface CreateRecurringTransactionInput {
  accountId: string
  categoryId: string | null
  description: string
  merchant?: string
  amount: number
  frequency: RecurringTransaction['frequency']
  startDate: string
}

export async function getRecurringTransactions(): Promise<RecurringTransaction[]> {
  const res = await authFetch('/v1/recurring-transactions')
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`)
  }
  const body = (await res.json()) as { data: BackendRecurringTransaction[] }
  return body.data.map(toFrontend)
}

export async function createRecurringTransaction(
  input: CreateRecurringTransactionInput,
): Promise<RecurringTransaction> {
  const res = await authFetch('/v1/recurring-transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`)
  }
  return toFrontend((await res.json()) as BackendRecurringTransaction)
}

export async function processRecurringTransactions(): Promise<{ created: number }> {
  const res = await authFetch('/v1/recurring-transactions/process', { method: 'POST' })
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`)
  }
  return (await res.json()) as { created: number }
}

interface BackendRecurringTransaction {
  id: string
  accountId: string
  categoryId: string | null
  description: string
  merchant?: string
  amount: number
  frequency: 'monthly' | 'yearly'
  startDate: string
  nextDate: string
  isActive: boolean
}

function toFrontend(transaction: BackendRecurringTransaction): RecurringTransaction {
  return transaction
}
