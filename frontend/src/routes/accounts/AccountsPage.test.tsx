import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account, Category, MSIPurchase } from '@/types'
import { api } from '@/lib/api'
import AccountsPage from './AccountsPage'

const state = vi.hoisted(() => ({
  accounts: { data: [] as Account[], isLoading: false, isError: false },
  msi: { data: [] as MSIPurchase[], isLoading: false, isError: false },
  categories: { data: [] as Category[], isLoading: false, isError: false },
  invalidate: vi.fn(),
  reset: vi.fn(),
  payloads: [] as unknown[],
}))

vi.mock('@/hooks/useQueries', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useQueries')>('@/hooks/useQueries')
  return {
    ...actual,
    useAccounts: () => state.accounts,
    useMSIPurchases: () => state.msi,
    useCategories: () => state.categories,
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

vi.mock('@/lib/api', () => ({
  api: {
    createAccount: vi.fn(),
    updateAccount: vi.fn(),
    deleteAccount: vi.fn(),
    createMSIPurchase: vi.fn(),
  },
}))

const debit = (overrides: Partial<Account> = {}): Account => ({
  id: 'debit-1',
  name: 'Nómina',
  type: 'debit',
  institution: 'BBVA',
  last4: '1111',
  currency: 'MXN',
  balance: 30_000,
  isActive: true,
  ...overrides,
})

const credit = (overrides: Partial<Account> = {}): Account => ({
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
  isActive: true,
  ...overrides,
})

const msi = (overrides: Partial<MSIPurchase> = {}): MSIPurchase => ({
  id: 'msi-1',
  accountId: 'credit-1',
  description: 'Laptop',
  merchant: 'Tienda Tech',
  totalAmount: 24_000,
  installmentAmount: 2_000,
  installmentCount: 12,
  installmentsPaid: 3,
  startDate: '2026-04-01',
  nextInstallmentDate: '2026-08-15',
  categoryId: null,
  status: 'active',
  ...overrides,
})

const expenseCategory = (overrides: Partial<Category> = {}): Category => ({
  id: 'cat-tech',
  name: 'Tecnología',
  kind: 'expense',
  color: 'blue',
  icon: 'Laptop',
  isSystem: false,
  order: 1,
  ...overrides,
  parentId: overrides.parentId ?? null,
})

function renderPage() {
  return render(
    <MemoryRouter>
      <AccountsPage />
    </MemoryRouter>,
  )
}

async function flushMutation() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('AccountsPage', () => {
  beforeEach(() => {
    state.accounts = { data: [], isLoading: false, isError: false }
    state.msi = { data: [], isLoading: false, isError: false }
    state.categories = { data: [], isLoading: false, isError: false }
    state.invalidate.mockReset()
    state.reset.mockReset()
    state.payloads.length = 0
    vi.mocked(api.createAccount).mockReset()
    vi.mocked(api.updateAccount).mockReset()
    vi.mocked(api.deleteAccount).mockReset()
    vi.mocked(api.createMSIPurchase).mockReset()
  })

  it('shows loading until both account and MSI queries settle', () => {
    state.msi.isLoading = true

    renderPage()

    expect(screen.getByRole('heading', { name: 'Cuentas' })).toBeInTheDocument()
    expect(screen.getByText('Cargando…')).toBeInTheDocument()
    expect(screen.queryByText('Sin cuentas registradas')).not.toBeInTheDocument()
  })

  it.each(['accounts', 'msi'] as const)(
    'announces a %s query error without rendering false empty data',
    (query) => {
      state[query].isError = true

      renderPage()

      expect(screen.getByRole('alert')).toHaveTextContent('No se pudieron cargar las cuentas')
      expect(screen.queryByText('Sin cuentas registradas')).not.toBeInTheDocument()
      expect(screen.queryByText('Patrimonio estimado')).not.toBeInTheDocument()
    },
  )

  it('creates the first account from the empty-state header action', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(screen.getByText('Sin cuentas registradas')).toBeInTheDocument()
    expect(
      screen.getByText('Agrega tarjetas de débito o crédito para empezar.'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Agregar cuenta' }))
    expect(screen.getByRole('textbox', { name: 'Nombre' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Saldo inicial' })).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: 'Nombre' }), 'Primera cuenta')
    await user.type(screen.getByRole('textbox', { name: 'Saldo inicial' }), '75.50')
    await user.click(screen.getByRole('button', { name: 'Agregar' }))
    await flushMutation()

    expect(api.createAccount).toHaveBeenCalledWith({
      name: 'Primera cuenta',
      type: 'debit',
      institution: 'Banco',
      last4: '0000',
      currency: 'MXN',
      balance: 7_550,
    })
  })

  it('registers an MSI purchase on a credit card and invalidates affected summaries', async () => {
    state.accounts.data = [credit()]
    state.categories.data = [expenseCategory()]
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Registrar MSI' }))
    const dialog = screen.getByRole('dialog', { name: 'Registrar compra a MSI' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Descripción' }), 'Laptop')
    await user.type(within(dialog).getByRole('textbox', { name: 'Comercio' }), 'Apple Store')
    await user.type(within(dialog).getByRole('textbox', { name: 'Monto total' }), '12000')
    await user.clear(within(dialog).getByRole('spinbutton', { name: 'Meses' }))
    await user.type(within(dialog).getByRole('spinbutton', { name: 'Meses' }), '12')
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Categoría' }),
      'cat-tech',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Programar 12 mensualidades' }))
    await flushMutation()

    expect(api.createMSIPurchase).toHaveBeenCalledWith({
      accountId: 'credit-1',
      categoryId: 'cat-tech',
      description: 'Laptop',
      merchant: 'Apple Store',
      totalAmount: 1_200_000,
      installmentCount: 12,
      startDate: expect.any(String),
    })
    expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ['msi'] })
    expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ['transactions'] })
    expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard'] })
  })

  it('renders negative net worth, debit share, credit health, and active MSI details', () => {
    state.accounts.data = [debit(), credit()]
    state.msi.data = [msi(), msi({ id: 'done', status: 'completed', installmentAmount: 9_999 })]

    renderPage()

    expect(screen.getByText('Negativo')).toBeInTheDocument()
    expect(screen.getByText('-$500.00')).toBeInTheDocument()
    expect(screen.getByText('100% del total')).toBeInTheDocument()
    expect(screen.getByText('Alto')).toBeInTheDocument()
    expect(screen.getByText('80% usado')).toBeInTheDocument()
    expect(screen.getByText('Corte')).toHaveTextContent('12')
    expect(screen.getByText('Pago')).toHaveTextContent('28')
    expect(screen.getByText('Laptop')).toBeInTheDocument()
    expect(screen.getAllByText('$20.00/mes')).toHaveLength(2)
    expect(screen.getByText('Carga mensual total').nextElementSibling).toHaveTextContent(
      '$20.00/mes',
    )
    expect(screen.getByText('Compras a MSI').nextElementSibling).toHaveTextContent('1')
    expect(screen.getByText('Uso global').parentElement).toHaveTextContent('80%')
    expect(
      screen.getByRole('progressbar', { name: 'Uso de crédito de Tarjeta Oro' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('progressbar', { name: 'Cuotas pagadas de Laptop' }),
    ).toBeInTheDocument()
  })

  it('treats zero net worth as non-negative and applies credit utilization boundaries', () => {
    state.accounts.data = [
      debit({ balance: 70_000 }),
      credit({ id: 'moderate', name: 'Moderada', availableCredit: 50_000 }),
      credit({ id: 'healthy', name: 'Saludable card', availableCredit: 80_000 }),
    ]

    renderPage()

    expect(screen.getByText('Positivo')).toBeInTheDocument()
    expect(screen.getByText('$0.00')).toBeInTheDocument()
    expect(screen.getByText('Moderado')).toBeInTheDocument()
    expect(screen.getByText('Saludable')).toBeInTheDocument()
    expect(screen.getByText('50% usado')).toBeInTheDocument()
    expect(screen.getByText('20% usado')).toBeInTheDocument()
    expect(screen.getByText('Uso global').parentElement).toHaveTextContent('35%')
  })

  it('handles zero credit limits and MSI rows without optional merchant or payment date', () => {
    state.accounts.data = [
      debit({ balance: 0 }),
      credit({
        creditLimit: 0,
        availableCredit: 0,
        statementCutDay: undefined,
        paymentDueDay: undefined,
      }),
      credit({
        id: 'credit-without-limit',
        name: 'Sin límite configurado',
        creditLimit: undefined,
        availableCredit: undefined,
        statementCutDay: undefined,
        paymentDueDay: undefined,
      }),
    ]
    state.msi.data = [
      msi({
        description: 'Curso',
        merchant: undefined,
        installmentCount: 4,
        installmentsPaid: 4,
        nextInstallmentDate: undefined,
      }),
    ]
    renderPage()

    expect(screen.getByText('Positivo')).toBeInTheDocument()
    expect(screen.getByText('0% del total')).toBeInTheDocument()
    expect(screen.getAllByText('Saludable')).toHaveLength(2)
    expect(screen.getAllByText('0% usado')).toHaveLength(2)
    expect(screen.getByText('Uso global').parentElement).toHaveTextContent('0%')
    expect(screen.getByText('Curso')).toBeInTheDocument()
    expect(screen.getByText('4/4')).toBeInTheDocument()
    expect(screen.queryByText(/restan/)).not.toBeInTheDocument()
    expect(screen.queryByText('Corte')).not.toBeInTheDocument()
    expect(screen.queryByText('Pago')).not.toBeInTheDocument()
  })

  it('creates debit and credit accounts with normalized payloads and invalidates summaries', async () => {
    state.accounts.data = [debit()]
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Agregar cuenta' }))
    await user.click(screen.getByRole('button', { name: 'Agregar' }))
    expect(state.payloads).toHaveLength(0)
    await user.type(screen.getByRole('textbox', { name: 'Nombre' }), '  Ahorro  ')
    await user.type(screen.getByRole('textbox', { name: 'Institución' }), '  Santander  ')
    await user.type(screen.getByRole('textbox', { name: 'Saldo inicial' }), '123.45')
    await user.type(screen.getByRole('textbox', { name: 'Últimos 4' }), '9876')
    await user.click(screen.getByRole('button', { name: 'Agregar' }))
    await flushMutation()

    expect(state.payloads[0]).toEqual({
      name: 'Ahorro',
      type: 'debit',
      institution: 'Santander',
      last4: '9876',
      currency: 'MXN',
      balance: 12_345,
    })

    await user.click(screen.getByRole('button', { name: 'Agregar cuenta' }))
    await user.type(screen.getByRole('textbox', { name: 'Nombre' }), 'Crédito')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Tipo' }), 'credit')
    await user.type(screen.getByRole('textbox', { name: 'Límite de crédito' }), '5000')
    await user.click(screen.getByRole('button', { name: 'Agregar' }))
    await flushMutation()

    expect(state.payloads[1]).toEqual({
      name: 'Crédito',
      type: 'credit',
      institution: 'Banco',
      last4: '0000',
      currency: 'MXN',
      creditLimit: 500_000,
      availableCredit: 500_000,
    })
    expect(state.invalidate).toHaveBeenCalledTimes(4)
    expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ['accounts'] })
    expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard'] })
    expect(api.createAccount).toHaveBeenCalledTimes(2)
  })

  it('keeps account panel open and announces API rejection without invalidating', async () => {
    vi.mocked(api.createAccount).mockRejectedValueOnce(new Error('offline'))
    state.accounts.data = [debit()]
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Agregar cuenta' }))
    const name = screen.getByRole('textbox', { name: 'Nombre' })
    await user.type(name, 'Cuenta fallida')
    await user.type(screen.getByRole('textbox', { name: 'Saldo inicial' }), '100')
    await user.click(screen.getByRole('button', { name: 'Agregar' }))
    await flushMutation()

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo crear la cuenta')
    expect(screen.getByRole('heading', { name: 'Agregar cuenta' })).toBeInTheDocument()
    expect(name).toHaveValue('Cuenta fallida')
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAccessibleDescription('No se pudo crear la cuenta. Intenta de nuevo.')
    expect(state.invalidate).not.toHaveBeenCalled()

    await user.type(name, ' editada')
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo crear la cuenta')

    await user.click(screen.getByRole('button', { name: 'Cerrar' }))
    await user.click(screen.getByRole('button', { name: 'Agregar cuenta' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('edits a debit account through the real API mutation without changing its type', async () => {
    state.accounts.data = [debit()]
    vi.mocked(api.updateAccount).mockResolvedValue()
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Editar Nómina' }))
    const dialog = screen.getByRole('dialog', { name: 'Editar cuenta' })
    expect(within(dialog).getByRole('combobox', { name: 'Tipo' })).toBeDisabled()
    expect(within(dialog).getByRole('textbox', { name: 'Saldo inicial' })).toHaveValue('300.00')
    await user.clear(within(dialog).getByRole('textbox', { name: 'Nombre' }))
    await user.type(within(dialog).getByRole('textbox', { name: 'Nombre' }), 'Nómina principal')
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }))
    await flushMutation()

    expect(api.updateAccount).toHaveBeenCalledWith('debit-1', {
      name: 'Nómina principal',
      institution: 'BBVA',
      last4: '1111',
      balance: 30_000,
    })
    expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ['accounts'] })
    expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard'] })
  })

  it('confirms and deletes an account through the real API mutation', async () => {
    state.accounts.data = [debit()]
    vi.mocked(api.deleteAccount).mockResolvedValue()
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Eliminar Nómina' }))
    const dialog = screen.getByRole('dialog', { name: 'Eliminar cuenta' })
    expect(dialog).toHaveTextContent('¿Eliminar “Nómina”?')
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar cuenta' }))
    await flushMutation()

    expect(api.deleteAccount).toHaveBeenCalledWith('debit-1')
    expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ['accounts'] })
    expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard'] })
  })

  it('resets the account mutation before retrying a failed create', async () => {
    vi.mocked(api.createAccount).mockRejectedValue(new Error('offline'))
    state.accounts.data = [debit()]
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Agregar cuenta' }))
    await user.type(screen.getByRole('textbox', { name: 'Nombre' }), 'Cuenta fallida')
    await user.click(screen.getByRole('button', { name: 'Agregar' }))
    await flushMutation()
    const resetCount = state.reset.mock.calls.length

    await user.click(screen.getByRole('button', { name: 'Agregar' }))

    expect(state.reset).toHaveBeenCalledTimes(resetCount + 1)
  })
})
