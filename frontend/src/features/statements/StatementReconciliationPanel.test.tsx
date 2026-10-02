import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import type { Account, Category, StatementReconciliation } from '@/types'
import { StatementReconciliationPanel } from './StatementReconciliationPanel'

vi.mock('@/lib/api', () => ({
  api: {
    reconcileStatement: vi.fn(),
    createTransaction: vi.fn(),
    confirmCreditCardStatement: vi.fn(),
  },
}))

const card: Account = {
  id: 'credit-1',
  name: 'Joy',
  type: 'credit',
  institution: 'Banamex',
  last4: '4321',
  currency: 'MXN',
  creditLimit: 100_000,
  availableCredit: 50_000,
  isActive: true,
}
const debit: Account = {
  id: 'debit-1',
  name: 'Platinum',
  type: 'debit',
  institution: 'Banamex',
  last4: '1111',
  currency: 'MXN',
  balance: 500_000,
  isActive: true,
}
const categories: Category[] = [
  {
    id: 'food',
    name: 'Comida',
    kind: 'expense',
    color: 'orange',
    icon: 'Utensils',
    parentId: null,
    isSystem: false,
    order: 1,
  },
]

function reconciliation(): StatementReconciliation {
  return {
    statement: {
      issuer: 'banamex',
      product: 'JOY BANAMEX',
      cardLast4: '4321',
      periodStart: '2026-06-08',
      periodEnd: '2026-07-08',
      paymentDueDate: '2026-08-03',
      paymentToAvoidInterest: 125_050,
      minimumPayment: 15_000,
      totalCharges: 125_050,
      totalCredits: 90_000,
      warnings: ['charges_total_mismatch'],
    },
    movements: [
      {
        line: 1,
        operationDate: '2026-06-10',
        postingDate: '2026-06-10',
        description: 'CAFE DEMO',
        amount: 8_550,
        direction: 'charge',
        status: 'matched',
        transactionId: 'tx-1',
      },
      {
        line: 2,
        operationDate: '2026-06-12',
        postingDate: '2026-06-12',
        description: 'SU ABONO...GRACIAS',
        amount: 90_000,
        direction: 'credit',
        status: 'missing',
        transactionId: null,
      },
      {
        line: 3,
        operationDate: '2026-06-30',
        postingDate: '2026-07-02',
        description: 'SERVICIO RECURRENTE',
        amount: 106_500,
        direction: 'charge',
        status: 'missing',
        transactionId: null,
      },
      {
        line: 4,
        operationDate: '2026-07-01',
        postingDate: '2026-07-01',
        description: 'DISPONIBLE BANAMEX',
        amount: 50_000,
        direction: 'charge',
        installment: { number: 9, total: 24 },
        status: 'installment_unmatched',
        transactionId: null,
      },
    ],
    onlyInBudg: [
      { id: 'tx-9', date: '2026-06-25', type: 'expense', description: 'Tacos', amount: 4_200 },
    ],
    summary: {
      matched: 1,
      missing: 2,
      installmentsMatched: 0,
      installmentsUnmatched: 1,
      onlyInBudg: 1,
      missingCharges: 106_500,
      missingCredits: 90_000,
    },
  }
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <StatementReconciliationPanel
        open
        onClose={vi.fn()}
        account={card}
        debitAccounts={[debit]}
        categories={categories}
      />
    </QueryClientProvider>,
  )
}

async function uploadPdf() {
  const user = userEvent.setup()
  const file = new File(['%PDF-1.7'], 'estado.pdf', { type: 'application/pdf' })
  await user.upload(screen.getByLabelText('Estado de cuenta (PDF)'), file)
  return { user, file }
}

