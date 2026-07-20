import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Budget, Category, Transaction } from '@/types'
import { api } from '@/lib/api'
import BudgetsPage from './BudgetsPage'

const state = vi.hoisted(() => ({
  budgets: { data: [] as Budget[], isLoading: false, isError: false },
  categories: { data: [] as Category[], isLoading: false, isError: false },
  transactions: { data: [] as Transaction[], isLoading: false, isError: false },
  invalidate: vi.fn(),
  reset: vi.fn(),
  payloads: [] as unknown[],
}))

vi.mock('@/hooks/useQueries', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useQueries')>('@/hooks/useQueries')
  return {
    ...actual,
    useBudgets: () => state.budgets,
    useCategories: () => state.categories,
    useTransactions: () => state.transactions,
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
        state.reset()
        setIsPending(false)
        setError(null)
      },
    }
  },
}))

vi.mock('@/lib/api', () => ({ api: { createBudget: vi.fn() } }))

const category = (id: string, name: string): Category => ({
  id,
  name,
  kind: 'expense',
  color: 'blue',
  icon: 'ShoppingCart',
  parentId: null,
  isSystem: true,
  order: 0,
})

const budget = (id: string, categoryId: string | null, amount: number): Budget => ({
  id,
  categoryId,
  amount,
  period: 'monthly',
  startDate: '2026-07-01',
})

const expense = (
  id: string,
  categoryId: string | null,
  amount: number,
  date = '2026-07-10',
): Transaction => ({
  id,
  accountId: 'account-1',
  type: 'expense',
  amount,
  categoryId,
  date,
  description: id,
  isReconciled: false,
  createdAt: date,
})

function renderPage() {
  return render(
    <MemoryRouter>
      <BudgetsPage />
    </MemoryRouter>,
  )
}

