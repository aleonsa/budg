import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAccounts, useCategories, useRecurringTransactions } from '@/hooks/useQueries'
import { api } from '@/lib/api'
import type { Account, Category, RecurringTransaction } from '@/types'
import RecurringTransactionsPage from './RecurringTransactionsPage'

vi.mock('@/hooks/useQueries', () => ({
  useAccounts: vi.fn(),
  useCategories: vi.fn(),
  useRecurringTransactions: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    createRecurringTransaction: vi.fn(),
    updateRecurringTransaction: vi.fn(),
    deleteRecurringTransaction: vi.fn(),
  },
}))

const account: Account = {
  id: 'acct-1',
  name: 'Nómina BBVA',
  type: 'debit',
  institution: 'BBVA',
  last4: '1234',
  currency: 'MXN',
  balance: 100_000,
  isActive: true,
}

const category: Category = {
  id: 'cat-1',
  name: 'Salud',
  kind: 'expense',
  color: 'green',
  icon: 'HeartPulse',
  parentId: null,
  isSystem: false,
  order: 1,
}

const recurring: RecurringTransaction = {
  id: 'recurring-1',
  accountId: account.id,
  categoryId: category.id,
  description: 'Membresía del gym',
  merchant: 'Gym',
  amount: 89900,
  frequency: 'monthly',
  startDate: '2026-07-01',
  nextDate: '2026-08-01',
  isActive: true,
}

function setQueries({
  accountData = [account],
  categoryData = [category],
  recurringData = [recurring],
}: {
  accountData?: Account[]
  categoryData?: Category[]
  recurringData?: RecurringTransaction[]
} = {}) {
  vi.mocked(useAccounts).mockReturnValue({ data: accountData, isLoading: false } as ReturnType<
    typeof useAccounts
  >)
  vi.mocked(useCategories).mockReturnValue({ data: categoryData, isLoading: false } as ReturnType<
    typeof useCategories
  >)
  vi.mocked(useRecurringTransactions).mockReturnValue({
    data: recurringData,
    isLoading: false,
  } as ReturnType<typeof useRecurringTransactions>)
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RecurringTransactionsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return queryClient
}

describe('RecurringTransactionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setQueries()
    vi.mocked(api.createRecurringTransaction).mockResolvedValue(recurring)
    vi.mocked(api.updateRecurringTransaction).mockResolvedValue(recurring)
    vi.mocked(api.deleteRecurringTransaction).mockResolvedValue()
  })

  it('renders active recurring payments with resolved account, category, amount, and next date', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'Suscripciones' })).toBeInTheDocument()
    expect(screen.getByText('Membresía del gym')).toBeInTheDocument()
    expect(screen.getByText('Gym')).toBeInTheDocument()
    expect(screen.getByText('Nómina BBVA')).toBeInTheDocument()
    expect(screen.getByText('Salud')).toBeInTheDocument()
    expect(screen.getByText('$899.00')).toBeInTheDocument()
    expect(screen.getByText(/Mensual · Próximo 01 ago 2026/)).toBeInTheDocument()
    expect(screen.getByText('Activa')).toBeInTheDocument()
  })

  it('does not present a stale next charge date for paused subscriptions', () => {
    setQueries({ recurringData: [{ ...recurring, isActive: false }] })
    renderPage()

    expect(screen.getByText('Mensual · En pausa')).toBeInTheDocument()
    expect(screen.queryByText(/Próximo/)).not.toBeInTheDocument()
  })

  it('creates a monthly subscription and refreshes recurring transaction data', async () => {
    const user = userEvent.setup()
    const queryClient = renderPage()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await user.click(screen.getByRole('button', { name: 'Agregar suscripción' }))
    const dialog = screen.getByRole('dialog', { name: 'Agregar suscripción' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Descripción' }), '  Música  ')
    await user.type(within(dialog).getByRole('textbox', { name: 'Comercio' }), 'Spotify')
    await user.type(within(dialog).getByRole('textbox', { name: 'Monto' }), '129.50')
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Categoría' }), 'cat-1')
    await user.clear(within(dialog).getByLabelText('Inicio'))
    await user.type(within(dialog).getByLabelText('Inicio'), '2026-08-15')
    await user.click(within(dialog).getByRole('button', { name: 'Agregar' }))

    await waitFor(() => expect(api.createRecurringTransaction).toHaveBeenCalledOnce())
    expect(vi.mocked(api.createRecurringTransaction).mock.calls[0][0]).toEqual({
      accountId: 'acct-1',
      categoryId: 'cat-1',
      description: 'Música',
      merchant: 'Spotify',
      amount: 12_950,
      frequency: 'monthly',
      startDate: '2026-08-15',
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['recurring-transactions'] })
  })

  it('edits every user-controlled field and refreshes recurring transaction data', async () => {
    const user = userEvent.setup()
    const queryClient = renderPage()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await user.click(screen.getByRole('button', { name: 'Editar Membresía del gym' }))
    const dialog = screen.getByRole('dialog', { name: 'Editar suscripción' })
    const description = within(dialog).getByRole('textbox', { name: 'Descripción' })
    const amount = within(dialog).getByRole('textbox', { name: 'Monto' })
    await user.clear(description)
    await user.type(description, '  Gym premium  ')
    await user.clear(amount)
    await user.type(amount, '999.50')
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Categoría' }), '')
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Frecuencia' }), 'yearly')
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Estado' }), 'inactive')
    await user.clear(within(dialog).getByLabelText('Inicio'))
    await user.type(within(dialog).getByLabelText('Inicio'), '2026-09-15')
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(api.updateRecurringTransaction).toHaveBeenCalledOnce())
    expect(api.updateRecurringTransaction).toHaveBeenCalledWith('recurring-1', {
      accountId: 'acct-1',
      categoryId: null,
      description: 'Gym premium',
      merchant: 'Gym',
      amount: 99_950,
      frequency: 'yearly',
      startDate: '2026-09-15',
      isActive: false,
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['recurring-transactions'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['transactions'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['accounts'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard'] })
  })

  it('requires destructive confirmation before deleting a subscription', async () => {
    const user = userEvent.setup()
    const queryClient = renderPage()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await user.click(screen.getByRole('button', { name: 'Eliminar Membresía del gym' }))
    expect(api.deleteRecurringTransaction).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: 'Eliminar suscripción' })
    expect(dialog).toHaveTextContent('Los movimientos ya registrados se conservarán')
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar suscripción' }))

    await waitFor(() => expect(api.deleteRecurringTransaction).toHaveBeenCalledWith('recurring-1'))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['recurring-transactions'] })
  })

  it('renders loading and query-error states without false empty data', () => {
    vi.mocked(useRecurringTransactions).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as ReturnType<typeof useRecurringTransactions>)
    renderPage()

    expect(screen.getByText('Cargando…')).toBeInTheDocument()
    expect(screen.queryByText('Sin suscripciones registradas')).not.toBeInTheDocument()
    cleanup()

    vi.mocked(useRecurringTransactions).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as ReturnType<typeof useRecurringTransactions>)
    renderPage()

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudieron cargar las suscripciones')
  })
})
