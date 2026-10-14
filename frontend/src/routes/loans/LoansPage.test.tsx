import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAccounts, useCategories } from '@/hooks/useQueries'
import { loanApi, type Loan, type LoanPayment } from '@/lib/api/loans'
import LoansPage from './LoansPage'
import type { Category } from '@/types'

vi.mock('@/hooks/useQueries', () => ({ useAccounts: vi.fn(), useCategories: vi.fn() }))
vi.mock('@/components/layout/Header', () => ({
  Header: ({ title, action }: { title: string; action: React.ReactNode }) => (
    <header>
      {title}
      {action}
    </header>
  ),
}))
vi.mock('@/lib/api/loans', () => ({
  loanApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    pay: vi.fn(),
    extra: vi.fn(),
    reconcile: vi.fn(),
    undo: vi.fn(),
    calculate: vi.fn(),
  },
}))

const loan: Loan = {
  id: 'loan-1',
  accountId: 'acct-1',
  description: 'K4',
  lender: 'Inbursa',
  principalCents: 27690000,
  remainingCents: 27690000,
  annualRateBps: 1373,
  monthlyPaymentCents: 640428,
  termMonths: 60,
  dayOfMonth: 13,
  startDate: '2026-12-13',
  status: 'active',
}
const payment: LoanPayment = {
  id: 'payment-1',
  loanId: loan.id,
  sequence: 1,
  dueDate: '2026-12-13',
  principalCents: 323608,
  interestCents: 316820,
  totalCents: 640428,
  status: 'pending',
  createdAt: '2026-10-14T10:00:00Z',
}

function renderPage(path = '/loans') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/loans" element={<LoansPage />} />
          <Route path="/loans/:loanId" element={<LoansPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useAccounts).mockReturnValue({
    data: [
      {
        id: 'acct-1',
        name: 'Platinum',
        type: 'debit',
        currency: 'MXN',
        isActive: true,
        balanceTrackingEnabled: true,
      },
    ],
    isLoading: false,
  } as ReturnType<typeof useAccounts>)
  vi.mocked(useCategories).mockReturnValue({
    data: [] as Category[],
    isLoading: false,
  } as ReturnType<typeof useCategories>)
  vi.mocked(loanApi.list).mockResolvedValue([loan])
  vi.mocked(loanApi.get).mockResolvedValue({ loan, payments: [payment] })
  vi.mocked(loanApi.create).mockResolvedValue(loan)
  vi.mocked(loanApi.pay).mockResolvedValue({ ...payment, status: 'paid' })
  vi.mocked(loanApi.calculate).mockResolvedValue({
    interestSavedCents: 10000,
    monthsSaved: 2,
    newPayoffDate: '2031-09-13',
    estimated: true,
    schedule: [],
  })
})
afterEach(cleanup)

describe('LoansPage', () => {
  it('creates only loan terms using the vehicle-only quotation preset', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Nuevo préstamo' }))
    await user.click(screen.getByRole('button', { name: 'Usar cotización K4' }))
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() =>
      expect(loanApi.create).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 'acct-1',
          principalCents: 27690000,
          annualRateBps: 1373,
          monthlyPaymentCents: 640428,
          startDate: '2026-12-13',
          termMonths: 60,
        }),
        expect.any(String),
      ),
    )
    expect(loanApi.pay).not.toHaveBeenCalled()
    expect(loanApi.extra).not.toHaveBeenCalled()
  })
  it('keeps insurance and total charge separate from capital applied', async () => {
    const user = userEvent.setup()
    renderPage('/loans/loan-1')
    await user.click(await screen.findByRole('button', { name: 'Registrar mensualidad' }))
    const panel = screen.getByRole('dialog')
    const total = within(panel).getByLabelText(
      'Total real cobrado (incluye seguros / otros cargos)',
    )
    await user.clear(total)
    await user.type(total, '6741.18')
    await user.click(within(panel).getByRole('button', { name: 'Guardar' }))
    await waitFor(() =>
      expect(loanApi.pay).toHaveBeenCalledWith(
        loan.id,
        payment.id,
        expect.objectContaining({
          paidTotalCents: 674118,
          paidPrincipalCents: 323608,
          paidInterestCents: 316820,
        }),
      ),
    )
  })
  it('simulates without recording an expense or prepayment', async () => {
    const user = userEvent.setup()
    renderPage('/loans/loan-1')
    const amount = await screen.findByLabelText('Monto (MXN)')
    await user.type(amount, '10000')
    await user.click(screen.getByRole('button', { name: 'Simular' }))
    await screen.findByText('Interés estimado ahorrado')
    expect(loanApi.calculate).toHaveBeenCalledWith(
      loan.id,
      expect.objectContaining({ amountCents: 1000000 }),
    )
    expect(loanApi.extra).not.toHaveBeenCalled()
    expect(loanApi.pay).not.toHaveBeenCalled()
    await user.clear(amount)
    expect(screen.queryByText('Interés estimado ahorrado')).not.toBeInTheDocument()
  })
})
