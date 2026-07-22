import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import type { Account, CreditCardStatement, Transaction } from '@/types'
import CreditCardDetailPage from './CreditCardDetailPage'

const state = vi.hoisted(() => ({
  accounts: [] as Account[],
  transactions: [] as Transaction[],
  statements: [] as CreditCardStatement[],
  invalidate: vi.fn(),
}))

vi.mock('@/lib/date', () => ({ today: () => '2026-07-22' }))

vi.mock('@/hooks/useQueries', () => ({
  useAccounts: () => ({ data: state.accounts, isLoading: false, isError: false }),
  useTransactions: () => ({ data: state.transactions, isLoading: false, isError: false }),
  useCreditCardStatements: () => ({ data: state.statements, isLoading: false, isError: false }),
  useCategories: () => ({ data: [], isLoading: false, isError: false }),
  useMSIPurchases: () => ({ data: [], isLoading: false, isError: false }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: state.invalidate }),
  useMutation: (options: {
    mutationFn: (value?: unknown) => Promise<unknown>
    onSuccess?: () => void
  }) => {
    const [isPending, setIsPending] = useState(false)
    const [error, setError] = useState<Error | null>(null)
    return {
      isPending,
      error,
      reset: () => setError(null),
      mutate: (value?: unknown) => {
        setIsPending(true)
        void options.mutationFn(value).then(
          () => {
            options.onSuccess?.()
            setIsPending(false)
          },
          (cause) => {
            setError(cause instanceof Error ? cause : new Error(String(cause)))
            setIsPending(false)
          },
        )
      },
    }
  },
}))

vi.mock('@/lib/api', () => ({
  api: {
    confirmCreditCardStatement: vi.fn(),
    enableBalanceTracking: vi.fn(),
    reconcileBalance: vi.fn(),
    createTransaction: vi.fn(),
  },
}))

const credit: Account = {
  id: 'credit-1',
  name: 'Tarjeta Oro',
  type: 'credit',
  institution: 'Banamex',
  last4: '2222',
  currency: 'MXN',
  creditLimit: 100_000,
  availableCredit: 20_000,
  statementCutDay: 12,
  paymentDueDay: 28,
  balanceTrackingEnabled: false,
  isActive: true,
}

const debit: Account = {
  id: 'debit-1',
  name: 'Nómina',
  type: 'debit',
  institution: 'BBVA',
  last4: '1111',
  currency: 'MXN',
  balance: 50_000,
  balanceTrackingEnabled: false,
  isActive: true,
}

const transaction = (overrides: Partial<Transaction>): Transaction => ({
  id: 'tx-1',
  accountId: 'credit-1',
  type: 'expense',
  amount: 12_500,
  categoryId: null,
  date: '2026-07-20',
  description: 'Supermercado',
  affectsBalance: true,
  isReconciled: true,
  createdAt: '2026-07-20',
  ...overrides,
})

