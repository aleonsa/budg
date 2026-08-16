import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account, SavingsGoal, SavingsOverview } from '@/types'
import { api } from '@/lib/api'
import GoalsPage from './GoalsPage'

const state = vi.hoisted(() => ({
  goals: { data: [] as SavingsGoal[], isLoading: false, isError: false },
  accounts: { data: [] as Account[], isLoading: false, isError: false },
  overview: {
    data: {
      totalAllocated: 0,
      totalAccountBalance: 0,
      totalUnallocated: 0,
      accounts: [],
      recentActivity: [],
    } as SavingsOverview,
    isLoading: false,
    isError: false,
  },
  invalidate: vi.fn(),
  payloads: [] as unknown[],
}))

vi.mock('@/hooks/useQueries', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useQueries')>('@/hooks/useQueries')
  return {
    ...actual,
    useSavingsGoals: () => state.goals,
    useAccounts: () => state.accounts,
    useSavingsOverview: () => state.overview,
  }
})

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: state.invalidate }),
  useMutation: (options: { mutationFn?: (payload: never) => unknown; onSuccess?: () => void }) => {
    const [isPending, setIsPending] = useState(false)
    const [error, setError] = useState<Error | null>(null)
    const mutate = (payload: unknown, callbacks?: { onSuccess?: () => void }) => {
      state.payloads.push(payload)
      setIsPending(true)
      setError(null)
      void (async () => {
        try {
          await options.mutationFn?.(payload as never)
          options.onSuccess?.()
          callbacks?.onSuccess?.()
        } catch (cause) {
          setError(cause instanceof Error ? cause : new Error(String(cause)))
        } finally {
          setIsPending(false)
        }
      })()
    }
    return {
      isPending,
      error,
      mutate,
      reset: () => {
        setIsPending(false)
        setError(null)
      },
    }
  },
}))

vi.mock('@/lib/api', () => ({
  api: {
    createSavingsGoal: vi.fn(),
    updateSavingsGoal: vi.fn(),
    saveToGoal: vi.fn(),
    allocateSavings: vi.fn(),
    reallocateSavings: vi.fn(),
    deleteSavingsGoal: vi.fn(),
  },
}))

const account: Account = {
  id: 'account-1',
  name: 'Ahorro',
  type: 'debit',
  institution: 'BBVA',
  last4: '1234',
  currency: 'MXN',
  balance: 100_000,
  balanceTrackingEnabled: true,
  isActive: true,
}

const secondAccount: Account = {
  ...account,
  id: 'account-2',
  name: 'Inversión',
  institution: 'GBM',
  last4: '5678',
}

const goal = (overrides: Partial<SavingsGoal> = {}): SavingsGoal => ({
  id: 'goal-1',
  name: 'Emergencias',
  targetAmount: 100_000,
  currentAmount: 25_000,
  targetDate: '2026-08-10',
  accountId: 'account-1',
  isCompleted: false,
  order: 0,
  ...overrides,
})

function renderPage() {
  return render(
    <MemoryRouter>
      <GoalsPage />
    </MemoryRouter>,
  )
}

