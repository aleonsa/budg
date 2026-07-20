import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAccounts, useBudgets, useCategories, useTransactions } from '@/hooks/useQueries'
import type { Account, Budget, Category, Transaction } from '@/types'
import StatsPage from './StatsPage'

vi.mock('@/hooks/useQueries', () => ({
  useAccounts: vi.fn(),
  useBudgets: vi.fn(),
  useCategories: vi.fn(),
  useTransactions: vi.fn(),
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
    order: 1,
  },
  {
    id: 'rent',
    name: 'Renta',
    kind: 'expense',
    color: 'blue',
    icon: 'House',
    parentId: null,
    isSystem: false,
    order: 2,
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

const accounts: Account[] = [
  {
    id: 'checking',
    name: 'Cuenta Nómina',
    type: 'debit',
    institution: 'Banco',
    last4: '1111',
    currency: 'MXN',
    balance: 100000,
    isActive: true,
  },
  {
    id: 'card',
    name: 'Tarjeta Azul',
    type: 'credit',
    institution: 'Banco',
    last4: '2222',
    currency: 'MXN',
    creditLimit: 200000,
    availableCredit: 100000,
    isActive: true,
  },
]

function tx(
  id: string,
  overrides: Partial<Transaction> & Pick<Transaction, 'type' | 'amount' | 'date'>,
): Transaction {
  return {
    id,
    accountId: 'checking',
    categoryId: null,
    description: id,
    isReconciled: true,
    createdAt: overrides.date,
    ...overrides,
  }
}

const transactions: Transaction[] = [
  tx('salary-july', { type: 'income', amount: 100000, date: '2026-07-15', categoryId: 'salary' }),
  tx('food-msi', {
    type: 'expense',
    amount: 30000,
    date: '2026-07-02',
    categoryId: 'food',
    accountId: 'card',
    msiPurchaseId: 'laptop',
  }),
  tx('food-cash', {
    type: 'expense',
    amount: 20000,
    date: '2026-07-10',
    categoryId: 'food',
    accountId: 'card',
  }),
  tx('rent-july', { type: 'expense', amount: 25000, date: '2026-07-01', categoryId: 'rent' }),
  tx('uncategorized', { type: 'expense', amount: 5000, date: '2026-07-18', accountId: 'card' }),
  tx('transfer', {
    type: 'transfer',
    amount: 9000,
    date: '2026-07-19',
    accountId: 'card',
    transferToAccountId: 'checking',
  }),
  tx('salary-june', { type: 'income', amount: 50000, date: '2026-06-15', categoryId: 'salary' }),
  tx('expense-june', { type: 'expense', amount: 60000, date: '2026-06-20', categoryId: 'food' }),
]

const budgets: Budget[] = [
  {
    id: 'food-budget',
    categoryId: 'food',
    amount: 40000,
    period: 'monthly',
    startDate: '2026-01-01',
  },
  {
    id: 'rent-budget',
    categoryId: 'rent',
    amount: 10000,
    period: 'monthly',
    startDate: '2026-01-01',
  },
]

function setQueries({
  transactionData = transactions,
  categoryData = categories,
  accountData = accounts,
  budgetData = budgets,
  loading = false,
}: {
  transactionData?: Transaction[]
  categoryData?: Category[]
  accountData?: Account[]
  budgetData?: Budget[]
  loading?: boolean
} = {}) {
  vi.mocked(useTransactions).mockReturnValue({
    data: transactionData,
    isLoading: loading,
  } as ReturnType<typeof useTransactions>)
  vi.mocked(useCategories).mockReturnValue({ data: categoryData, isLoading: loading } as ReturnType<
    typeof useCategories
  >)
  vi.mocked(useAccounts).mockReturnValue({ data: accountData, isLoading: loading } as ReturnType<
    typeof useAccounts
  >)
  vi.mocked(useBudgets).mockReturnValue({ data: budgetData, isLoading: loading } as ReturnType<
    typeof useBudgets
  >)
}

function renderPage() {
  render(
    <MemoryRouter>
      <StatsPage />
    </MemoryRouter>,
  )
}

function metric(label: string) {
  return screen.getByText(label, { selector: 'p' }).parentElement!
}

describe('StatsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-07-20T12:00:00-06:00'))
    setQueries()
  })

  afterEach(() => vi.useRealTimers())

  it('shows loading while any source query is loading', () => {
    setQueries({ loading: true })
    renderPage()

    expect(screen.getByRole('heading', { name: 'Estadísticas' })).toBeInTheDocument()
    expect(screen.getByText('Cargando…')).toBeInTheDocument()
    expect(screen.queryByText('Periodo actual')).not.toBeInTheDocument()
  })

  it('shows an accessible failure instead of an empty state when a query fails', () => {
    vi.mocked(useTransactions).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('transactions unavailable'),
    } as ReturnType<typeof useTransactions>)
    renderPage()

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudieron cargar las estadísticas.')
    expect(screen.queryByText('Sin datos suficientes')).not.toBeInTheDocument()
  })

  it('shows the empty state after transactions load empty', () => {
    setQueries({ transactionData: [] })
    renderPage()

    expect(screen.getByText('Sin datos suficientes')).toBeInTheDocument()
    expect(screen.getByText('Registra movimientos para ver estadísticas.')).toBeInTheDocument()
  })

  it('uses the empty state when transaction query data is unavailable', () => {
    vi.mocked(useTransactions).mockReturnValue({ data: undefined, isLoading: false } as ReturnType<
      typeof useTransactions
    >)
    renderPage()

    expect(screen.getByText('Sin datos suficientes')).toBeInTheDocument()
  })

  it('keeps metrics available when category, account, and budget query data are unavailable', () => {
    vi.mocked(useCategories).mockReturnValue({ data: undefined, isLoading: false } as ReturnType<
      typeof useCategories
    >)
    vi.mocked(useAccounts).mockReturnValue({ data: undefined, isLoading: false } as ReturnType<
      typeof useAccounts
    >)
    vi.mocked(useBudgets).mockReturnValue({ data: undefined, isLoading: false } as ReturnType<
      typeof useBudgets
    >)
    renderPage()

    expect(metric('Ingresos')).toHaveTextContent('$1,000.00')
    expect(screen.queryByText('Gastos por categoría')).not.toBeInTheDocument()
    expect(screen.queryByText('Cuenta más usada')).not.toBeInTheDocument()
    expect(screen.queryByText('Presupuesto más excedido')).not.toBeInTheDocument()
  })

  it('calculates current-month metrics and excludes transfers from movement averages', () => {
    renderPage()

    expect(screen.getByText(/julio de 2026/i)).toBeInTheDocument()
    expect(metric('Ingresos')).toHaveTextContent('$1,000.00')
    expect(metric('Gastos')).toHaveTextContent('$800.00')
    expect(metric('Ahorro neto')).toHaveTextContent('$200.00')
    expect(metric('Ahorro neto')).toHaveTextContent('5 movimientos')
    expect(metric('Tasa de ahorro')).toHaveTextContent('20%')
    expect(metric('Promedio diario')).toHaveTextContent('$26.67')
    expect(metric('Gasto por mov.')).toHaveTextContent('$200.00')
  })

  it('calculates category shares, budget excess, account usage, and MSI load', () => {
    renderPage()

    const expenseSection = screen.getByRole('heading', {
      name: 'Gastos por categoría',
    }).parentElement!
    expect(within(expenseSection).getByText('Comida')).toBeInTheDocument()
    expect(within(expenseSection).getByText('67%')).toBeInTheDocument()
    expect(within(expenseSection).getByText('Renta')).toBeInTheDocument()
    expect(within(expenseSection).getByText('33%')).toBeInTheDocument()
    expect(
      within(expenseSection).getByRole('progressbar', {
        name: 'Participación de Comida en gastos por categoría',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('Mayor categoría de gasto').parentElement).toHaveTextContent(
      'Comida · $500.00',
    )
    expect(screen.getByText('Presupuesto más excedido').parentElement).toHaveTextContent(
      'Renta · 250%',
    )
    expect(screen.getByText('Cuenta más usada').parentElement).toHaveTextContent(
      'Tarjeta Azul · 3 movs.',
    )
    expect(screen.getByText('Carga MSI mensual').parentElement).toHaveTextContent('$300.00')
  })

  it('orders monthly trends newest first and preserves negative net values', () => {
    renderPage()

    const trend = screen.getByRole('heading', { name: 'Tendencia mensual' }).parentElement!
    const july = within(trend).getByText(/jul 26/i)
    const june = within(trend).getByText(/jun 26/i)
    expect(july.compareDocumentPosition(june) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(trend).getByText('$200')).toBeInTheDocument()
    expect(within(trend).getByText('-$100')).toBeInTheDocument()
  })

  it('reports a global budget using all eligible expense categories', () => {
    setQueries({
      transactionData: [
        tx('food-expense', {
          type: 'expense',
          amount: 1200,
          date: '2026-07-20',
          categoryId: 'food',
        }),
        tx('rent-expense', {
          type: 'expense',
          amount: 800,
          date: '2026-07-20',
          categoryId: 'rent',
        }),
        tx('uncategorized-expense', {
          type: 'expense',
          amount: 500,
          date: '2026-07-20',
          categoryId: null,
        }),
      ],
      budgetData: [
        {
          id: 'global',
          categoryId: null,
          amount: 2000,
          period: 'monthly',
          startDate: '2026-07-01',
        },
      ],
    })
    renderPage()

    expect(screen.getByText('Presupuesto más excedido').parentElement).toHaveTextContent(
      'General · 125%',
    )
    expect(screen.getByText('Mayor categoría de gasto').parentElement).toHaveTextContent(
      'Comida · $12.00',
    )
  })

  it('gives the latest active global budget precedence over overlapping scopes', () => {
    setQueries({
      transactionData: [
        tx('food-expense', {
          type: 'expense',
          amount: 1200,
          date: '2026-07-20',
          categoryId: 'food',
        }),
        tx('rent-expense', {
          type: 'expense',
          amount: 800,
          date: '2026-07-20',
          categoryId: 'rent',
        }),
        tx('uncategorized-expense', {
          type: 'expense',
          amount: 500,
          date: '2026-07-20',
          categoryId: null,
        }),
      ],
      budgetData: [
        {
          id: 'old-global',
          categoryId: null,
          amount: 100,
          period: 'monthly',
          startDate: '2026-07-01',
        },
        {
          id: 'food',
          categoryId: 'food',
          amount: 100,
          period: 'monthly',
          startDate: '2026-07-10',
        },
        {
          id: 'latest-global',
          categoryId: null,
          amount: 1500,
          period: 'monthly',
          startDate: '2026-07-15',
        },
        {
          id: 'future-global',
          categoryId: null,
          amount: 1,
          period: 'monthly',
          startDate: '2026-07-21',
        },
      ],
    })
    renderPage()

    expect(screen.getByText('Presupuesto más excedido').parentElement).toHaveTextContent(
      'General · 167%',
    )
  })

  it.each([
    ['weekly', '2026-07-15', '120%'],
    ['monthly', '2026-06-15', '120%'],
    ['yearly', '2025-08-01', '210%'],
  ] as const)('uses the %s budget cycle anchored by start date', (period, startDate, expected) => {
    setQueries({
      transactionData: [
        tx('old-food', {
          type: 'expense',
          amount: 900,
          date: '2026-07-10',
          categoryId: 'food',
        }),
        tx('current-food', {
          type: 'expense',
          amount: 1200,
          date: '2026-07-20',
          categoryId: 'food',
        }),
      ],
      budgetData: [
        {
          id: 'weekly-food',
          categoryId: 'food',
          amount: 1000,
          period,
          startDate,
        },
      ],
    })
    renderPage()

    expect(screen.getByText('Presupuesto más excedido').parentElement).toHaveTextContent(
      `Comida · ${expected}`,
    )
  })

  it('does not activate a budget before its start date', () => {
    setQueries({
      transactionData: [
        tx('food-before-budget', {
          type: 'expense',
          amount: 2000,
          date: '2026-07-20',
          categoryId: 'food',
        }),
      ],
      budgetData: [
        {
          id: 'future-food',
          categoryId: 'food',
          amount: 1000,
          period: 'monthly',
          startDate: '2026-07-21',
        },
      ],
    })
    renderPage()

    expect(screen.queryByText('Presupuesto más excedido')).not.toBeInTheDocument()
  })

  it('handles missing category and account references with a negative savings insight', () => {
    setQueries({
      transactionData: [
        tx('small-income', {
          type: 'income',
          amount: 1000,
          date: '2026-07-20',
          categoryId: 'salary',
          accountId: 'missing-account',
        }),
        tx('orphan-expense', {
          type: 'expense',
          amount: 2000,
          date: '2026-07-20',
          categoryId: 'missing',
          accountId: 'missing-account',
        }),
      ],
      budgetData: [
        {
          id: 'orphan-budget',
          categoryId: 'missing',
          amount: 1000,
          period: 'monthly',
          startDate: '2026-01-01',
        },
      ],
    })
    renderPage()

    expect(metric('Tasa de ahorro')).toHaveTextContent('-100%')
    expect(screen.getByText('Presupuesto más excedido').parentElement).toHaveTextContent('— · 200%')
    expect(screen.queryByText('Cuenta más usada')).not.toBeInTheDocument()
    expect(screen.queryByText('Mayor categoría de gasto')).not.toBeInTheDocument()
  })

  it('uses zero movement denominators for a transfer-only latest month', () => {
    setQueries({
      transactionData: [
        tx('transfer-only', {
          type: 'transfer',
          amount: 10000,
          date: '2026-07-20',
          transferToAccountId: 'card',
        }),
      ],
      budgetData: [],
    })
    renderPage()

    expect(metric('Ahorro neto')).toHaveTextContent('0 movimientos')
    expect(metric('Gasto por mov.')).toHaveTextContent('$0.00')
    expect(screen.queryByText('Gastos por categoría')).not.toBeInTheDocument()
    expect(screen.queryByText('Ingresos por categoría')).not.toBeInTheDocument()
    expect(screen.queryByText('Cuenta más usada')).not.toBeInTheDocument()
  })
})
