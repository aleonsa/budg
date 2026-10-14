import { authFetch } from '@/lib/api/backend'

export interface Loan {
  id: string
  accountId: string
  description: string
  lender?: string
  principalCents: number
  annualRateBps: number
  termMonths: number
  monthlyPaymentCents: number
  startDate: string
  dayOfMonth: number
  status: 'active' | 'paid_off'
  remainingCents: number
}
export interface LoanPayment {
  id: string
  loanId: string
  sequence: number
  dueDate: string
  principalCents: number
  interestCents: number
  totalCents: number
  paidPrincipalCents?: number
  paidInterestCents?: number
  paidTotalCents?: number
  paidAt?: string
  createdAt: string
  transactionId?: string
  status: 'pending' | 'paid' | 'adjustment'
}
export interface LoanDetail {
  loan: Loan
  payments: LoanPayment[]
}
export type LoanInput = Omit<Loan, 'id' | 'status' | 'remainingCents'>
export interface LoanSimulation {
  interestSavedCents: number
  monthsSaved: number
  newPayoffDate: string
  estimated: boolean
  schedule: Array<{
    sequence: number
    dueDate: string
    principalCents: number
    interestCents: number
    totalCents: number
    remainingCents: number
  }>
}

async function request<T>(path: string, method = 'GET', input?: unknown, key?: string): Promise<T> {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (key) headers.set('Idempotency-Key', key)
  const response = await authFetch(`/v1/loans${path}`, {
    method,
    headers,
    body: input === undefined ? undefined : JSON.stringify(input),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null
    const message =
      body?.error?.code === 'loan_conflict'
        ? 'Revisa el orden de pagos, desglose y fechas. La cuenta debe ser débito MXN con seguimiento de saldo. No se puede eliminar un préstamo con historial.'
        : 'No se pudo guardar. Revisa los datos y vuelve a intentar.'
    throw new Error(message)
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
}
export const loanApi = {
  list: async () => (await request<{ data: Loan[] }>('')).data,
  get: (id: string) => request<LoanDetail>(`/${id}`),
  create: (input: LoanInput, key: string) => request<Loan>('', 'POST', input, key),
  update: (id: string, input: { accountId: string; description: string; lender: string | null }) =>
    request<Loan>(`/${id}`, 'PATCH', input),
  delete: (id: string) => request<void>(`/${id}`, 'DELETE'),
  pay: (
    id: string,
    paymentId: string,
    input: {
      date: string
      paidTotalCents: number
      paidPrincipalCents: number
      paidInterestCents: number
      categoryId: string | null
    },
  ) => request<LoanPayment>(`/${id}/payments/${paymentId}/pay`, 'POST', input),
  extra: (
    id: string,
    input: { date: string; amountCents: number; categoryId: string | null },
    key: string,
  ) => request(`/${id}/extra-payments`, 'POST', input, key),
  reconcile: (id: string, input: { asOfDate: string; actualBalanceCents: number }) =>
    request<LoanPayment>(`/${id}/reconcile`, 'POST', input),
  undo: (id: string, paymentId: string) => request<void>(`/${id}/payments/${paymentId}`, 'DELETE'),
  calculate: (id: string, input: { date: string; amountCents: number }) =>
    request<LoanSimulation>(`/${id}/calculate`, 'POST', input),
}
