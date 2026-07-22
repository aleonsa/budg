import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { useTransactionFilters } from '@/stores/transactionFilters'
import type { Account, Category } from '@/types'
import { FilterBar } from './FilterBar'

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
    id: 'credit',
    name: 'Tarjeta Viajes',
    type: 'credit',
    institution: 'Banco Dos',
    last4: '5678',
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

function resetFilters() {
  useTransactionFilters.setState({
    search: '',
    type: 'all',
    accountId: null,
    categoryId: null,
    month: '2026-07',
  })
}

afterEach(resetFilters)

describe('FilterBar', () => {
  it('updates and clears search, and changes transaction type', async () => {
    resetFilters()
    const user = userEvent.setup()
    render(<FilterBar categories={categories} accounts={accounts} />)

    const search = screen.getByRole('textbox', { name: 'Buscar movimientos' })
    await user.type(search, 'mercado')
    expect(useTransactionFilters.getState().search).toBe('mercado')

    await user.click(screen.getByRole('button', { name: 'Limpiar búsqueda' }))
    expect(search).toHaveValue('')

    await user.click(screen.getByRole('button', { name: 'Ingresos' }))
    expect(useTransactionFilters.getState().type).toBe('income')
  })

  it('filters by account from the visible account selector', async () => {
    resetFilters()
    const user = userEvent.setup()
    render(<FilterBar categories={categories} accounts={accounts} />)

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filtrar por cuenta' }), 'credit')
    expect(useTransactionFilters.getState().accountId).toBe('credit')

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filtrar por cuenta' }), '')
    expect(useTransactionFilters.getState().accountId).toBeNull()
  })

  it('navigates months across year boundaries', async () => {
    useTransactionFilters.setState({ month: '2026-01' })
    const user = userEvent.setup()
    render(<FilterBar categories={categories} accounts={accounts} />)

    expect(screen.getByText(/enero de 2026/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Mes anterior' }))
    expect(useTransactionFilters.getState().month).toBe('2025-12')

    await user.click(screen.getByRole('button', { name: 'Mes siguiente' }))
    expect(useTransactionFilters.getState().month).toBe('2026-01')
  })

  it('selects account and expense-category filters, then clears their chips', async () => {
    resetFilters()
    const user = userEvent.setup()
    render(<FilterBar categories={categories} accounts={accounts} />)

    await user.click(screen.getByRole('button', { name: 'Abrir filtros' }))

    expect(screen.getByText('Filtros')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Todas las cuentas' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Todas las categorías' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nómina' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cuenta Nómina · 1234' }))
    await user.click(screen.getByRole('button', { name: 'Alimentos' }))
    expect(useTransactionFilters.getState()).toMatchObject({
      accountId: 'checking',
      categoryId: 'food',
    })

    await user.click(screen.getByRole('button', { name: 'Cerrar' }))
    await user.click(screen.getByRole('button', { name: 'Quitar filtro Cuenta Nómina' }))
    expect(useTransactionFilters.getState().accountId).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Quitar filtro Alimentos' }))
    expect(useTransactionFilters.getState().categoryId).toBeNull()
  })

  it('clears all advanced filters together', async () => {
    useTransactionFilters.setState({ accountId: 'credit', categoryId: 'food' })
    const user = userEvent.setup()
    render(<FilterBar categories={categories} accounts={accounts} />)

    await user.click(screen.getByRole('button', { name: 'Abrir filtros' }))
    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }))

    expect(useTransactionFilters.getState()).toMatchObject({
      accountId: null,
      categoryId: null,
    })
    expect(screen.queryByRole('button', { name: 'Limpiar filtros' })).not.toBeInTheDocument()
  })
})