async function flushMutation() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('GoalsPage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 20, 12))
    state.goals = { data: [], isLoading: false, isError: false }
    state.accounts = { data: [], isLoading: false, isError: false }
    state.overview = {
      data: {
        totalAllocated: 0,
        totalAccountBalance: 0,
        totalUnallocated: 0,
        accounts: [],
        recentActivity: [],
      },
      isLoading: false,
      isError: false,
    }
    state.invalidate.mockReset()
    state.payloads.length = 0
    vi.mocked(api.createSavingsGoal).mockReset()
    vi.mocked(api.updateSavingsGoal).mockReset()
    vi.mocked(api.saveToGoal).mockReset()
    vi.mocked(api.allocateSavings).mockReset()
    vi.mocked(api.reallocateSavings).mockReset()
    vi.mocked(api.deleteSavingsGoal).mockReset()
  })

  afterEach(() => vi.useRealTimers())

  it('waits for goals and accounts before choosing an empty state', () => {
    state.accounts.isLoading = true

    renderPage()

    expect(screen.getByRole('heading', { name: 'Metas' })).toBeInTheDocument()
    expect(screen.queryByText('Sin metas activas')).not.toBeInTheDocument()
    expect(screen.queryByText('Progreso total')).not.toBeInTheDocument()
  })

  it('announces a query failure instead of presenting loaded empty data', () => {
    state.goals.isError = true

    renderPage()

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudieron cargar las metas')
    expect(screen.queryByText('Sin metas activas')).not.toBeInTheDocument()
    expect(screen.queryByText('Progreso total')).not.toBeInTheDocument()
  })

  it('creates the first goal from its empty-state action', async () => {
    renderPage()

    expect(screen.getByText('Sin metas activas')).toBeInTheDocument()
    expect(
      screen.getByText('Define una meta de ahorro para trackear tu progreso.'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Crear meta' }))
    expect(
      screen.getByText('Define una meta de ahorro con cuenta y fecha objetivo.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Nombre' })).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: 'Nombre' }), {
      target: { value: 'Primera meta' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Objetivo' }), {
      target: { value: '1000' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))
    await flushMutation()

    expect(api.createSavingsGoal).toHaveBeenCalledWith({
      name: 'Primera meta',
      targetAmount: 100_000,
      currentAmount: 0,
      targetDate: undefined,
      accountId: null,
      isCompleted: false,
    })
  })

  it('aggregates savings and sorts deadline states under a fixed clock', () => {
    state.accounts.data = [account]
    state.goals.data = [
      goal(),
      goal({
        id: 'overdue',
        name: 'Seguro vencido',
        currentAmount: 10_000,
        targetDate: '2026-07-10',
        accountId: null,
        order: 1,
      }),
      goal({
        id: 'future',
        name: 'Viaje futuro',
        currentAmount: 50_000,
        targetDate: '2027-01-01',
        order: 2,
      }),
      goal({
        id: 'complete',
        name: 'Laptop pagada',
        targetAmount: 50_000,
        currentAmount: 60_000,
        targetDate: '2026-06-01',
        accountId: null,
        isCompleted: true,
        order: 3,
      }),
    ]

    renderPage()

    expect(screen.getByText('21 días · 10 ago 2026')).toBeInTheDocument()
    expect(screen.getByText('Próxima')).toBeInTheDocument()
    expect(screen.getAllByText('Vencida')).not.toHaveLength(0)
    expect(screen.getByText('Viaje futuro')).toBeInTheDocument()
    expect(screen.getByText('Objetivo agregado').parentElement).toHaveTextContent(
      '3 activas · 1 completadas',
    )
    expect(screen.getByText('Laptop pagada')).toBeInTheDocument()
    expect(screen.getByText('Sin cuenta vinculada')).toBeInTheDocument()
    expect(screen.getByText('41%')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Progreso total de metas' })).toBeInTheDocument()
    expect(
      screen.getByRole('progressbar', { name: 'Progreso de la meta Viaje futuro' }),
    ).toBeInTheDocument()
  })

  it('creates a linked goal with normalized cents and invalidates goal summaries', async () => {
    state.accounts.data = [account]
    state.goals.data = [goal()]
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Nueva meta' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Nombre' }), {
      target: { value: '  Auto  ' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Objetivo' }), {
      target: { value: '1234.56' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Cuenta vinculada' }), {
      target: { value: 'account-1' },
    })
    fireEvent.change(screen.getByLabelText('Fecha objetivo'), {
      target: { value: '2026-12-31' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))
    await flushMutation()

    expect(state.payloads).toEqual([
      {
        name: 'Auto',
        targetAmount: 123_456,
        currentAmount: 0,
        targetDate: '2026-12-31',
        accountId: 'account-1',
        isCompleted: false,
      },
    ])
    expect(state.invalidate).toHaveBeenCalledTimes(3)
    expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ['goals'] })
    expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ['goals', 'overview'] })
    expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard'] })
    expect(api.createSavingsGoal).toHaveBeenCalledTimes(1)
  })

  it('transfers and assigns savings in one operation', async () => {
    state.accounts.data = [account, secondAccount]
    state.goals.data = [goal()]
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Ahorrar' }))
    expect(screen.getByRole('heading', { name: 'Ahorrar y asignar' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Desde' })).toHaveValue('account-2')
    expect(screen.getByRole('combobox', { name: 'Hacia' })).toHaveValue('account-1')
    fireEvent.change(screen.getByRole('textbox', { name: 'Monto' }), { target: { value: '25.75' } })
    fireEvent.click(screen.getByRole('button', { name: 'Transferir y asignar' }))
    await flushMutation()

    expect(api.saveToGoal).toHaveBeenCalledWith(
      'goal-1',
      {
        sourceAccountId: 'account-2',
        destinationAccountId: 'account-1',
        amount: 2_575,
        date: '2026-07-20',
        description: 'Ahorro para Emergencias',
      },
      { idempotencyKey: expect.any(String) },
    )
    expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ['goals', 'overview'] })
    expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ['accounts'] })
    expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ['transactions'] })
  })

  it('assigns existing account balance without creating a bank transfer', async () => {
    state.accounts.data = [account]
    state.goals.data = [goal()]
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Gestionar' }))
    expect(screen.getByRole('heading', { name: 'Gestionar ahorro' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Monto' }), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
    await flushMutation()

    expect(api.allocateSavings).toHaveBeenCalledWith(
      'goal-1',
      { accountId: 'account-1', amount: 1_000, date: '2026-07-20' },
      { idempotencyKey: expect.any(String) },
    )
    expect(api.saveToGoal).not.toHaveBeenCalled()
  })

  it('edits an active goal and changes its linked account', async () => {
    state.accounts.data = [account, secondAccount]
    state.goals.data = [goal()]
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Editar Emergencias' }))

    expect(screen.getByRole('heading', { name: 'Editar meta' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Nombre' })).toHaveValue('Emergencias')
    expect(screen.getByRole('combobox', { name: 'Cuenta vinculada' })).toHaveValue('account-1')
    expect(screen.getByLabelText('Fecha objetivo')).toHaveValue('2026-08-10')

    fireEvent.change(screen.getByRole('combobox', { name: 'Cuenta vinculada' }), {
      target: { value: 'account-2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await flushMutation()

    expect(api.updateSavingsGoal).toHaveBeenCalledWith('goal-1', {
      accountId: 'account-2',
    })
    expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ['goals'] })
    expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard'] })
  })

  it('keeps saved progress read-only while editing goal metadata', () => {
    state.accounts.data = [account]
    state.goals.data = [goal()]
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Editar Emergencias' }))
    expect(screen.queryByRole('textbox', { name: 'Ahorro inicial' })).not.toBeInTheDocument()
  })

  it('deletes an active goal only after confirmation', async () => {
    state.goals.data = [goal()]
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Emergencias' }))
    const dialog = screen.getByRole('dialog', { name: 'Eliminar meta' })
    expect(dialog).toHaveTextContent('¿Eliminar “Emergencias”?')
    expect(api.deleteSavingsGoal).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar meta' }))
    await flushMutation()

    expect(api.deleteSavingsGoal).toHaveBeenCalledWith('goal-1')
    expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ['goals'] })
    expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard'] })
  })

  it('shows completed-only state and falls back when linked account is unavailable', () => {
    state.goals.data = [
      goal({
        id: 'complete-only',
        name: 'Enganche listo',
        currentAmount: 100_000,
        targetDate: undefined,
        accountId: 'missing-account',
        isCompleted: true,
      }),
    ]
    renderPage()

    expect(screen.getByText('No hay metas activas con fecha objetivo.')).toBeInTheDocument()
    expect(screen.getByText('Sin metas pendientes')).toBeInTheDocument()
    expect(screen.getByText('Todas tus metas registradas están completadas.')).toBeInTheDocument()
    expect(screen.getByText('Enganche listo')).toBeInTheDocument()
    expect(screen.getByText('Sin cuenta vinculada')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ahorrar' })).not.toBeInTheDocument()
  })

  it('lists multiple completed goals with linked and missing account details', () => {
    state.accounts.data = [account]
    state.goals.data = [
      goal({
        id: 'linked-complete',
        name: 'Fondo listo',
        currentAmount: 100_000,
        targetDate: undefined,
        isCompleted: true,
      }),
      goal({
        id: 'unlinked-complete',
        name: 'Viaje listo',
        currentAmount: 100_000,
        targetDate: undefined,
        accountId: null,
        isCompleted: true,
        order: 1,
      }),
    ]
    renderPage()

    expect(screen.getByText('Metas completadas').parentElement?.parentElement).toHaveTextContent(
      '2',
    )
    expect(screen.getByText('Fondo listo').parentElement).toHaveTextContent('Ahorro · BBVA')
    expect(screen.getByText('Viaje listo').parentElement).toHaveTextContent('Sin cuenta vinculada')
  })

  it('classifies no-date and exact deadline boundary goals under the fake clock', () => {
    state.goals.data = [
      goal({ id: 'today', name: 'Hoy', targetDate: '2026-07-20', order: 0 }),
      goal({ id: 'thirty', name: 'Treinta días', targetDate: '2026-08-19', order: 1 }),
      goal({ id: 'later', name: 'Después', targetDate: '2026-08-20', order: 2 }),
      goal({ id: 'undated', name: 'Sin fecha', targetDate: undefined, order: 3 }),
    ]
    renderPage()

    expect(screen.getAllByText('0 días · 20 jul 2026')).toHaveLength(2)
    expect(screen.getByText('30 días · 19 ago 2026')).toBeInTheDocument()
    expect(screen.getByText('20 ago 2026')).toBeInTheDocument()
    expect(screen.getAllByText('Próxima')).not.toHaveLength(0)
    expect(screen.getAllByText('En progreso')).not.toHaveLength(0)
    expect(screen.getByText('Sin fecha')).toBeInTheDocument()
  })

  it('creates an unlinked undated goal with zero initial savings', async () => {
    state.goals.data = [goal()]
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Nueva meta' }))
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))
    expect(state.payloads).toHaveLength(0)

    fireEvent.change(screen.getByRole('textbox', { name: 'Nombre' }), {
      target: { value: 'Curso' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))
    expect(state.payloads).toHaveLength(0)
    fireEvent.change(screen.getByRole('textbox', { name: 'Objetivo' }), {
      target: { value: '900' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))
    await flushMutation()

    expect(state.payloads).toEqual([
      {
        name: 'Curso',
        targetAmount: 90_000,
        currentAmount: 0,
        targetDate: undefined,
        accountId: null,
        isCompleted: false,
      },
    ])
  })

  it('keeps goal panel open and announces API rejection without invalidating', async () => {
    vi.mocked(api.createSavingsGoal).mockRejectedValueOnce(new Error('offline'))
    state.goals.data = [goal()]
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Nueva meta' }))
    const name = screen.getByRole('textbox', { name: 'Nombre' })
    fireEvent.change(name, { target: { value: 'Meta fallida' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Objetivo' }), {
      target: { value: '1000' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))
    await flushMutation()

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo crear la meta')
    expect(screen.getByRole('heading', { name: 'Nueva meta' })).toBeInTheDocument()
    expect(name).toHaveValue('Meta fallida')
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAccessibleDescription('No se pudo crear la meta. Intenta de nuevo.')
    expect(state.invalidate).not.toHaveBeenCalled()
  })

  it('keeps a failed atomic save open and reuses its idempotency key on retry', async () => {
    vi.mocked(api.saveToGoal)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined)
    state.accounts.data = [account, secondAccount]
    state.goals.data = [goal()]
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Ahorrar' }))
    const amount = screen.getByRole('textbox', { name: 'Monto' })
    fireEvent.change(amount, { target: { value: '25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Transferir y asignar' }))
    await flushMutation()

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo transferir y asignar')
    expect(screen.getByRole('heading', { name: 'Ahorrar y asignar' })).toBeInTheDocument()
    expect(amount).toHaveValue('25')
    expect(state.invalidate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Transferir y asignar' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await flushMutation()

    expect(api.saveToGoal).toHaveBeenCalledTimes(2)
    expect(vi.mocked(api.saveToGoal).mock.calls[0][2]).toEqual(
      vi.mocked(api.saveToGoal).mock.calls[1][2],
    )
    expect(state.invalidate).toHaveBeenCalledTimes(5)
    expect(screen.queryByRole('heading', { name: 'Ahorrar y asignar' })).not.toBeInTheDocument()
  })
})
