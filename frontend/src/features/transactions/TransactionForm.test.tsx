import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Account, Category, Transaction } from '@/types'
import { TransactionForm } from './TransactionForm'

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

describe('TransactionForm', () => {
  it('normalizes and submits an expense payload', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <TransactionForm
        accounts={accounts}
        categories={categories}
        lockedType="expense"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    )

    await user.type(screen.getByRole('textbox', { name: 'Monto' }), '$1,234.565')
    await user.clear(screen.getByLabelText('Fecha'))
    await user.type(screen.getByLabelText('Fecha'), '2026-07-18')
    await user.type(screen.getByRole('textbox', { name: 'Descripción' }), '  Despensa  ')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Cuenta' }), 'savings')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Categoría' }), 'food')
    await user.type(
      screen.getByRole('textbox', { name: 'Comercio (opcional)' }),
      '  Mercado Central  ',
    )
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(onSubmit).toHaveBeenCalledWith({
      type: 'expense',
      amount: 123457,
      date: '2026-07-18',
      description: 'Despensa',
      accountId: 'savings',
      categoryId: 'food',
      merchant: 'Mercado Central',
      transferToAccountId: null,
    })
  })

  it('switches category choices and submits income', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <TransactionForm
        accounts={accounts}
        categories={categories}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Ingreso' }))
    expect(screen.getByRole('option', { name: 'Nómina' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Alimentos' })).not.toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: 'Monto' }), '2500')
    await user.type(screen.getByRole('textbox', { name: 'Descripción' }), 'Pago mensual')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Categoría' }), 'salary')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'income',
        amount: 250000,
        description: 'Pago mensual',
        categoryId: 'salary',
        merchant: undefined,
      }),
    )
  })

  it('requires a distinct destination and submits a normalized transfer', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <TransactionForm
        accounts={accounts}
        categories={categories}
        lockedType="transfer"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    )

    await user.type(screen.getByRole('textbox', { name: 'Monto' }), '400.00')
    await user.type(screen.getByRole('textbox', { name: 'Descripción' }), '  Fondo de emergencia  ')
    const destination = screen.getByRole('combobox', { name: 'Destino' })

    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Selecciona una cuenta de destino.')

    await user.selectOptions(destination, 'checking')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('La cuenta de destino debe ser distinta.')

    await user.selectOptions(destination, 'savings')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'transfer',
        amount: 40000,
        description: 'Fondo de emergencia',
        accountId: 'checking',
        categoryId: null,
        merchant: undefined,
        transferToAccountId: 'savings',
      }),
    )
  })

  it('shows accessible validation errors and submits after correction', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <TransactionForm
        accounts={accounts}
        categories={categories}
        lockedType="expense"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    )

    const amount = screen.getByRole('textbox', { name: 'Monto' })
    const date = screen.getByLabelText('Fecha')
    await user.type(amount, 'not-money')
    await user.clear(date)
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('Ingresa un monto mayor a cero.')).toHaveAttribute('role', 'alert')
    expect(screen.getByText('Ingresa una descripción.')).toHaveAttribute('role', 'alert')
    expect(screen.getByText('Selecciona una fecha.')).toHaveAttribute('role', 'alert')
    expect(amount).toHaveAttribute('aria-invalid', 'true')

    await user.clear(amount)
    await user.type(amount, '10.50')
    await user.type(date, '2026-07-20')
    await user.type(screen.getByRole('textbox', { name: 'Descripción' }), 'Compra')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(amount).toHaveAttribute('aria-invalid', 'false')
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ amount: 1050 }))
  })

  it('seeds edit values and submits changes with the original type', async () => {
    const initial: Transaction = {
      id: 'salary-tx',
      accountId: 'checking',
      type: 'income',
      amount: 200000,
      categoryId: 'salary',
      date: '2026-07-01',
      description: 'Nómina anterior',
      merchant: 'Empresa',
      isReconciled: true,
      createdAt: '2026-07-01',
    }
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    render(
      <TransactionForm
        accounts={accounts}
        categories={categories}
        initial={initial}
        onSubmit={onSubmit}
        onCancel={onCancel}
        submitLabel="Guardar cambios"
      />,
    )

    expect(screen.getByRole('textbox', { name: 'Monto' })).toHaveValue('2000.00')
    expect(screen.getByRole('textbox', { name: 'Descripción' })).toHaveValue('Nómina anterior')
    expect(screen.getByRole('option', { name: 'Nómina' })).toBeInTheDocument()

    await user.clear(screen.getByRole('textbox', { name: 'Descripción' }))
    await user.type(screen.getByRole('textbox', { name: 'Descripción' }), 'Nómina corregida')
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'income',
        amount: 200000,
        date: '2026-07-01',
        description: 'Nómina corregida',
        categoryId: 'salary',
        merchant: 'Empresa',
      }),
    )

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
