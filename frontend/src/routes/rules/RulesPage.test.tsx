import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCategories, useRules, useTransactions } from '@/hooks/useQueries'
import { api } from '@/lib/api'
import type { Category, Rule, Transaction } from '@/types'
import RulesPage from './RulesPage'

vi.mock('@/hooks/useQueries', () => ({
  useCategories: vi.fn(),
  useRules: vi.fn(),
  useTransactions: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: { createRule: vi.fn(), toggleRule: vi.fn() },
}))

const categories: Category[] = [
  {
    id: 'transport',
    name: 'Transporte',
    kind: 'expense',
    color: 'blue',
    icon: 'Car',
    parentId: null,
    isSystem: false,
    order: 1,
  },
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
]

const rules: Rule[] = [
  {
    id: 'uber-rule',
    field: 'merchant',
    operator: 'contains',
    value: 'UBER',
    categoryId: 'transport',
    isActive: true,
    priority: 1,
  },
  {
    id: 'coffee-rule',
    field: 'description',
    operator: 'startsWith',
    value: 'Café',
    categoryId: 'food',
    isActive: false,
    priority: 2,
  },
]

function transaction(
  id: string,
  overrides: Partial<Transaction> & Pick<Transaction, 'type'>,
): Transaction {
  return {
    id,
    accountId: 'checking',
    amount: 1000,
    categoryId: null,
    date: '2026-07-20',
    description: '',
    isReconciled: true,
    createdAt: '2026-07-20',
    ...overrides,
  }
}

const transactions: Transaction[] = [
  transaction('uber-1', { type: 'expense', merchant: 'Uber', description: 'Viaje' }),
  transaction('uber-2', { type: 'expense', merchant: 'uber', description: 'Viaje' }),
  transaction('coffee-1', { type: 'expense', merchant: 'Café Uno', description: 'Latte' }),
  transaction('coffee-2', { type: 'expense', merchant: 'Café Uno', description: 'Latte' }),
  transaction('coffee-3', { type: 'expense', merchant: 'Café Uno', description: 'Latte' }),
  transaction('description-only', { type: 'income', description: 'Reembolso' }),
  transaction('uncategorizable', { type: 'expense', description: '' }),
  transaction('transfer', { type: 'transfer', merchant: 'Café Uno', description: 'Traspaso' }),
]

function setQueries({
  transactionData = transactions,
  categoryData = categories,
  ruleData = rules,
}: {
  transactionData?: Transaction[]
  categoryData?: Category[]
  ruleData?: Rule[]
} = {}) {
  vi.mocked(useTransactions).mockReturnValue({
    data: transactionData,
    isLoading: false,
  } as ReturnType<typeof useTransactions>)
  vi.mocked(useCategories).mockReturnValue({ data: categoryData, isLoading: false } as ReturnType<
    typeof useCategories
  >)
  vi.mocked(useRules).mockReturnValue({ data: ruleData, isLoading: false } as ReturnType<
    typeof useRules
  >)
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RulesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return queryClient
}