describe('StatementReconciliationPanel', () => {
  beforeEach(() => {
    vi.mocked(api.reconcileStatement).mockReset().mockResolvedValue(reconciliation())
    vi.mocked(api.createTransaction)
      .mockReset()
      .mockResolvedValue({} as never)
    vi.mocked(api.confirmCreditCardStatement)
      .mockReset()
      .mockResolvedValue({} as never)
  })

  it('shows the parsed statement, warnings, and reconciliation groups', async () => {
    renderPanel()
    const { file } = await uploadPdf()

    expect(api.reconcileStatement).toHaveBeenCalledWith('credit-1', file)
    expect(await screen.findByText(/JOY BANAMEX · corte/)).toBeInTheDocument()
    expect(screen.getByText('1 ya registrados')).toBeInTheDocument()
    expect(screen.getByText('2 faltantes')).toBeInTheDocument()
    expect(screen.getByText(/suma de cargos leídos no cuadra/)).toBeInTheDocument()
    expect(screen.getByText(/DISPONIBLE BANAMEX 9\/24/)).toBeInTheDocument()
    expect(screen.getByText(/Tacos/)).toBeInTheDocument()
    expect(screen.queryByText('CAFE DEMO')).not.toBeInTheDocument()
  })

  it('creates missing movements with stable idempotency keys and re-runs the comparison', async () => {
    renderPanel()
    const { user, file } = await uploadPdf()
    await screen.findByText('2 faltantes')

    expect(screen.getByLabelText('Registrar SU ABONO...GRACIAS')).not.toBeChecked()
    await user.click(screen.getByLabelText('Registrar SU ABONO...GRACIAS'))
    await user.selectOptions(screen.getByLabelText('Categoría SERVICIO RECURRENTE'), 'food')
    await user.click(screen.getByRole('button', { name: 'Registrar 2 movimiento(s)' }))

    await waitFor(() => expect(api.createTransaction).toHaveBeenCalledTimes(2))
    expect(api.createTransaction).toHaveBeenNthCalledWith(
      1,
      {
        amount: 90_000,
        date: '2026-06-12',
        description: 'SU ABONO...GRACIAS',
        accountId: 'debit-1',
        transferToAccountId: 'credit-1',
        type: 'transfer',
        categoryId: null,
      },
      { idempotencyKey: expect.stringMatching(/^stmt-[\w-]+-2026-07-08-2-90000$/) },
    )
    expect(api.createTransaction).toHaveBeenNthCalledWith(
      2,
      {
        amount: 106_500,
        date: '2026-06-30',
        description: 'SERVICIO RECURRENTE',
        accountId: 'credit-1',
        type: 'expense',
        categoryId: 'food',
      },
      { idempotencyKey: expect.stringMatching(/^stmt-[\w-]+-2026-07-08-3-106500$/) },
    )
    await waitFor(() => expect(api.reconcileStatement).toHaveBeenCalledTimes(2))
    expect(api.reconcileStatement).toHaveBeenLastCalledWith('credit-1', file)
  })

  it('skips unchecked rows and records refunds as income', async () => {
    renderPanel()
    const { user } = await uploadPdf()
    await screen.findByText('2 faltantes')

    await user.click(screen.getByLabelText('Registrar SERVICIO RECURRENTE'))
    await user.click(screen.getByLabelText('Registrar SU ABONO...GRACIAS'))
    await user.selectOptions(screen.getByLabelText('Tipo de abono SU ABONO...GRACIAS'), 'income')
    await user.click(screen.getByRole('button', { name: 'Registrar 1 movimiento(s)' }))

    await waitFor(() => expect(api.createTransaction).toHaveBeenCalledTimes(1))
    expect(vi.mocked(api.createTransaction).mock.calls[0][0]).toMatchObject({
      accountId: 'credit-1',
      type: 'income',
      amount: 90_000,
    })
  })

  it('saves the statement cut using the parsed values', async () => {
    renderPanel()
    const { user } = await uploadPdf()
    await screen.findByText('2 faltantes')

    await user.click(screen.getByRole('button', { name: 'Guardar corte en budg' }))

    await waitFor(() =>
      expect(api.confirmCreditCardStatement).toHaveBeenCalledWith('credit-1', {
        cycleStartDate: '2026-06-08',
        cycleEndDate: '2026-07-08',
        paymentDueDate: '2026-08-03',
        statementBalance: 125_050,
        minimumPayment: 15_000,
      }),
    )
    expect(await screen.findByText('Corte guardado en budg.')).toBeInTheDocument()
  })

  it('keeps registering after a row fails and preserves choices on re-run', async () => {
    vi.mocked(api.createTransaction)
      .mockRejectedValueOnce(new Error('Request failed: 409'))
      .mockResolvedValue({} as never)
    renderPanel()
    const { user } = await uploadPdf()
    await screen.findByText('2 faltantes')

    await user.click(screen.getByLabelText('Registrar SU ABONO...GRACIAS'))
    await user.selectOptions(screen.getByLabelText('Categoría SERVICIO RECURRENTE'), 'food')
    await user.click(screen.getByRole('button', { name: 'Registrar 2 movimiento(s)' }))

    expect(await screen.findByText(/1 registrado\(s\), 1 con error/)).toBeInTheDocument()
    expect(api.createTransaction).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(api.reconcileStatement).toHaveBeenCalledTimes(2))
    expect(screen.getByText(/no se pudo registrar/)).toBeInTheDocument()
    expect(screen.getByLabelText('Categoría SERVICIO RECURRENTE')).toHaveValue('food')
    expect(screen.getByLabelText('Registrar SU ABONO...GRACIAS')).toBeChecked()
  })

  it('blocks registering and saving until a card mismatch is confirmed', async () => {
    const mismatched = reconciliation()
    mismatched.statement.warnings = ['card_last4_mismatch']
    vi.mocked(api.reconcileStatement).mockResolvedValue(mismatched)
    renderPanel()
    const { user } = await uploadPdf()
    await screen.findByText('2 faltantes')

    expect(screen.queryByRole('button', { name: /^Registrar \d/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar corte en budg' })).toBeDisabled()

    await user.click(screen.getByLabelText(/Confirmo que este estado de cuenta es de Joy/))
    expect(screen.getByRole('button', { name: 'Registrar 1 movimiento(s)' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Guardar corte en budg' })).toBeEnabled()
  })

  it('shows readable upload errors', async () => {
    vi.mocked(api.reconcileStatement).mockRejectedValue(
      new Error('Por ahora solo se soportan estados de cuenta de tarjeta Banamex.'),
    )
    renderPanel()
    await uploadPdf()

    expect(await screen.findByRole('alert')).toHaveTextContent(/Banamex/)
  })
})
