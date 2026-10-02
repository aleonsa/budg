import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import type { Account, Category, YieldReconciliation } from '@/types'
import { YieldReconciliationPanel } from './YieldReconciliationPanel'

const state = vi.hoisted(() => ({ reconciliations: [] as YieldReconciliation[] }))

vi.mock('@/lib/date', async () => ({
  ...(await vi.importActual<typeof import('@/lib/date')>('@/lib/date')),
  today: () => '2026-08-14',
}))

vi.mock('@/hooks/useQueries', () => ({
  useYieldReconciliations: () => ({ data: state.reconciliations }),
  useSavingsGoals: () => ({ data: [{ id: 'goal-1', name: 'Viaje' }] }),
}))

vi.mock('@/lib/api', () => ({
  api: { reconcileYield: vi.fn(), undoYieldReconciliation: vi.fn() },
}))

const account: Account = {
  id: 'savings',
  name: 'Nu Cajita',
  type: 'debit',
  institution: 'Nu',
  last4: '0001',
  currency: 'MXN',
  balance: 10_000_000,
  annualYieldBps: 1200,
  balanceTrackingEnabled: true,
  balanceTrackingStartedAt: '2026-01-01T00:00:00Z',
  yieldReconciledOn: '2026-07-15',
  isActive: true,
}

const categories: Category[] = [
  {
    id: 'cat-yield',
    name: 'Rendimientos',
    kind: 'income',
    color: 'green',
    icon: 'TrendingUp',
    parentId: null,
    isSystem: false,
    order: 1,
  },
]

function result(yieldAmount: number): Awaited<ReturnType<typeof api.reconcileYield>> {
  return {
    reconciliation: {
      id: 'rec-new',
      accountId: 'savings',
      transactionId: 'tx-1',
      date: '2026-08-14',
      periodStart: '2026-07-15',
      balanceBefore: 10_000_000,
      balanceAfter: 10_000_000 + yieldAmount,
      yield: yieldAmount,
      adjustment: 0,
      estimatedYield: 99_102,
      annualYieldBps: 1200,
      allocations: [{ goalId: 'goal-1', amount: 40_000 }],
    },
    account,
  }
}

function renderPanel(overrides: Partial<Account> = {}) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <YieldReconciliationPanel
        open
        onClose={vi.fn()}
        account={{ ...account, ...overrides }}
        categories={categories}
      />
    </QueryClientProvider>,
  )
}

describe('YieldReconciliationPanel', () => {
  beforeEach(() => {
    state.reconciliations = []
    vi.mocked(api.reconcileYield).mockReset()
    vi.mocked(api.undoYieldReconciliation).mockReset()
  })

  it('prefills the estimate and records the difference as yield', async () => {
    vi.mocked(api.reconcileYield).mockResolvedValue(result(99_102))
    const user = userEvent.setup()
    renderPanel()

    expect(screen.getByText(/estimado \$991\.02 desde .* \(30 días\)/)).toBeInTheDocument()
    const bank = screen.getByLabelText('Saldo en el banco')
    expect(bank).toHaveValue('')
    expect(bank).toHaveAttribute('placeholder', '≈ 100991.02')
    await user.click(screen.getByRole('button', { name: 'Conciliar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Ingresa el saldo que muestra tu banco.')
    expect(api.reconcileYield).not.toHaveBeenCalled()

    await user.type(bank, '100991.02')
    expect(screen.getByLabelText('Rendimiento')).toHaveValue('991.02')
    expect(screen.getByLabelText('Categoría')).toHaveValue('cat-yield')

    await user.click(screen.getByRole('button', { name: 'Conciliar' }))
    await waitFor(() =>
      expect(api.reconcileYield).toHaveBeenCalledWith(
        'savings',
        {
          currentBalance: 10_099_102,
          yieldAmount: 99_102,
          categoryId: 'cat-yield',
          date: '2026-08-14',
        },
        { idempotencyKey: expect.any(String) },
      ),
    )
    expect(await screen.findByText(/repartidos a tus metas/)).toBeInTheDocument()
    expect(screen.getByText(/Viaje: \+\$400\.00/)).toBeInTheDocument()
  })

  it('flags large differences and splits them into yield and adjustment', async () => {
    vi.mocked(api.reconcileYield).mockResolvedValue(result(99_102))
    const user = userEvent.setup()
    renderPanel()

    await user.type(screen.getByLabelText('Saldo en el banco'), '105000')

    expect(screen.getByText(/mucho mayor que el rendimiento estimado/)).toBeInTheDocument()
    expect(screen.getByLabelText('Rendimiento')).toHaveValue('991.02')
    expect(screen.getByText(/Ajuste \(no cuenta como ingreso\): \$4,008\.98/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Conciliar' }))
    await waitFor(() => expect(api.reconcileYield).toHaveBeenCalled())
    expect(vi.mocked(api.reconcileYield).mock.calls[0][1]).toMatchObject({
      currentBalance: 10_500_000,
      yieldAmount: 99_102,
    })
  })

  it('records a balance drop as adjustment only', async () => {
    vi.mocked(api.reconcileYield).mockResolvedValue(result(0))
    const user = userEvent.setup()
    renderPanel()

    await user.type(screen.getByLabelText('Saldo en el banco'), '99000')
    expect(screen.getByText(/El saldo bajó/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Rendimiento')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Conciliar' }))
    await waitFor(() => expect(api.reconcileYield).toHaveBeenCalled())
    expect(vi.mocked(api.reconcileYield).mock.calls[0][1]).toMatchObject({
      currentBalance: 9_900_000,
      yieldAmount: 0,
    })
  })

  it('rejects yield above the difference', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.type(screen.getByLabelText('Saldo en el banco'), '100991.02')
    const yieldInput = screen.getByLabelText('Rendimiento')
    await user.clear(yieldInput)
    await user.type(yieldInput, '5000')
    await user.click(screen.getByRole('button', { name: 'Conciliar' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/entre \$0 y la diferencia/)
    expect(api.reconcileYield).not.toHaveBeenCalled()
  })

  it('undoes the latest reconciliation', async () => {
    state.reconciliations = [result(99_102).reconciliation]
    vi.mocked(api.undoYieldReconciliation).mockResolvedValue(account)
    const user = userEvent.setup()
    renderPanel()

    expect(screen.getByText(/Última conciliación/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Saldo en el banco'), '123')
    await user.click(screen.getByRole('button', { name: 'Deshacer' }))
    await waitFor(() =>
      expect(api.undoYieldReconciliation).toHaveBeenCalledWith('savings', 'rec-new'),
    )
    await waitFor(() => expect(screen.getByLabelText('Saldo en el banco')).toHaveValue(''))
  })

  it('asks to enable balance tracking first', () => {
    renderPanel({ balanceTrackingEnabled: false })
    expect(screen.getByText(/Activa el seguimiento de saldo/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Conciliar' })).not.toBeInTheDocument()
  })
})