describe('RulesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setQueries()
    vi.mocked(api.createRule).mockResolvedValue(rules[0])
    vi.mocked(api.toggleRule).mockResolvedValue(undefined)
  })

  it('renders empty rule and suggestion states from loaded data', () => {
    setQueries({ transactionData: [], categoryData: [], ruleData: [] })
    renderPage()

    expect(screen.getByText(/Aún no hay reglas/)).toBeInTheDocument()
    expect(screen.getByText('Reglas activas').nextElementSibling).toHaveTextContent('0')
    expect(screen.getByText('Sugerencias').nextElementSibling).toHaveTextContent('0')
    expect(screen.getByText('Movs. categorizables').nextElementSibling).toHaveTextContent('0')
    expect(screen.queryByText('Sugerencias · comercios frecuentes')).not.toBeInTheDocument()
  })

  it('shows loading instead of an empty rule state while data sources are pending', () => {
    vi.mocked(useTransactions).mockReturnValue({ data: undefined, isLoading: true } as ReturnType<
      typeof useTransactions
    >)
    vi.mocked(useCategories).mockReturnValue({ data: undefined, isLoading: true } as ReturnType<
      typeof useCategories
    >)
    vi.mocked(useRules).mockReturnValue({ data: undefined, isLoading: true } as ReturnType<
      typeof useRules
    >)
    renderPage()

    expect(screen.getByText('Cargando…')).toBeInTheDocument()
    expect(screen.queryByText(/Aún no hay reglas/)).not.toBeInTheDocument()
    expect(screen.queryByText('Reglas activas')).not.toBeInTheDocument()
  })

  it('announces a query failure instead of presenting loaded rule data', () => {
    vi.mocked(useRules).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as ReturnType<typeof useRules>)

    renderPage()

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudieron cargar las reglas')
    expect(screen.queryByText('Reglas activas')).not.toBeInTheDocument()
    expect(screen.queryByText(/Aún no hay reglas/)).not.toBeInTheDocument()
  })

  it('keeps an orphaned rule actionable when its destination category is missing', async () => {
    const user = userEvent.setup()
    setQueries({ categoryData: [], transactionData: [], ruleData: [rules[0]] })
    renderPage()

    expect(screen.getByText('«UBER»')).toBeInTheDocument()
    expect(screen.queryByText('Transporte')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Desactivar regla' }))
    await waitFor(() => expect(api.toggleRule).toHaveBeenCalledWith('uber-rule'))
  })

  it('shows rule states, category context, and merchant-frequency suggestions', () => {
    renderPage()

    expect(screen.getByText('Reglas activas').nextElementSibling).toHaveTextContent('1')
    expect(screen.getByText('Sugerencias').nextElementSibling).toHaveTextContent('1')
    expect(screen.getByText('Movs. categorizables').nextElementSibling).toHaveTextContent('6')
    expect(screen.getByRole('heading', { name: 'Reglas · 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desactivar regla' })).toHaveTextContent('Activa')
    expect(screen.getByRole('button', { name: 'Activar regla' })).toHaveTextContent('Inactiva')
    expect(screen.getAllByText('Transporte')).toHaveLength(2)
    expect(screen.getAllByText('Comida')).toHaveLength(2)
    expect(screen.getByText('Café Uno')).toBeInTheDocument()
    expect(screen.getByText('3x')).toBeInTheDocument()
    expect(screen.queryByText('2x')).not.toBeInTheDocument()
  })

  it('toggles active and inactive rules and invalidates rule data', async () => {
    const user = userEvent.setup()
    const queryClient = renderPage()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await user.click(screen.getByRole('button', { name: 'Desactivar regla' }))
    await user.click(screen.getByRole('button', { name: 'Activar regla' }))

    await waitFor(() => expect(api.toggleRule).toHaveBeenCalledTimes(2))
    expect(api.toggleRule).toHaveBeenNthCalledWith(1, 'uber-rule')
    expect(api.toggleRule).toHaveBeenNthCalledWith(2, 'coffee-rule')
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rules'] }))
  })

  it('prefills a frequent merchant and creates its rule', async () => {
    const user = userEvent.setup()
    const queryClient = renderPage()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const suggestion = screen.getByText('Café Uno').parentElement!.parentElement!

    await user.click(within(suggestion).getByRole('button', { name: 'Crear regla' }))
    expect(screen.getByPlaceholderText('Ej. Uber')).toHaveValue('Café Uno')
    await user.selectOptions(screen.getAllByRole('combobox')[2], 'food')
    await user.click(screen.getByRole('button', { name: 'Crear' }))

    await waitFor(() => expect(api.createRule).toHaveBeenCalledOnce())
    expect(vi.mocked(api.createRule).mock.calls[0][0]).toEqual({
      field: 'merchant',
      operator: 'contains',
      value: 'Café Uno',
      categoryId: 'food',
      isActive: true,
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rules'] })
    await waitFor(() =>
      expect(
        screen.queryByText('Automatiza la categorización por comercio o descripción.'),
      ).not.toBeInTheDocument(),
    )
  })

  it('supports description/starts-with rules and trims their value', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getAllByRole('button', { name: 'Crear regla' })[0])
    const selects = screen.getAllByRole('combobox')
    await user.selectOptions(selects[0], 'description')
    await user.selectOptions(selects[1], 'startsWith')
    await user.selectOptions(selects[2], 'transport')
    await user.type(screen.getByPlaceholderText('Ej. Uber'), '  Nómina  ')
    await user.click(screen.getByRole('button', { name: 'Crear' }))

    await waitFor(() => expect(api.createRule).toHaveBeenCalledOnce())
    expect(vi.mocked(api.createRule).mock.calls[0][0]).toEqual({
      field: 'description',
      operator: 'startsWith',
      value: 'Nómina',
      categoryId: 'transport',
      isActive: true,
    })
  })

  it('requires both a nonblank value and destination category', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getAllByRole('button', { name: 'Crear regla' })[0])
    const panelDescription = screen.getByText(
      'Automatiza la categorización por comercio o descripción.',
    )
    await user.selectOptions(screen.getAllByRole('combobox')[2], 'food')
    await user.type(screen.getByPlaceholderText('Ej. Uber'), '   ')
    await user.click(screen.getByRole('button', { name: 'Crear' }))
    expect(api.createRule).not.toHaveBeenCalled()

    await user.clear(screen.getByPlaceholderText('Ej. Uber'))
    await user.type(screen.getByPlaceholderText('Ej. Uber'), 'Uber')
    await user.selectOptions(screen.getAllByRole('combobox')[2], '')
    await user.click(screen.getByRole('button', { name: 'Crear' }))

    expect(api.createRule).not.toHaveBeenCalled()
    expect(panelDescription).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(panelDescription).not.toBeInTheDocument()
  })

  it('keeps rejected rule creation open and invalidates only after a successful retry', async () => {
    const user = userEvent.setup()
    vi.mocked(api.createRule)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(rules[0])
    const queryClient = renderPage()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await user.click(screen.getAllByRole('button', { name: 'Crear regla' })[0])
    const value = screen.getByPlaceholderText('Ej. Uber')
    await user.type(value, 'Uber Eats')
    await user.selectOptions(screen.getAllByRole('combobox')[2], 'food')
    await user.click(screen.getByRole('button', { name: 'Crear' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo crear la regla')
    expect(value).toHaveValue('Uber Eats')
    expect(
      screen.getByText('Automatiza la categorización por comercio o descripción.'),
    ).toBeInTheDocument()
    expect(invalidate).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Crear' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await waitFor(() => expect(api.createRule).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rules'] }))
    expect(
      screen.queryByText('Automatiza la categorización por comercio o descripción.'),
    ).not.toBeInTheDocument()
  })

  it('announces a rejected toggle and clears it before successful retry', async () => {
    const user = userEvent.setup()
    vi.mocked(api.toggleRule)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined)
    const queryClient = renderPage()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const toggle = screen.getByRole('button', { name: 'Desactivar regla' })

    await user.click(toggle)

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo actualizar la regla')
    expect(toggle).toHaveTextContent('Activa')
    expect(invalidate).not.toHaveBeenCalled()

    await user.click(toggle)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await waitFor(() => expect(api.toggleRule).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rules'] }))
  })
})
