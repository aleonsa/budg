import { authFetch } from '@/lib/api/backend'
import type { CreditCardStatement, CreditCardStatementInput } from '@/types'

export async function getCreditCardStatements(accountId: string): Promise<CreditCardStatement[]> {
  const res = await authFetch(`/v1/accounts/${accountId}/credit-card-statements`)
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  const body = (await res.json()) as { data: CreditCardStatement[] }
  return body.data
}

export async function confirmCreditCardStatement(
  accountId: string,
  input: CreditCardStatementInput,
): Promise<CreditCardStatement> {
  const res = await authFetch(`/v1/accounts/${accountId}/credit-card-statements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  return (await res.json()) as CreditCardStatement
}
