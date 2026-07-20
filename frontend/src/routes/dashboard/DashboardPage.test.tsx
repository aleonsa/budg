import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account, Budget, Category, MSIPurchase, SavingsGoal, Transaction } from '@/types'
import { api } from '@/lib/api'
import DashboardPage from './DashboardPage'

const state = vi.hoisted(() => ({
  accounts: { data: [] as Account[], isLoading: false, isError: false },
  transactions: { data: [] as Transaction[], isLoading: false, isError: false },
  msi: { data: [] as MSIPurchase[], isLoading: false, isError: false },
  goals: { data: [] as SavingsGoal[], isLoading: false, isError: false },
  budgets: { data: [] as Budget[], isLoading: false, isError: false },
  categories: { data: [] as Category[], isLoading: false, isError: false },
  txPayloads: [] as unknown[],
  accountPayloads: [] as unknown[],
  invalidate: vi.fn(),
}))

vi.mock('@/hooks/useQueries', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useQueries')>('@/hooks/useQueries')
  return {
    ...actual,
    useAccounts: () => state.accounts,
    useTransactions: () => state.transactions,
    useMSIPurchases: () => state.msi,
    useSavingsGoals: () => state.goals,
    useBudgets: () => state.budgets,
    useCategories: () => state.categories,
  }
})

