import { authFetch } from '@/lib/api/backend'
import type { MSIPurchase } from '@/types'

/**
 * MSI Purchase API client.
 *
 * Talks to the Go backend via `authFetch` (Bearer-token authenticated). This
 * resource is read-only end to end -- there is no create/update/delete
 * mutation anywhere in the app -- so only `getMSIPurchases` exists here.
 * Mirrors ./budgets.ts's structure.
 */

export async function getMSIPurchases(): Promise<MSIPurchase[]> {
  const res = await authFetch('/v1/msi-purchases')
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`)
  }
  const body = (await res.json()) as { data: BackendMSIPurchase[] }
  return body.data.map(toFrontend)
}

// ── Wire format ──────────────────────────────────────────────

interface BackendMSIPurchase {
  id: string
  accountId: string
  categoryId: string | null
  description: string
  merchant?: string
  totalAmount: number
  installmentAmount: number
  installmentCount: number
  installmentsPaid: number
  startDate: string
  nextInstallmentDate?: string
  status: 'active' | 'completed'
}

function toFrontend(m: BackendMSIPurchase): MSIPurchase {
  return {
    id: m.id,
    accountId: m.accountId,
    categoryId: m.categoryId,
    description: m.description,
    merchant: m.merchant,
    totalAmount: m.totalAmount,
    installmentAmount: m.installmentAmount,
    installmentCount: m.installmentCount,
    installmentsPaid: m.installmentsPaid,
    startDate: m.startDate,
    nextInstallmentDate: m.nextInstallmentDate,
    status: m.status,
  }
}
