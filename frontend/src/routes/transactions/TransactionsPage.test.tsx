import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTransactionFilters } from '@/stores/transactionFilters'
import type { Account, Category, Transaction } from '@/types'

const mocks = vi.hoisted(() => ({
  useTransactions: vi.fn(),
  useCategories: vi.fn(),
  useAccounts: vi.fn(),
  createMutate: vi.fn(),
  updateMutate: vi.fn(),
  deleteMutate: vi.fn(),
  createReset: vi.fn(),
  updateReset: vi.fn(),
  deleteReset: vi.fn(),
  createState: { isPending: false, error: null as Error | null },
  updateState: { isPending: false, error: null as Error | null },
  deleteState: { isPending: false, error: null as Error | null },
}))

vi.mock('@/hooks/useQueries', () => ({
  useTransactions: mocks.useTransactions,
  useCategories: mocks.useCategories,
  useAccounts: mocks.useAccounts,
}))

vi.mock('@/hooks/useTransactionMutations', () => ({
  useCreateTransaction: () => ({
    ...mocks.createState,
    mutate: mocks.createMutate,
    reset: mocks.createReset,
  }),
  useUpdateTransaction: () => ({
    ...mocks.updateState,
    mutate: mocks.updateMutate,
    reset: mocks.updateReset,
  }),
  useDeleteTransaction: () => ({
    ...mocks.deleteState,
    mutate: mocks.deleteMutate,
    reset: mocks.deleteReset,
  }),
}))

import TransactionsPage from './TransactionsPage'

const accounts: Account[] = [
  {
    id: 'checking',
    name: 'Cuenta Nómina',
    type: 'debit',
    institution: 'Banco Uno',
    last4: '1234',
    currency: 'MXN',
    isActive: true,
  },
  {
    id: 'savings',
    name: 'Cuenta Ahorro',
    type: 'debit',
    institution: 'Banco Uno',
    last4: '9876',
    currency: 'MXN',
    isActive: true,
  },
]

const categories: Category[] = [
  {
    id: 'food',
    name: 'Alimentos',
    kind: 'expense',
    color: 'orange',
    icon: 'ShoppingCart',
    parentId: null,
    isSystem: true,
    order: 1,
  },
  {
    id: 'salary',
    name: 'Nómina',
    kind: 'income',
    color: 'green',
    icon: 'Briefcase',
    parentId: null,
    isSystem: true,
    order: 2,
  },
]

const transactions: Transaction[] = [
  {
    id: 'expense-1',
    accountId: 'checking',
    type: 'expense',
    amount: 12345,
    categoryId: 'food',
    date: '2026-07-18',
    description: 'Supermercado',
    merchant: 'Mercado Central',
    isReconciled: false,
    createdAt: '2026-07-18',
  },
  {
    id: 'income-1',
    accountId: 'checking',
    type: 'income',
    amount: 250000,
    categoryId: 'salary',
    date: '2026-07-01',
    description: 'Nómina mensual',
    isReconciled: true,
    createdAt: '2026-07-01',
  },
]

function loadedQueries(items: Transaction[] = transactions) {
  mocks.useTransactions.mockReturnValue({ isLoading: false, data: items })
  mocks.useCategories.mockReturnValue({ isLoading: false, data: categories })
  mocks.useAccounts.mockReturnValue({ isLoading: false, data: accounts })
}

function page() {
  return (
    <MemoryRouter>
      <TransactionsPage />
    </MemoryRouter>
  )
}

function renderPage() {
  return render(page())
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(mocks.createState, { isPending: false, error: null })
  Object.assign(mocks.updateState, { isPending: false, error: null })
  Object.assign(mocks.deleteState, { isPending: false, error: null })
  mocks.createReset.mockImplementation(() => {
    mocks.createState.error = null
  })
  mocks.updateReset.mockImplementation(() => {
    mocks.updateState.error = null
  })
  mocks.deleteReset.mockImplementation(() => {
    mocks.deleteState.error = null
  })
  loadedQueries()
  useTransactionFilters.setState({
    search: '',
    type: 'all',
    accountId: null,
    categoryId: null,
    month: '2026-07',
  })
})

