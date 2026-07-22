import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBudgets, useCategories, useTransactions } from '@/hooks/useQueries'
import { api } from '@/lib/api'
import type { Budget, Category, Transaction } from '@/types'
import CategoriesPage from './CategoriesPage'

vi.mock('@/hooks/useQueries', () => ({
  useBudgets: vi.fn(),
  useCategories: vi.fn(),
  useTransactions: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: { createCategory: vi.fn(), updateCategory: vi.fn(), deleteCategory: vi.fn() },
}))

const categories: Category[] = [
  {
    id: 'food',
    name: 'Comida',
    kind: 'expense',
    color: 'orange',
    icon: 'Utensils',
    parentId: null,
    isSystem: false,
    order: 2,
  },
  {
    id: 'rent',
    name: 'Renta',
    kind: 'expense',
    color: 'blue',
    icon: 'House',
    parentId: null,
    isSystem: true,
    order: 1,
  },
  {
    id: 'salary',
    name: 'Sueldo',
    kind: 'income',
    color: 'green',
    icon: 'Wallet',
    parentId: null,
    isSystem: false,
    order: 3,
  },
]

const transactions: Transaction[] = [
  {
    id: 'rent-july',
    accountId: 'checking',
    type: 'expense',
    amount: 12000,
    categoryId: 'rent',
    date: '2026-07-02',
    description: 'Renta julio',
    isReconciled: true,
    createdAt: '2026-07-02',
  },
  {
    id: 'food-july',
    accountId: 'checking',
    type: 'expense',
    amount: 6000,
    categoryId: 'food',
    date: '2026-07-20',
    description: 'Supermercado',
    isReconciled: true,
    createdAt: '2026-07-20',
  },
  {
    id: 'salary-july',
    accountId: 'checking',
    type: 'income',
    amount: 100000,
    categoryId: 'salary',
    date: '2026-07-15',
    description: 'Nómina',
    isReconciled: true,
    createdAt: '2026-07-15',
  },
  {
    id: 'food-june',
    accountId: 'checking',
    type: 'expense',
    amount: 99000,
    categoryId: 'food',
    date: '2026-06-30',
    description: 'Mes anterior',
    isReconciled: true,
    createdAt: '2026-06-30',
  },
]

const budgets: Budget[] = [
  {
    id: 'rent-budget',
    categoryId: 'rent',
    amount: 10000,
    period: 'monthly',
    startDate: '2026-01-01',
  },
]

function setQueries({
  categoryData = categories,
  transactionData = transactions,
  budgetData = budgets,
  loading = false,
}: {
  categoryData?: Category[]
  transactionData?: Transaction[]
  budgetData?: Budget[]
  loading?: boolean
} = {}) {
  vi.mocked(useCategories).mockReturnValue({ data: categoryData, isLoading: loading } as ReturnType<
    typeof useCategories
  >)
  vi.mocked(useTransactions).mockReturnValue({
    data: transactionData,
    isLoading: loading,
  } as ReturnType<typeof useTransactions>)
  vi.mocked(useBudgets).mockReturnValue({ data: budgetData, isLoading: loading } as ReturnType<
    typeof useBudgets
  >)
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CategoriesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return queryClient
}