vi.mock('@/hooks/useTransactionMutations', () => ({
  useCreateTransaction: () => {
    const [isPending, setIsPending] = useState(false)
    const [error, setError] = useState<Error | null>(null)
    const mutate = (payload: unknown, callbacks?: { onSuccess?: () => void }) => {
      state.txPayloads.push(payload)
      setIsPending(true)
      setError(null)
      void (async () => {
        try {
          await api.createTransaction(payload as never)
          state.invalidate({ queryKey: ['transactions'] })
          state.invalidate({ queryKey: ['dashboard'] })
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

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: state.invalidate }),
  useMutation: (options: { mutationFn?: (payload: never) => unknown; onSuccess?: () => void }) => {
    const [isPending, setIsPending] = useState(false)
    const [error, setError] = useState<Error | null>(null)
    const mutate = (payload: unknown, callbacks?: { onSuccess?: () => void }) => {
      state.accountPayloads.push(payload)
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

vi.mock('@/lib/api', () => ({ api: { createAccount: vi.fn(), createTransaction: vi.fn() } }))

const category = (id: string, name: string, kind: Category['kind']): Category => ({
  id,
  name,
  kind,
  color: kind === 'expense' ? 'orange' : 'green',
  icon: kind === 'expense' ? 'ShoppingCart' : 'Wallet',
  parentId: null,
  isSystem: true,
  order: 0,
})

const transaction = (
  id: string,
  type: Transaction['type'],
  amount: number,
  categoryId: string | null,
  date = '2026-07-10',
): Transaction => ({
  id,
  accountId: 'debit-1',
  type,
  amount,
  categoryId,
  date,
  description: id,
  merchant: `merchant-${id}`,
  isReconciled: false,
  createdAt: date,
})

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  )
}

async function flushMutation() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 20, 12))
    state.accounts = { data: [], isLoading: false, isError: false }
    state.transactions = { data: [], isLoading: false, isError: false }
    state.msi = { data: [], isLoading: false, isError: false }
    state.goals = { data: [], isLoading: false, isError: false }
    state.budgets = { data: [], isLoading: false, isError: false }
    state.categories = { data: [], isLoading: false, isError: false }
    state.txPayloads.length = 0
    state.accountPayloads.length = 0
    state.invalidate.mockReset()
    vi.mocked(api.createAccount).mockReset()
    vi.mocked(api.createTransaction).mockReset()
  })

  afterEach(() => vi.useRealTimers())

  it('shows one loading state while any dashboard query is pending', () => {
    state.budgets.isLoading = true

    renderPage()

    expect(screen.getByRole('heading', { name: 'Inicio financiero' })).toBeInTheDocument()
    expect(screen.getByText('Cargando…')).toBeInTheDocument()
    expect(screen.queryByText('Overview mensual')).not.toBeInTheDocument()
  })

  it('announces query failure instead of rendering zero financial data', () => {
    state.transactions.isError = true

    renderPage()

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar el dashboard.')
    expect(screen.queryByText('Overview mensual')).not.toBeInTheDocument()
  })

  it('renders deterministic zero aggregates and empty business states', () => {
    renderPage()

    expect(screen.getByText('julio de 2026')).toBeInTheDocument()
    expect(screen.getByText('0% ahorro')).toBeInTheDocument()
    expect(screen.getByText('Sin alertas de presupuesto en este periodo.')).toBeInTheDocument()
    expect(screen.getByText('No hay gastos registrados en este periodo.')).toBeInTheDocument()
    expect(screen.getByText('No hay ingresos registrados en este periodo.')).toBeInTheDocument()
    expect(screen.getByText('0 activas')).toBeInTheDocument()
  })

  it('renders recent transfers as source-negative and only income as positive', () => {
    state.transactions.data = [
      transaction('Transferencia propia', 'transfer', 12_500, null, '2026-07-20'),
      transaction('Ingreso', 'income', 20_000, null, '2026-07-19'),
    ]
    renderPage()

    expect(screen.getByText('Transferencia propia').parentElement?.parentElement).toHaveTextContent(
      '−$125.00',
    )
    expect(screen.getByText('Ingreso').parentElement?.parentElement).toHaveTextContent('+$200.00')
  })

  it('anchors periods to local today and excludes movements after the period as-of date', () => {
    state.transactions.data = [
      transaction('future-month', 'expense', 90_000, null, '2026-08-25'),
      transaction('future-current-month', 'expense', 20_000, null, '2026-07-25'),
      transaction('current', 'expense', 10_000, null, '2026-07-10'),
      transaction('previous', 'expense', 5_000, null, '2026-06-10'),
    ]

    renderPage()

    expect(screen.getByText('julio de 2026')).toBeInTheDocument()
    expect(screen.getByText('Gasto mes').parentElement).toHaveTextContent('$100.00')
    fireEvent.click(screen.getByRole('button', { name: 'Periodo anterior' }))
    expect(screen.getByText('junio de 2026')).toBeInTheDocument()
    expect(screen.getByText('Gasto mes').parentElement).toHaveTextContent('$50.00')
    fireEvent.click(screen.getByRole('button', { name: 'Periodo siguiente' }))
    fireEvent.click(screen.getByRole('button', { name: 'Periodo siguiente' }))
    expect(screen.getByText('agosto de 2026')).toBeInTheDocument()
    expect(screen.getByText('Gasto mes').parentElement).toHaveTextContent('$0.00')
  })

  it('shows positive savings while preserving zero net worth', () => {
    state.accounts.data = [
      {
        id: 'debit-1',
        name: 'Nómina',
        type: 'debit',
        institution: 'BBVA',
        last4: '1111',
        currency: 'MXN',
        balance: 50_000,
        isActive: true,
      },
      {
        id: 'credit-1',
        name: 'Crédito',
        type: 'credit',
        institution: 'BBVA',
        last4: '2222',
        currency: 'MXN',
        creditLimit: 100_000,
        availableCredit: 50_000,
        isActive: true,
      },
    ]
    state.transactions.data = [
      transaction('salary', 'income', 30_000, null),
      transaction('expense', 'expense', 10_000, null),
    ]

    renderPage()

    expect(screen.getByText('67% ahorro')).toBeInTheDocument()
    expect(screen.getByText('Ahorro').parentElement).toHaveTextContent('$200.00')
    expect(screen.getByText('Patrimonio').parentElement).toHaveTextContent('$0.00')
  })

  it('computes positive and negative aggregates, budget alerts, MSI, goals, and period filtering', async () => {
    state.accounts.data = [
      {
        id: 'debit-1',
        name: 'Nómina',
        type: 'debit',
        institution: 'BBVA',
        last4: '1111',
        currency: 'MXN',
        balance: 100_000,
        isActive: true,
      },
      {
        id: 'credit-1',
        name: 'Crédito',
        type: 'credit',
        institution: 'BBVA',
        last4: '2222',
        currency: 'MXN',
        creditLimit: 120_000,
        availableCredit: 20_000,
        isActive: true,
      },
    ]
    state.categories.data = [
      category('food', 'Comida', 'expense'),
      category('salary', 'Nómina', 'income'),
    ]
    state.transactions.data = [
      transaction('salary-july', 'income', 50_000, 'salary', '2026-07-15'),
      transaction('food-july', 'expense', 60_000, 'food', '2026-07-10'),
      transaction('food-june', 'expense', 1_000, 'food', '2026-06-10'),
    ]
    state.budgets.data = [
      {
        id: 'food-budget',
        categoryId: 'food',
        amount: 50_000,
        period: 'monthly',
        startDate: '2026-07-01',
      },
    ]
    state.msi.data = [
      {
        id: 'active-msi',
        accountId: 'credit-1',
        description: 'Laptop',
        totalAmount: 24_000,
        installmentAmount: 2_000,
        installmentCount: 12,
        installmentsPaid: 2,
        startDate: '2026-05-01',
        categoryId: null,
        status: 'active',
      },
      {
        id: 'done-msi',
        accountId: 'credit-1',
        description: 'Teléfono',
        totalAmount: 12_000,
        installmentAmount: 1_000,
        installmentCount: 12,
        installmentsPaid: 12,
        startDate: '2025-01-01',
        categoryId: null,
        status: 'completed',
      },
    ]
    state.goals.data = [
      {
        id: 'goal',
        name: 'Emergencia',
        targetAmount: 100_000,
        currentAmount: 25_000,
        accountId: 'debit-1',
        isCompleted: false,
        order: 0,
      },
    ]
    renderPage()

    expect(screen.getByText('-20% ahorro')).toBeInTheDocument()
    expect(screen.getByText('Ahorro').parentElement).toHaveTextContent('-$100.00')
    expect(screen.getByText('120%')).toBeInTheDocument()
    expect(screen.getAllByText('Comida')).toHaveLength(2)
    expect(screen.getByText('$600.00 · 100%')).toBeInTheDocument()
    expect(screen.getByText('$500.00 · 100%')).toBeInTheDocument()
    expect(screen.getByText('Laptop')).toBeInTheDocument()
    expect(screen.queryByText('Teléfono')).not.toBeInTheDocument()
    expect(screen.getAllByText('$20.00')).toHaveLength(2)
    expect(screen.getByText('$250.00 de $1,000.00')).toBeInTheDocument()
    expect(
      screen.getByRole('progressbar', { name: 'Uso del presupuesto de Comida' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('progressbar', {
        name: 'Participación de Comida en distribución de gastos',
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Progreso total de metas' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Periodo anterior' }))

    expect(screen.getByText('junio de 2026')).toBeInTheDocument()
    expect(screen.getByText('0% ahorro')).toBeInTheDocument()
    expect(screen.getByText('$10.00 · 100%')).toBeInTheDocument()
  })

  it('submits quick expense form with normalized transaction payload', async () => {
    state.accounts.data = [
      {
        id: 'debit-1',
        name: 'Nómina',
        type: 'debit',
        institution: 'BBVA',
        last4: '1111',
        currency: 'MXN',
        balance: 1_000,
        isActive: true,
      },
    ]
    state.categories.data = [category('food', 'Comida', 'expense')]
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Agregar gasto' }))
    fireEvent.change(screen.getByPlaceholderText('$0.00'), { target: { value: '19.99' } })
    fireEvent.change(screen.getByPlaceholderText('Ej. Café, nómina, súper'), {
      target: { value: '  Cena  ' },
    })
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'food' } })
    fireEvent.change(screen.getByPlaceholderText('Ej. Uber, OXXO'), {
      target: { value: 'Restaurante' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }))
    await flushMutation()

    expect(state.txPayloads).toEqual([
      {
        type: 'expense',
        amount: 1_999,
        date: '2026-07-20',
        description: 'Cena',
        accountId: 'debit-1',
        categoryId: 'food',
        merchant: 'Restaurante',
        transferToAccountId: undefined,
      },
    ])
    expect(screen.queryByText('Captura rápida desde el dashboard.')).not.toBeInTheDocument()
  })

  it('submits quick income with income categories and optional fields omitted', async () => {
    state.accounts.data = [
      {
        id: 'debit-1',
        name: 'Nómina',
        type: 'debit',
        institution: 'BBVA',
        last4: '1111',
        currency: 'MXN',
        balance: 1_000,
        isActive: true,
      },
    ]
    state.categories.data = [
      category('food', 'Comida', 'expense'),
      category('salary', 'Salario', 'income'),
    ]
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Agregar ingreso' }))
    fireEvent.change(screen.getByPlaceholderText('$0.00'), { target: { value: '500.25' } })
    fireEvent.change(screen.getByPlaceholderText('Ej. Café, nómina, súper'), {
      target: { value: 'Bono' },
    })
    expect(screen.getByRole('option', { name: 'Salario' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Comida' })).not.toBeInTheDocument()
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'salary' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }))
    await flushMutation()

    expect(state.txPayloads).toEqual([
      {
        type: 'income',
        amount: 50_025,
        date: '2026-07-20',
        description: 'Bono',
        accountId: 'debit-1',
        categoryId: 'salary',
        merchant: undefined,
        transferToAccountId: undefined,
      },
    ])
  })

  it('requires a distinct destination before submitting a quick transfer', async () => {
    state.accounts.data = [
      {
        id: 'debit-1',
        name: 'Origen',
        type: 'debit',
        institution: 'BBVA',
        last4: '1111',
        currency: 'MXN',
        balance: 1_000,
        isActive: true,
      },
      {
        id: 'debit-2',
        name: 'Destino',
        type: 'debit',
        institution: 'Nu',
        last4: '2222',
        currency: 'MXN',
        balance: 2_000,
        isActive: true,
      },
    ]
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Transferencia' }))
    fireEvent.change(screen.getByPlaceholderText('$0.00'), { target: { value: '75' } })
    fireEvent.change(screen.getByPlaceholderText('Entre cuentas'), {
      target: { value: 'Mover ahorro' },
    })
    expect(screen.queryByPlaceholderText('Ej. Uber, OXXO')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }))
    await flushMutation()
    expect(state.txPayloads).toHaveLength(0)

    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'debit-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }))
    expect(state.txPayloads).toHaveLength(0)

    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'debit-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }))

    expect(state.txPayloads).toEqual([
      {
        type: 'transfer',
        amount: 7_500,
        date: '2026-07-20',
        description: 'Mover ahorro',
        accountId: 'debit-1',
        categoryId: null,
        merchant: undefined,
        transferToAccountId: 'debit-2',
      },
    ])
  })

  it('creates a credit account from the quick action and invalidates account summaries', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Nueva cuenta' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(state.accountPayloads).toHaveLength(0)
    const accountName = screen.getByRole('textbox', { name: 'Nombre de cuenta' })
    expect(screen.getByRole('alert')).toHaveTextContent('Ingresa un nombre de cuenta.')
    expect(accountName).toHaveAttribute('aria-invalid', 'true')
    expect(accountName).toHaveAccessibleDescription('Ingresa un nombre de cuenta.')

    fireEvent.change(accountName, {
      target: { value: '  Tarjeta viaje  ' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Tipo' }), {
      target: { value: 'credit' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Saldo inicial' }), {
      target: { value: '3000' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await flushMutation()

    expect(state.accountPayloads).toEqual([
      {
        name: 'Tarjeta viaje',
        type: 'credit',
        institution: 'Banco',
        last4: '0000',
        currency: 'MXN',
        creditLimit: 300_000,
        availableCredit: 300_000,
      },
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Nueva cuenta' }))
    expect(screen.getByRole('textbox', { name: 'Nombre de cuenta' })).toHaveValue('')
    expect(screen.getByRole('combobox', { name: 'Tipo' })).toHaveValue('debit')
    expect(screen.getByRole('textbox', { name: 'Saldo inicial' })).toHaveValue('')
    fireEvent.change(screen.getByRole('textbox', { name: 'Nombre de cuenta' }), {
      target: { value: 'Efectivo' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Saldo inicial' }), {
      target: { value: '25' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await flushMutation()

    expect(state.accountPayloads[1]).toEqual({
      name: 'Efectivo',
      type: 'debit',
      institution: 'Banco',
      last4: '0000',
      currency: 'MXN',
      balance: 2_500,
    })
    expect(state.invalidate).toHaveBeenCalledTimes(4)
    expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ['accounts'] })
    expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard'] })
    expect(api.createAccount).toHaveBeenCalledTimes(2)
  })

  it('keeps quick-account panel open and announces API rejection without invalidating', async () => {
    vi.mocked(api.createAccount).mockRejectedValueOnce(new Error('offline'))
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Nueva cuenta' }))
    const name = screen.getByRole('textbox', { name: 'Nombre de cuenta' })
    fireEvent.change(name, { target: { value: 'Cuenta fallida' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Saldo inicial' }), {
      target: { value: '100' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await flushMutation()

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo crear la cuenta')
    expect(screen.getByRole('heading', { name: 'Nueva cuenta' })).toBeInTheDocument()
    expect(name).toHaveValue('Cuenta fallida')
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAccessibleDescription('No se pudo crear la cuenta. Intenta de nuevo.')
    expect(state.invalidate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await flushMutation()
    expect(screen.queryByRole('heading', { name: 'Nueva cuenta' })).not.toBeInTheDocument()
    expect(state.invalidate).toHaveBeenCalledTimes(2)
  })

  it('keeps quick-transaction form open and resets its announced API error', async () => {
    vi.mocked(api.createTransaction).mockRejectedValueOnce(new Error('offline'))
    state.accounts.data = [
      {
        id: 'debit-1',
        name: 'Nómina',
        type: 'debit',
        institution: 'BBVA',
        last4: '1111',
        currency: 'MXN',
        balance: 1_000,
        isActive: true,
      },
    ]
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Agregar gasto' }))
    const amount = screen.getByRole('textbox', { name: 'Monto' })
    const description = screen.getByRole('textbox', { name: 'Descripción' })
    fireEvent.change(amount, { target: { value: '19.99' } })
    fireEvent.change(description, { target: { value: 'Cena' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }))
    await flushMutation()

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo crear el movimiento')
    expect(screen.getByRole('heading', { name: 'Agregar gasto' })).toBeInTheDocument()
    expect(amount).toHaveValue('19.99')
    expect(description).toHaveValue('Cena')
    expect(state.invalidate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await flushMutation()
    expect(screen.queryByRole('heading', { name: 'Agregar gasto' })).not.toBeInTheDocument()
  })

  it('uses General fallbacks while excluding unknown categories from distributions', () => {
    state.transactions.data = [transaction('mystery-expense', 'expense', 9_000, 'missing')]
    state.budgets.data = [
      {
        id: 'mystery-budget',
        categoryId: 'missing',
        amount: 10_000,
        period: 'monthly',
        startDate: '2026-07-01',
      },
    ]
    renderPage()

    expect(screen.getByText('General')).toBeInTheDocument()
    expect(screen.getByText('90%')).toBeInTheDocument()
    expect(screen.getByText('No hay gastos registrados en este periodo.')).toBeInTheDocument()
    expect(screen.getByText('mystery-expense')).toBeInTheDocument()
    expect(screen.getByText('merchant-mystery-expense')).toBeInTheDocument()
  })

  it('orders exceeded budgets before near-limit budgets and caps critical alerts', () => {
    state.categories.data = [
      category('high', 'Exceso alto', 'expense'),
      category('low', 'Exceso menor', 'expense'),
      category('near', 'Casi lleno', 'expense'),
      category('boundary', 'Límite exacto', 'expense'),
    ]
    state.budgets.data = [
      {
        id: 'near',
        categoryId: 'near',
        amount: 10_000,
        period: 'monthly',
        startDate: '2026-07-01',
      },
      { id: 'low', categoryId: 'low', amount: 10_000, period: 'monthly', startDate: '2026-07-01' },
      {
        id: 'boundary',
        categoryId: 'boundary',
        amount: 10_000,
        period: 'monthly',
        startDate: '2026-07-01',
      },
      {
        id: 'high',
        categoryId: 'high',
        amount: 10_000,
        period: 'monthly',
        startDate: '2026-07-01',
      },
    ]
    state.transactions.data = [
      transaction('near-spend', 'expense', 9_000, 'near'),
      transaction('low-spend', 'expense', 12_000, 'low'),
      transaction('boundary-spend', 'expense', 8_000, 'boundary'),
      transaction('high-spend', 'expense', 15_000, 'high'),
    ]
    renderPage()

    const alerts =
      screen.getByText('Presupuestos críticos').parentElement?.parentElement?.parentElement
    expect(alerts).not.toBeNull()
    expect(alerts).toHaveTextContent(/Exceso alto.*Exceso menor.*Casi lleno/)
    expect(within(alerts!).queryByText('Límite exacto')).not.toBeInTheDocument()
  })

  it('shows alerts only for applicable newer category budgets or the global scope', () => {
    state.categories.data = [
      category('food', 'Comida', 'expense'),
      category('rent', 'Renta', 'expense'),
    ]
    state.transactions.data = [
      transaction('food-spend', 'expense', 9_000, 'food'),
      transaction('rent-spend', 'expense', 9_000, 'rent'),
    ]
    state.budgets.data = [
      {
        id: 'old-food',
        categoryId: 'food',
        amount: 10_000,
        period: 'monthly',
        startDate: '2026-06-01',
      },
      {
        id: 'new-food',
        categoryId: 'food',
        amount: 20_000,
        period: 'monthly',
        startDate: '2026-07-01',
      },
      {
        id: 'rent',
        categoryId: 'rent',
        amount: 10_000,
        period: 'monthly',
        startDate: '2026-07-01',
      },
    ]
    const { unmount } = renderPage()

    const categoryAlerts =
      screen.getByText('Presupuestos críticos').parentElement?.parentElement?.parentElement
    expect(categoryAlerts).not.toBeNull()
    expect(within(categoryAlerts!).queryByText('Comida')).not.toBeInTheDocument()
    expect(within(categoryAlerts!).getByText('Renta')).toBeInTheDocument()
    unmount()

    state.budgets.data.push({
      id: 'global',
      categoryId: null,
      amount: 20_000,
      period: 'monthly',
      startDate: '2026-07-01',
    })
    renderPage()

    const globalAlerts =
      screen.getByText('Presupuestos críticos').parentElement?.parentElement?.parentElement
    expect(globalAlerts).not.toBeNull()
    expect(within(globalAlerts!).getByText('General')).toBeInTheDocument()
    expect(within(globalAlerts!).queryByText('Renta')).not.toBeInTheDocument()
  })

  it('uses anchored budget periods, excludes pre-start spending, and treats global as all expenses', () => {
    state.categories.data = [
      category('food', 'Comida', 'expense'),
      category('rent', 'Renta', 'expense'),
    ]
    state.transactions.data = [
      transaction('period-anchor', 'income', 1, null, '2026-07-20'),
      transaction('year-spend', 'expense', 10_000, 'food', '2026-01-10'),
      transaction('before-week', 'expense', 9_000, 'food', '2026-07-14'),
      transaction('current-week', 'expense', 2_000, 'food', '2026-07-15'),
      transaction('before-monthly-start', 'expense', 900, 'food', '2026-07-17'),
      transaction('after-monthly-start', 'expense', 200, 'food', '2026-07-19'),
      transaction('anchored-month-current', 'expense', 100, 'rent', '2026-07-24'),
      transaction('anchored-month-next', 'expense', 1_000, 'rent', '2026-07-25'),
      transaction('anchored-year-next', 'expense', 10_000, 'food', '2026-09-15'),
    ]
    state.budgets.data = [
      {
        id: 'weekly',
        categoryId: 'food',
        amount: 10_000,
        period: 'weekly',
        startDate: '2026-07-01',
      },
      {
        id: 'monthly',
        categoryId: 'food',
        amount: 1_000,
        period: 'monthly',
        startDate: '2026-07-18',
      },
      {
        id: 'anchored-monthly',
        categoryId: 'rent',
        amount: 1_000,
        period: 'monthly',
        startDate: '2026-06-25',
      },
      {
        id: 'global-year',
        categoryId: null,
        amount: 25_000,
        period: 'yearly',
        startDate: '2025-09-15',
      },
    ]
    renderPage()

    const alerts =
      screen.getByText('Presupuestos críticos').parentElement?.parentElement?.parentElement
    expect(alerts).not.toBeNull()
    expect(within(alerts!).getByText('General')).toBeInTheDocument()
    expect(within(alerts!).getByText('88%')).toBeInTheDocument()
    expect(within(alerts!).queryByText('Comida')).not.toBeInTheDocument()
    expect(within(alerts!).queryByText('Renta')).not.toBeInTheDocument()
  })
})