describe('TransactionsPage', () => {
  it('shows loading until every transaction dependency is ready', () => {
    mocks.useCategories.mockReturnValue({ isLoading: true, data: undefined })

    renderPage()

    expect(screen.getByText('Cargando…')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Buscar…')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agregar' })).toBeInTheDocument()
  })

  it('shows an accessible error when a transaction dependency fails', () => {
    mocks.useTransactions.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error('Sin conexión'),
      data: undefined,
    })

    renderPage()

    expect(screen.getByRole('alert')).toHaveTextContent(
      'No se pudieron cargar los movimientos. Intenta de nuevo más tarde.',
    )
    expect(screen.queryByPlaceholderText('Buscar…')).not.toBeInTheDocument()
  })

  it('shows empty state and opens and closes its add modal', async () => {
    loadedQueries([])
    const user = userEvent.setup()
    renderPage()

    expect(screen.getByText('Sin movimientos')).toBeInTheDocument()
    expect(
      screen.getByText('No hay transacciones que coincidan con los filtros.'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Agregar movimiento' }))
    const dialog = screen.getByRole('dialog', { name: 'Agregar movimiento' })
    expect(within(dialog).getByText('Captura rápida de movimiento.')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog', { name: 'Agregar movimiento' })).not.toBeInTheDocument()
  })

  it('lets the generic add button switch between expense, income, and transfer', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Agregar' }))
    const dialog = screen.getByRole('dialog', { name: 'Agregar movimiento' })

    // Type toggle is visible (not locked) and defaults to "Gasto".
    expect(within(dialog).getByRole('button', { name: 'Gasto' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(dialog).getByRole('combobox', { name: 'Categoría' })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Ingreso' }))
    expect(within(dialog).getByRole('button', { name: 'Ingreso' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(dialog).getByRole('combobox', { name: 'Categoría' })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Transfer' }))
    expect(within(dialog).getByRole('button', { name: 'Transfer' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(dialog).getByRole('combobox', { name: 'Destino' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('combobox', { name: 'Categoría' })).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText('Comercio (opcional)')).not.toBeInTheDocument()
  })

  it('manages focus, keyboard dismissal, and scroll lock for the transaction modal', async () => {
    const user = userEvent.setup()
    renderPage()
    const trigger = screen.getByRole('button', { name: 'Agregar' })

    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Agregar movimiento' })
    const close = within(dialog).getByRole('button', { name: 'Cerrar' })
    const submit = within(dialog).getByRole('button', { name: 'Agregar' })

    expect(close).toHaveFocus()
    expect(document.body).toHaveStyle({ overflow: 'hidden' })

    await user.tab({ shift: true })
    expect(submit).toHaveFocus()
    await user.tab()
    expect(close).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Agregar movimiento' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(document.body).not.toHaveStyle({ overflow: 'hidden' })
  })

  it('ignores Escape and backdrop dismissal while transaction creation is pending', async () => {
    mocks.createState.isPending = true
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Agregar' }))
    const dialog = screen.getByRole('dialog', { name: 'Agregar movimiento' })

    await user.keyboard('{Escape}')
    await user.click(dialog.parentElement!)

    expect(dialog).toBeInTheDocument()
  })

  it('renders grouped populated results and their filtered summary', () => {
    renderPage()

    expect(screen.getByText('2 movimientos')).toBeInTheDocument()
    expect(screen.getAllByText('−$123.45')).toHaveLength(3)
    expect(screen.getAllByText('+$2,500.00')).toHaveLength(3)
    expect(screen.getByText('Supermercado')).toBeInTheDocument()
    expect(screen.getByText('Nómina mensual')).toBeInTheDocument()
    expect(screen.getAllByText('Cuenta Nómina')).toHaveLength(2)
  })

  it('creates an expense and closes the modal after success', async () => {
    mocks.createMutate.mockImplementation((_value: unknown, options?: { onSuccess?: () => void }) =>
      options?.onSuccess?.(),
    )
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Agregar' }))
    const dialog = screen.getByRole('dialog', { name: 'Agregar movimiento' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Monto' }), '25.50')
    await user.clear(within(dialog).getByLabelText('Fecha'))
    await user.type(within(dialog).getByLabelText('Fecha'), '2026-07-20')
    await user.type(within(dialog).getByRole('textbox', { name: 'Descripción' }), '  Almuerzo  ')
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Categoría' }), 'food')
    await user.click(within(dialog).getByRole('button', { name: 'Agregar' }))

    expect(mocks.createMutate).toHaveBeenCalledWith(
      {
        type: 'expense',
        amount: 2550,
        date: '2026-07-20',
        description: 'Almuerzo',
        accountId: 'checking',
        categoryId: 'food',
        merchant: undefined,
        transferToAccountId: undefined,
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
    expect(mocks.createReset).toHaveBeenCalledTimes(3)
    expect(mocks.createReset.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.createMutate.mock.invocationCallOrder[0],
    )
    expect(screen.queryByText('Agregar movimiento')).not.toBeInTheDocument()
  })

  it('opens detail, edits seeded data, and closes after update success', async () => {
    mocks.updateMutate.mockImplementation((_value: unknown, options?: { onSuccess?: () => void }) =>
      options?.onSuccess?.(),
    )
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /Supermercado/ }))
    expect(screen.getByText('Gasto')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Editar' }))

    expect(screen.getByText('Editar movimiento')).toBeInTheDocument()
    const description = screen.getByRole('textbox', { name: 'Descripción' })
    expect(description).toHaveValue('Supermercado')
    await user.clear(description)
    await user.type(description, 'Supermercado corregido')
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(mocks.updateMutate).toHaveBeenCalledWith(
      {
        id: 'expense-1',
        patch: {
          type: 'expense',
          amount: 12345,
          date: '2026-07-18',
          description: 'Supermercado corregido',
          accountId: 'checking',
          categoryId: 'food',
          merchant: 'Mercado Central',
          transferToAccountId: undefined,
        },
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
    expect(mocks.updateReset).toHaveBeenCalledTimes(3)
    expect(mocks.updateReset.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.updateMutate.mock.invocationCallOrder[0],
    )
    expect(screen.queryByText('Editar movimiento')).not.toBeInTheDocument()
  })

  it('cancels deletion without mutating', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /Supermercado/ }))
    await user.click(screen.getByRole('button', { name: 'Eliminar' }))

    const confirmation = screen.getByRole('alertdialog', { name: 'Eliminar movimiento' })
    expect(within(confirmation).getByText(/Supermercado/)).toBeInTheDocument()
    expect(mocks.deleteMutate).not.toHaveBeenCalled()

    await user.click(within(confirmation).getByRole('button', { name: 'Cancelar' }))
    expect(mocks.deleteMutate).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('manages focus, keyboard dismissal, and backdrop dismissal for deletion', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /Supermercado/ }))
    await user.click(screen.getByRole('button', { name: 'Eliminar' }))
    const confirmation = screen.getByRole('alertdialog', { name: 'Eliminar movimiento' })
    const cancel = within(confirmation).getByRole('button', { name: 'Cancelar' })
    const confirm = within(confirmation).getByRole('button', { name: 'Eliminar movimiento' })

    expect(cancel).toHaveFocus()
    expect(document.body).toHaveStyle({ overflow: 'hidden' })
    await user.tab({ shift: true })
    expect(confirm).toHaveFocus()
    await user.tab()
    expect(cancel).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Eliminar' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Eliminar' }))
    const reopened = screen.getByRole('alertdialog', { name: 'Eliminar movimiento' })
    await user.click(reopened.parentElement!)

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Eliminar' })).toHaveFocus()
    expect(document.body).toHaveStyle({ overflow: 'hidden' })
    await user.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(document.body).not.toHaveStyle({ overflow: 'hidden' })
  })

  it('ignores Escape and backdrop dismissal while deletion is pending', async () => {
    mocks.deleteState.isPending = true
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /Supermercado/ }))
    await user.click(screen.getByRole('button', { name: 'Eliminar' }))
    const confirmation = screen.getByRole('alertdialog', { name: 'Eliminar movimiento' })

    await user.keyboard('{Escape}')
    await user.click(confirmation.parentElement!)

    expect(confirmation).toBeInTheDocument()
  })

  it('confirms deletion and closes confirmation after success', async () => {
    mocks.deleteMutate.mockImplementation((_id: string, options?: { onSuccess?: () => void }) =>
      options?.onSuccess?.(),
    )
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /Supermercado/ }))
    await user.click(screen.getByRole('button', { name: 'Eliminar' }))
    const confirmation = screen.getByRole('alertdialog', { name: 'Eliminar movimiento' })
    await user.click(within(confirmation).getByRole('button', { name: 'Eliminar movimiento' }))

    expect(mocks.deleteMutate).toHaveBeenCalledWith(
      'expense-1',
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
    expect(mocks.deleteReset).toHaveBeenCalledTimes(3)
    expect(mocks.deleteReset.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.deleteMutate.mock.invocationCallOrder[0],
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('disables form actions while create is pending', async () => {
    mocks.createState.isPending = true
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Agregar' }))
    const dialog = screen.getByRole('dialog', { name: 'Agregar movimiento' })

    expect(within(dialog).getByRole('button', { name: 'Guardando…' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toBeDisabled()
  })

  it('clears a create error after close and reopen', async () => {
    const user = userEvent.setup()
    const view = renderPage()

    await user.click(screen.getByRole('button', { name: 'Agregar' }))
    expect(mocks.createReset).toHaveBeenCalledTimes(1)

    mocks.createState.error = new Error('No se pudo guardar')
    view.rerender(page())
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo guardar')

    await user.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(mocks.createReset).toHaveBeenCalledTimes(2)
    await user.click(screen.getByRole('button', { name: 'Agregar' }))

    expect(mocks.createReset).toHaveBeenCalledTimes(3)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('clears an update error after cancel and reopen', async () => {
    const user = userEvent.setup()
    const view = renderPage()

    await user.click(screen.getByRole('button', { name: /Supermercado/ }))
    await user.click(screen.getByRole('button', { name: 'Editar' }))
    expect(mocks.updateReset).toHaveBeenCalledTimes(1)

    mocks.updateState.error = new Error('No se pudo actualizar')
    view.rerender(page())
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo actualizar')

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(mocks.updateReset).toHaveBeenCalledTimes(2)
    await user.click(screen.getByRole('button', { name: /Supermercado/ }))
    await user.click(screen.getByRole('button', { name: 'Editar' }))

    expect(mocks.updateReset).toHaveBeenCalledTimes(3)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('disables destructive actions while deletion is pending', async () => {
    mocks.deleteState.isPending = true
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /Supermercado/ }))
    await user.click(screen.getByRole('button', { name: 'Eliminar' }))
    const confirmation = screen.getByRole('alertdialog', { name: 'Eliminar movimiento' })

    expect(within(confirmation).getByRole('button', { name: 'Cancelar' })).toBeDisabled()
    expect(within(confirmation).getByRole('button', { name: 'Eliminando…' })).toBeDisabled()
  })

  it('clears a deletion error after cancel and reopen', async () => {
    const user = userEvent.setup()
    const view = renderPage()

    await user.click(screen.getByRole('button', { name: /Supermercado/ }))
    await user.click(screen.getByRole('button', { name: 'Eliminar' }))
    expect(mocks.deleteReset).toHaveBeenCalledTimes(1)

    mocks.deleteState.error = new Error('No se pudo eliminar')
    view.rerender(page())
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo eliminar')

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(mocks.deleteReset).toHaveBeenCalledTimes(2)
    await user.click(screen.getByRole('button', { name: /Supermercado/ }))
    await user.click(screen.getByRole('button', { name: 'Eliminar' }))

    expect(mocks.deleteReset).toHaveBeenCalledTimes(3)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