async function flushMutation() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('BudgetsPage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 20, 12))
    state.budgets = { data: [], isLoading: false, isError: false }
    state.categories = { data: [], isLoading: false, isError: false }
    state.transactions = { data: [], isLoading: false, isError: false }
    state.invalidate.mockReset()
    state.reset.mockReset()
    state.payloads.length = 0
    vi.mocked(api.createBudget).mockReset()
  })

  afterEach(() => vi.useRealTimers())

  it('keeps budget content hidden while any dependency loads', () => {
    state.categories.isLoading = true

    renderPage()

    expect(screen.getByRole('heading', { name: 'Presupuestos' })).toBeInTheDocument()
    expect(screen.queryByText('Sin presupuestos')).not.toBeInTheDocument()
    expect(screen.queryByText('Ranking por categoría')).not.toBeInTheDocument()
  })

  it.each(['budgets', 'categories', 'transactions'] as const)(
    'announces a %s query error without rendering false empty data',
    (query) => {
      state[query].isError = true

      renderPage()

      expect(screen.getByRole('alert')).toHaveTextContent('No se pudieron cargar los presupuestos')
      expect(screen.queryByText('Sin presupuestos')).not.toBeInTheDocument()
      expect(screen.queryByText('Ranking por categoría')).not.toBeInTheDocument()
    },
  )

  it('creates the first budget from its empty-state action', async () => {
    state.categories.data = [category('food', 'Comida')]
    renderPage()

    expect(screen.getByText('Sin presupuestos')).toBeInTheDocument()
    expect(
      screen.getByText('Crea un presupuesto para trackear tu gasto por categoría.'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Crear presupuesto' }))
    expect(screen.getByText('Define límite, categoría y periodo.')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Comida' })).toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox', { name: 'Categoría' }), {
      target: { value: 'food' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Límite' }), {
      target: { value: '350' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Crear' }).at(-1)!)
    await flushMutation()

    expect(api.createBudget).toHaveBeenCalledWith({
      categoryId: 'food',
      amount: 35_000,
      period: 'monthly',
      startDate: '2026-07-20',
    })
  })

  it('prioritizes exceeded, near-limit, and healthy budgets and exposes unbudgeted spending', () => {
    state.categories.data = [
      category('food', 'Comida'),
      category('transport', 'Transporte'),
      category('fun', 'Diversión'),
      category('health', 'Salud'),
    ]
    state.budgets.data = [
      budget('healthy', 'fun', 10_000),
      budget('near', 'transport', 10_000),
      budget('over', 'food', 10_000),
    ]
    state.transactions.data = [
      expense('food-spend', 'food', 12_000),
      expense('transport-spend', 'transport', 8_000),
      expense('fun-spend', 'fun', 2_000),
      expense('health-spend', 'health', 3_000),
      expense('old-health', 'health', 99_000, '2026-06-30'),
    ]

    renderPage()

    expect(screen.getByText('julio de 2026')).toBeInTheDocument()
    expect(screen.getByText('En control')).toBeInTheDocument()
    expect(screen.getByText('73% usado')).toBeInTheDocument()
    expect(screen.getByText('Excedidas').nextElementSibling).toHaveTextContent('1')
    expect(screen.getByText('Cerca', { selector: 'p' }).nextElementSibling).toHaveTextContent('1')
    expect(screen.getAllByText('Excedido')).toHaveLength(2)
    expect(screen.getAllByText('Cerca')).toHaveLength(2)
    expect(screen.getByText('Bien')).toBeInTheDocument()
    expect(screen.getByText('Sin presupuesto')).toBeInTheDocument()
    expect(screen.getByText('Salud')).toBeInTheDocument()
    expect(screen.getByText('$30.00')).toBeInTheDocument()
    expect(
      screen.getByRole('progressbar', { name: 'Uso total del presupuesto' }),
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole('progressbar', { name: 'Uso del presupuesto de Comida' }),
    ).toHaveLength(2)
  })

  it('creates a categorized weekly budget with local date and invalidates dependent queries', async () => {
    state.categories.data = [category('food', 'Comida')]
    state.budgets.data = [budget('existing', 'food', 1)]
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Categoría' }), {
      target: { value: 'food' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Periodo' }), {
      target: { value: 'weekly' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Límite' }), {
      target: { value: '2500.50' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Crear' }).at(-1)!)
    await flushMutation()

    expect(state.payloads).toEqual([
      { categoryId: 'food', amount: 250_050, period: 'weekly', startDate: '2026-07-20' },
    ])
    expect(state.invalidate).toHaveBeenCalledTimes(2)
    expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ['budgets'] })
    expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard'] })
    expect(screen.queryByText('Define límite, categoría y periodo.')).not.toBeInTheDocument()
  })

  it('shows aggregate over-limit state for a general budget without unbudgeted categories', () => {
    state.budgets.data = [
      {
        id: 'general',
        categoryId: null,
        amount: 10_000,
        period: 'yearly',
        startDate: '2026-01-01',
      },
    ]
    state.transactions.data = [
      expense('uncategorized', null, 12_500),
      expense('categorized', 'food', 2_500),
    ]
    renderPage()

    expect(screen.getAllByText('Excedido', { selector: 'div' })).toHaveLength(2)
    expect(screen.getByText('150% usado')).toBeInTheDocument()
    expect(screen.getByText('Restante').nextElementSibling).toHaveTextContent('$50.00')
    expect(screen.getAllByText('General')).not.toHaveLength(0)
    expect(screen.getByText('Anual')).toBeInTheDocument()
    expect(screen.queryByText('Sin presupuesto')).not.toBeInTheDocument()
  })

  it('uses each budget period anchored by start date for current spending', () => {
    state.categories.data = [
      category('weekly', 'Semanal cat'),
      category('monthly', 'Mensual cat'),
      category('yearly', 'Anual cat'),
    ]
    state.budgets.data = [
      { ...budget('weekly-budget', 'weekly', 50_000), period: 'weekly', startDate: '2026-07-01' },
      { ...budget('monthly-budget', 'monthly', 50_000), startDate: '2026-06-25' },
      { ...budget('yearly-budget', 'yearly', 50_000), period: 'yearly', startDate: '2025-09-15' },
    ]
    state.transactions.data = [
      expense('weekly-before-cycle', 'weekly', 1_111, '2026-07-14'),
      expense('weekly-current', 'weekly', 2_222, '2026-07-15'),
      expense('monthly-before-start', 'monthly', 3_333, '2026-06-24'),
      expense('monthly-cycle-start', 'monthly', 1_111, '2026-06-25'),
      expense('monthly-current', 'monthly', 4_444, '2026-07-10'),
      expense('monthly-next-cycle', 'monthly', 7_777, '2026-07-25'),
      expense('yearly-before-start', 'yearly', 5_555, '2025-09-14'),
      expense('yearly-cycle-start', 'yearly', 2_222, '2025-09-15'),
      expense('yearly-later', 'yearly', 6_666, '2026-06-30'),
      expense('yearly-next-cycle', 'yearly', 8_888, '2026-09-15'),
    ]
    renderPage()

    expect(screen.getByText('$22.22')).toBeInTheDocument()
    expect(screen.getByText('$55.55')).toBeInTheDocument()
    expect(screen.getByText('$88.88')).toBeInTheDocument()
    expect(screen.getByText('$166.65')).toBeInTheDocument()
  })

  it('aggregates only the latest active global scope without future or overlapping budgets', () => {
    state.categories.data = [category('food', 'Comida'), category('rent', 'Renta')]
    state.budgets.data = [
      { ...budget('old-global', null, 10_000), startDate: '2026-07-01' },
      { ...budget('food-old', 'food', 5_000), startDate: '2026-07-01' },
      { ...budget('food-latest', 'food', 7_000), startDate: '2026-07-10' },
      { ...budget('latest-global', null, 20_000), startDate: '2026-07-15' },
      { ...budget('future-global', null, 90_000), startDate: '2026-07-21' },
      { ...budget('future-rent', 'rent', 80_000), startDate: '2026-07-21' },
    ]
    state.transactions.data = [
      expense('food-current', 'food', 4_000, '2026-07-20'),
      expense('rent-current', 'rent', 2_000, '2026-07-20'),
      expense('future-in-cycle', 'food', 10_000, '2026-07-21'),
    ]

    renderPage()

    expect(screen.getByText('Gasto del periodo').parentElement).toHaveTextContent('$60.00')
    expect(screen.getByText('Presupuestado').parentElement).toHaveTextContent('$200.00')
    expect(screen.getByText('30% usado')).toBeInTheDocument()
    expect(
      screen.getByText('Ranking por categoría').parentElement?.parentElement,
    ).toHaveTextContent('6')
  })

  it('creates default monthly and general yearly budgets with valid payloads', async () => {
    state.budgets.data = [budget('existing', 'food', 1)]
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Crear' }).at(-1)!)
    expect(state.payloads).toHaveLength(0)
    const limit = screen.getByRole('textbox', { name: 'Límite' })
    expect(screen.getByRole('alert')).toHaveTextContent('Ingresa un límite mayor a cero.')
    expect(limit).toHaveAttribute('aria-invalid', 'true')
    expect(limit).toHaveAccessibleDescription('Ingresa un límite mayor a cero.')
    fireEvent.change(limit, { target: { value: '100' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Crear' }).at(-1)!)
    await flushMutation()

    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Límite' }), { target: { value: '1200' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Periodo' }), {
      target: { value: 'yearly' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Crear' }).at(-1)!)
    await flushMutation()

    expect(state.payloads).toEqual([
      { categoryId: null, amount: 10_000, period: 'monthly', startDate: '2026-07-20' },
      { categoryId: null, amount: 120_000, period: 'yearly', startDate: '2026-07-20' },
    ])
    expect(api.createBudget).toHaveBeenCalledTimes(2)
  })

  it('keeps budget panel open and announces API rejection without invalidating', async () => {
    vi.mocked(api.createBudget).mockRejectedValueOnce(new Error('offline'))
    state.budgets.data = [budget('existing', 'food', 1)]
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))
    const limit = screen.getByRole('textbox', { name: 'Límite' })
    fireEvent.change(limit, { target: { value: '300' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Crear' }).at(-1)!)
    await flushMutation()

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo crear el presupuesto')
    expect(screen.getByRole('heading', { name: 'Crear presupuesto' })).toBeInTheDocument()
    expect(limit).toHaveValue('300')
    expect(limit).toHaveAttribute('aria-invalid', 'true')
    expect(limit).toHaveAccessibleDescription('No se pudo crear el presupuesto. Intenta de nuevo.')
    expect(state.invalidate).not.toHaveBeenCalled()

    fireEvent.change(limit, { target: { value: '400' } })
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo crear el presupuesto')

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('resets the budget mutation before retrying a failed create', async () => {
    vi.mocked(api.createBudget).mockRejectedValue(new Error('offline'))
    state.budgets.data = [budget('existing', 'food', 1)]
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Límite' }), {
      target: { value: '300' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Crear' }).at(-1)!)
    await flushMutation()
    const resetCount = state.reset.mock.calls.length

    fireEvent.click(screen.getAllByRole('button', { name: 'Crear' }).at(-1)!)

    expect(state.reset).toHaveBeenCalledTimes(resetCount + 1)
  })
})