const statement: CreditCardStatement = {
  id: 'statement-1',
  accountId: 'credit-1',
  cycleStartDate: '2026-06-13',
  cycleEndDate: '2026-07-12',
  paymentDueDate: '2026-07-28',
  statementBalance: 40_000,
  minimumPayment: 4_000,
  paidAmount: 10_000,
  status: 'partial',
  confirmedAt: '2026-07-13T00:00:00Z',
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/accounts/credit-1']}>
      <Routes>
        <Route path="/accounts/:accountId" element={<CreditCardDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function flushMutation() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('CreditCardDetailPage', () => {
  beforeEach(() => {
    state.accounts = [credit, debit]
    state.transactions = [
      transaction({}),
      transaction({ id: 'previous', date: '2026-07-01', amount: 30_000 }),
      transaction({
        id: 'cash-advance',
        type: 'transfer',
        amount: 5_000,
        transferToAccountId: 'debit-1',
        description: 'Disposición de efectivo',
      }),
      transaction({
        id: 'future',
        date: '2026-08-01',
        amount: 99_900,
        description: 'Compra futura',
      }),
    ]
    state.statements = []
    state.invalidate.mockReset()
    vi.mocked(api.confirmCreditCardStatement).mockReset().mockResolvedValue(statement)
    vi.mocked(api.enableBalanceTracking).mockReset().mockResolvedValue(credit)
    vi.mocked(api.reconcileBalance).mockReset().mockResolvedValue(credit)
    vi.mocked(api.createTransaction)
      .mockReset()
      .mockResolvedValue(transaction({ type: 'transfer' }))
  })

  it('shows debt, open-cycle purchases, and Budg estimate for last cut', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'Tarjeta Oro' })).toBeInTheDocument()
    expect(screen.getByText('Deuda actual').nextElementSibling).toHaveTextContent('$800.00')
    expect(screen.getByText('Compras netas al momento').previousElementSibling).toHaveTextContent(
      '$175.00',
    )
    expect(screen.getByText('Estimación de Budg').previousElementSibling).toHaveTextContent(
      '$300.00',
    )
    expect(screen.getByText('Saldo automático pendiente')).toBeInTheDocument()
    expect(screen.queryByText('Compra futura')).not.toBeInTheDocument()
  })

  it('confirms previous statement against bank amount', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Confirmar estado' }))
    const dialog = screen.getByRole('dialog', { name: 'Confirmar estado de cuenta' })
    const balance = within(dialog).getByRole('textbox', {
      name: 'Saldo para no generar intereses',
    })
    expect(balance).toHaveValue('300')
    await user.clear(balance)
    await user.type(balance, '425.50')
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar saldo' }))
    await flushMutation()

    expect(api.confirmCreditCardStatement).toHaveBeenCalledWith('credit-1', {
      cycleStartDate: '2026-06-13',
      cycleEndDate: '2026-07-12',
      paymentDueDate: '2026-07-28',
      statementBalance: 42_550,
      minimumPayment: undefined,
    })
  })

  it('rejects an empty bank statement balance', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Confirmar estado' }))
    const dialog = screen.getByRole('dialog', { name: 'Confirmar estado de cuenta' })
    const balance = within(dialog).getByRole('textbox', {
      name: 'Saldo para no generar intereses',
    })
    await user.clear(balance)
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar saldo' }))

    expect(within(dialog).getByRole('alert')).toHaveTextContent('Ingresa un saldo válido')
    expect(api.confirmCreditCardStatement).not.toHaveBeenCalled()
  })

  it('rejects a malformed optional minimum payment', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Confirmar estado' }))
    const dialog = screen.getByRole('dialog', { name: 'Confirmar estado de cuenta' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Pago mínimo (opcional)' }), 'x')
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar saldo' }))

    expect(within(dialog).getByRole('alert')).toHaveTextContent('Ingresa un saldo válido')
    expect(api.confirmCreditCardStatement).not.toHaveBeenCalled()
  })

  it('activates credit tracking with available credit, not current debt', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Activar con saldo actual' }))
    await flushMutation()

    expect(api.enableBalanceTracking).toHaveBeenCalledWith('credit-1', 20_000)
  })

  it('sends one idempotent payment transfer linked to statement', async () => {
    state.statements = [statement]
    state.accounts = [
      { ...credit, balanceTrackingEnabled: true },
      { ...debit, balanceTrackingEnabled: true },
    ]
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Pagar tarjeta' }))
    const dialog = screen.getByRole('dialog', { name: 'Pagar tarjeta' })
    expect(within(dialog).getByRole('textbox', { name: 'Monto' })).toHaveValue('300')
    await user.click(within(dialog).getByRole('button', { name: 'Registrar pago' }))
    await flushMutation()

    expect(api.enableBalanceTracking).not.toHaveBeenCalled()
    expect(api.createTransaction).toHaveBeenCalledWith(
      {
        accountId: 'debit-1',
        transferToAccountId: 'credit-1',
        creditCardStatementId: 'statement-1',
        type: 'transfer',
        amount: 30_000,
        categoryId: null,
        date: '2026-07-22',
        description: 'Pago Tarjeta Oro',
        affectsBalance: true,
      },
      { idempotencyKey: expect.any(String) },
    )
  })

  it('reconciles entered debt as available credit', async () => {
    state.accounts = [
      { ...credit, balanceTrackingEnabled: true },
      { ...debit, balanceTrackingEnabled: true },
    ]
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Conciliar deuda' }))
    const dialog = screen.getByRole('dialog', { name: 'Conciliar deuda' })
    const debt = within(dialog).getByRole('textbox', { name: 'Deuda actual' })
    await user.clear(debt)
    await user.type(debt, '1250')
    await user.click(within(dialog).getByRole('button', { name: 'Conciliar' }))
    await flushMutation()

    expect(api.reconcileBalance).toHaveBeenCalledWith('credit-1', -25_000)
  })
})