describe('CategoriesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 6, 20, 12))
    setQueries()
    vi.mocked(api.createCategory).mockResolvedValue(categories[0])
    vi.mocked(api.updateCategory).mockResolvedValue()
    vi.mocked(api.deleteCategory).mockResolvedValue()
  })

  afterEach(() => vi.useRealTimers())

  it('shows loading while any required dataset is loading', () => {
    setQueries({ loading: true })
    renderPage()

    expect(screen.getByRole('heading', { name: 'Categorías' })).toBeInTheDocument()
    expect(screen.getByText('Cargando…')).toBeInTheDocument()
    expect(screen.queryByText('Sin categorías')).not.toBeInTheDocument()
  })

  it('shows an accessible failure instead of an empty state when a query fails', () => {
    vi.mocked(useCategories).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('categories unavailable'),
    } as ReturnType<typeof useCategories>)
    renderPage()

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudieron cargar las categorías.')
    expect(screen.queryByText('Sin categorías')).not.toBeInTheDocument()
  })

  it.each([
    ['transactions', true, false],
    ['budgets', false, true],
  ] as const)(
    'stays loading when only %s are unresolved',
    (_source, transactionsLoading, budgetsLoading) => {
      vi.mocked(useCategories).mockReturnValue({ data: categories, isLoading: false } as ReturnType<
        typeof useCategories
      >)
      vi.mocked(useTransactions).mockReturnValue({
        data: transactions,
        isLoading: transactionsLoading,
      } as ReturnType<typeof useTransactions>)
      vi.mocked(useBudgets).mockReturnValue({
        data: budgets,
        isLoading: budgetsLoading,
      } as ReturnType<typeof useBudgets>)
      renderPage()

      expect(screen.getByText('Cargando…')).toBeInTheDocument()
      expect(screen.queryByText('Comida')).not.toBeInTheDocument()
    },
  )

  it('opens the create panel from the empty state and creates a category', async () => {
    const user = userEvent.setup()
    setQueries({ categoryData: [], transactionData: [], budgetData: [] })
    const queryClient = renderPage()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    expect(screen.getByText('Sin categorías')).toBeInTheDocument()
    expect(screen.getByText('No hay categorías configuradas todavía.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Crear categoría' }))
    await user.type(screen.getByPlaceholderText('Ej. Mascotas'), 'Mascotas')
    await user.click(screen.getAllByRole('button', { name: 'Crear' }).at(-1)!)

    await waitFor(() => expect(api.createCategory).toHaveBeenCalledOnce())
    expect(vi.mocked(api.createCategory).mock.calls[0][0]).toEqual({
      name: 'Mascotas',
      kind: 'expense',
      color: 'blue',
      icon: 'Tag',
      parentId: null,
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['categories'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard'] })
  })

  it('groups and orders categories, using only latest-month spending and budget data', () => {
    renderPage()

    expect(screen.getByText('Total').nextElementSibling).toHaveTextContent('3')
    expect(screen.getByText('Gasto').nextElementSibling).toHaveTextContent('2')
    expect(screen.getByText('Ingreso').nextElementSibling).toHaveTextContent('1')
    expect(screen.getByText('Con presupuesto').nextElementSibling).toHaveTextContent('1')
    expect(screen.getByRole('heading', { name: 'Gasto · 2' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ingreso · 1' })).toBeInTheDocument()
    expect(screen.getByText(/julio de 2026/i)).toBeInTheDocument()

    const rent = screen.getByText('Renta')
    const food = screen.getByText('Comida')
    const salary = screen.getByText('Sueldo')
    expect(rent.compareDocumentPosition(food) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(food.compareDocumentPosition(salary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('Sistema')).toBeInTheDocument()
    expect(screen.getByText('$120.00')).toBeInTheDocument()
    expect(
      screen.getByText((_, element) => element?.textContent === '$120.00 / $100.00', {
        selector: 'span',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('$60.00')).toBeInTheDocument()
    expect(screen.getByText('$1,000.00')).toBeInTheDocument()
    expect(screen.queryByText('$990.00')).not.toBeInTheDocument()
    expect(
      screen.getByRole('progressbar', { name: 'Uso del presupuesto de Renta' }),
    ).toBeInTheDocument()
  })

  it('ignores later transfers when selecting the displayed activity month', () => {
    setQueries({
      transactionData: [
        ...transactions,
        {
          id: 'august-transfer',
          accountId: 'checking',
          type: 'transfer',
          amount: 50000,
          categoryId: null,
          date: '2026-08-01',
          description: 'Transferencia futura',
          transferToAccountId: 'savings',
          isReconciled: true,
          createdAt: '2026-08-01',
        },
      ],
    })
    renderPage()

    expect(screen.getByText(/julio de 2026/i)).toBeInTheDocument()
    expect(screen.getByText('$60.00')).toBeInTheDocument()
    expect(screen.getByText('$1,000.00')).toBeInTheDocument()
  })

  it('shows categories without activity or budgets distinctly', () => {
    setQueries({ transactionData: [], budgetData: [] })
    renderPage()

    expect(screen.getAllByText('Sin movimiento')).toHaveLength(3)
    expect(screen.queryByText('/')).not.toBeInTheDocument()
    expect(screen.getByText(/julio de 2026/i)).toBeInTheDocument()
  })

  it('uses the local Auckland month when no category activity exists', () => {
    try {
      vi.stubEnv('TZ', 'Pacific/Auckland')
      vi.setSystemTime(new Date('2026-07-31T12:30:00Z'))
      setQueries({ transactionData: [], budgetData: [] })
      renderPage()

      expect(screen.getByText(/agosto de 2026/i)).toBeInTheDocument()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('falls back safely when category query data is unavailable', () => {
    vi.mocked(useCategories).mockReturnValue({ data: undefined, isLoading: false } as ReturnType<
      typeof useCategories
    >)
    renderPage()

    expect(screen.getByText('Sin categorías')).toBeInTheDocument()
  })

  it('falls back to no movement when transaction and budget data are unavailable', () => {
    vi.mocked(useTransactions).mockReturnValue({ data: undefined, isLoading: false } as ReturnType<
      typeof useTransactions
    >)
    vi.mocked(useBudgets).mockReturnValue({ data: undefined, isLoading: false } as ReturnType<
      typeof useBudgets
    >)
    renderPage()

    expect(screen.getAllByText('Sin movimiento')).toHaveLength(3)
    expect(screen.getByText('Con presupuesto').nextElementSibling).toHaveTextContent('0')
  })

  it('shows an under-budget current expense while leaving global and unknown budgets unmatched', () => {
    setQueries({
      transactionData: [transactions[1]],
      budgetData: [
        {
          id: 'food-budget',
          categoryId: 'food',
          amount: 10000,
          period: 'monthly',
          startDate: '2026-01-01',
        },
        {
          id: 'global-budget',
          categoryId: null,
          amount: 50000,
          period: 'monthly',
          startDate: '2026-01-01',
        },
        {
          id: 'unknown-budget',
          categoryId: 'missing',
          amount: 20000,
          period: 'monthly',
          startDate: '2026-01-01',
        },
      ],
    })
    renderPage()

    expect(screen.getByText('Con presupuesto').nextElementSibling).toHaveTextContent('1')
    expect(
      screen.getByText((_, element) => element?.textContent === '$60.00 / $100.00', {
        selector: 'span',
      }),
    ).toBeInTheDocument()
    expect(screen.getAllByText('Sin movimiento')).toHaveLength(2)
  })

  it.each([
    ['weekly', '2026-07-15', '$60.00 / $50.00'],
    ['yearly', '2026-01-01', '$1,050.00 / $2,000.00'],
  ] as const)(
    'shows canonical %s budget spending separately from monthly activity',
    (period, startDate, expected) => {
      setQueries({
        budgetData: [
          {
            id: `${period}-food`,
            categoryId: 'food',
            amount: period === 'weekly' ? 5000 : 200000,
            period,
            startDate,
          },
        ],
      })
      renderPage()

      expect(
        screen.getByText((_, element) => element?.textContent === expected, { selector: 'span' }),
      ).toBeInTheDocument()
      expect(screen.getByText('$60.00')).toBeInTheDocument()
    },
  )

  it('selects the most recent active category budget and ignores future budgets', () => {
    setQueries({
      budgetData: [
        {
          id: 'older-monthly',
          categoryId: 'food',
          amount: 10000,
          period: 'monthly',
          startDate: '2026-01-01',
        },
        {
          id: 'newer-weekly',
          categoryId: 'food',
          amount: 5000,
          period: 'weekly',
          startDate: '2026-07-15',
        },
        {
          id: 'future-budget',
          categoryId: 'food',
          amount: 100,
          period: 'weekly',
          startDate: '2026-07-21',
        },
      ],
    })
    renderPage()

    expect(screen.getByText('Con presupuesto').nextElementSibling).toHaveTextContent('1')
    expect(
      screen.getByText((_, element) => element?.textContent === '$60.00 / $50.00', {
        selector: 'span',
      }),
    ).toBeInTheDocument()
    expect(screen.queryByText('$1.00')).not.toBeInTheDocument()
  })

  it('creates a trimmed category with selected type, color, and visual icon', async () => {
    const user = userEvent.setup()
    const queryClient = renderPage()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await user.click(screen.getByRole('button', { name: 'Crear' }))
    await user.type(screen.getByPlaceholderText('Ej. Mascotas'), '  Bonos  ')
    const selects = screen.getAllByRole('combobox')
    await user.selectOptions(selects[0], 'income')
    await user.selectOptions(selects[1], 'purple')
    await user.click(screen.getByRole('button', { name: 'Icono' }))
    await user.click(screen.getByRole('option', { name: 'Bonos (Award)' }))
    await user.click(screen.getAllByRole('button', { name: 'Crear' }).at(-1)!)

    await waitFor(() => expect(api.createCategory).toHaveBeenCalledOnce())
    expect(vi.mocked(api.createCategory).mock.calls[0][0]).toEqual({
      name: 'Bonos',
      kind: 'income',
      color: 'purple',
      icon: 'Award',
      parentId: null,
    })
    await waitFor(() =>
      expect(
        screen.queryByText('Configura una categoría para gastos o ingresos.'),
      ).not.toBeInTheDocument(),
    )
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['categories'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard'] })
  })

  it('edits a non-system category through the real API mutation and keeps kind immutable', async () => {
    const user = userEvent.setup()
    const queryClient = renderPage()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await user.click(screen.getByRole('button', { name: 'Editar Comida' }))
    const dialog = screen.getByRole('dialog', { name: 'Editar categoría' })

    expect(within(dialog).getByRole('textbox', { name: 'Nombre' })).toHaveValue('Comida')
    expect(within(dialog).getByRole('combobox', { name: 'Tipo' })).toBeDisabled()
    await user.clear(within(dialog).getByRole('textbox', { name: 'Nombre' }))
    await user.type(within(dialog).getByRole('textbox', { name: 'Nombre' }), 'Alimentos')
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() =>
      expect(api.updateCategory).toHaveBeenCalledWith('food', {
        name: 'Alimentos',
        color: 'orange',
        icon: 'Utensils',
      }),
    )
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['categories'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard'] })
  })

  it('confirms and deletes a non-system category through the real API mutation', async () => {
    const user = userEvent.setup()
    const queryClient = renderPage()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await user.click(screen.getByRole('button', { name: 'Eliminar Comida' }))
    const dialog = screen.getByRole('dialog', { name: 'Eliminar categoría' })
    expect(dialog).toHaveTextContent('¿Eliminar “Comida”?')
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar categoría' }))

    await waitFor(() => expect(api.deleteCategory).toHaveBeenCalledOnce())
    expect(vi.mocked(api.deleteCategory).mock.calls[0][0]).toBe('food')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['categories'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard'] })
  })

  it('does not offer edit or delete actions for system categories', () => {
    renderPage()

    expect(screen.queryByRole('button', { name: 'Editar Renta' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Eliminar Renta' })).not.toBeInTheDocument()
  })

  it('shows an async create failure, retains the form, and does not invalidate queries', async () => {
    const user = userEvent.setup()
    let rejectCreate!: (error: Error) => void
    vi.mocked(api.createCategory).mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectCreate = reject
        }),
    )
    const queryClient = renderPage()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await user.click(screen.getByRole('button', { name: 'Crear' }))
    const dialog = screen.getByRole('dialog', { name: 'Crear categoría' })
    const nameInput = within(dialog).getByRole('textbox', { name: 'Nombre' })
    await user.type(nameInput, 'Mascotas')
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Tipo' }), 'income')
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Color' }), 'purple')
    await user.click(within(dialog).getByRole('button', { name: 'Crear' }))

    expect(within(dialog).getByRole('button', { name: 'Guardando…' })).toBeDisabled()
    rejectCreate(new Error('No se pudo crear la categoría.'))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'No se pudo crear la categoría.',
    )
    expect(nameInput).toHaveValue('Mascotas')
    expect(within(dialog).getByRole('combobox', { name: 'Tipo' })).toHaveValue('income')
    expect(within(dialog).getByRole('combobox', { name: 'Color' })).toHaveValue('purple')
    expect(invalidate).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    await user.click(screen.getByRole('button', { name: 'Crear' }))
    expect(within(screen.getByRole('dialog')).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('rejects a blank category name without calling the API', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Crear' }))
    const dialog = screen.getByRole('dialog', { name: 'Crear categoría' })
    const nameInput = within(dialog).getByRole('textbox', { name: 'Nombre' })
    expect(within(dialog).getByRole('combobox', { name: 'Tipo' })).toBeInTheDocument()
    expect(within(dialog).getByRole('combobox', { name: 'Color' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Icono' })).toBeInTheDocument()
    await user.type(nameInput, '   ')
    await user.click(within(dialog).getByRole('button', { name: 'Crear' }))

    expect(api.createCategory).not.toHaveBeenCalled()
    const error = within(dialog).getByRole('alert')
    expect(error).toHaveTextContent('Ingresa un nombre para la categoría.')
    expect(nameInput).toHaveAttribute('aria-invalid', 'true')
    expect(nameInput).toHaveAttribute('aria-describedby', error.id)
    await user.type(nameInput, 'Mascotas')
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
  })
})
