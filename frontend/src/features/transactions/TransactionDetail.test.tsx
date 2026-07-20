import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Account, Category, Transaction } from '@/types'
import { TransactionDetail } from './TransactionDetail'

const account: Account = {
  id: 'checking',
  name: 'Cuenta Nómina',
  type: 'debit',
  institution: 'Banco Uno',
  last4: '1234',
  currency: 'MXN',
  isActive: true,
}

const transferAccount: Account = {
  ...account,
  id: 'savings',
  name: 'Cuenta Ahorro',
  last4: '9876',
}

const category: Category = {
  id: 'food',
  name: 'Alimentos',
  kind: 'expense',
  color: 'orange',
  icon: 'ShoppingCart',
  parentId: null,
  isSystem: true,
  order: 1,
}

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    accountId: 'checking',
    type: 'expense',
    amount: 12345,
    categoryId: 'food',
    date: '2026-07-18',
    description: 'Supermercado',
    merchant: 'Mercado Central',
    msiPurchaseId: 'msi-1',
    isReconciled: false,
    createdAt: '2026-07-19',
    ...overrides,
  }
}

describe('TransactionDetail', () => {
  it('renders nothing without a selected transaction', () => {
    const { container } = render(<TransactionDetail transaction={null} onClose={vi.fn()} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('shows expense semantics and forwards edit, delete, and close actions', async () => {
    const tx = transaction()
    const onClose = vi.fn()
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    const user = userEvent.setup()
    render(
      <TransactionDetail
        transaction={tx}
        category={category}
        account={account}
        onClose={onClose}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    )

    expect(screen.getByText('Supermercado')).toBeInTheDocument()
    expect(screen.getByText('−$123.45')).toBeInTheDocument()
    expect(screen.getByText('Gasto')).toBeInTheDocument()
    expect(screen.getByText('MSI')).toBeInTheDocument()
    expect(screen.getByText('Pendiente')).toBeInTheDocument()
    expect(screen.getByText('Cuenta Nómina')).toBeInTheDocument()
    expect(screen.getByText('Alimentos')).toBeInTheDocument()
    expect(screen.getByText('Mercado Central')).toBeInTheDocument()
    expect(screen.getByText(/Creado el 19 jul 2026/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Editar' }))
    await user.click(screen.getByRole('button', { name: 'Eliminar' }))
    await user.keyboard('{Escape}')
    expect(onEdit).toHaveBeenCalledWith(tx)
    expect(onDelete).toHaveBeenCalledWith(tx)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows transfer destination and transfer status', () => {
    render(
      <TransactionDetail
        transaction={transaction({
          type: 'transfer',
          categoryId: null,
          merchant: undefined,
          msiPurchaseId: undefined,
          isReconciled: true,
          transferToAccountId: 'savings',
        })}
        account={account}
        transferAccount={transferAccount}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('−$123.45')).toBeInTheDocument()
    expect(screen.queryByText('+$123.45')).not.toBeInTheDocument()
    expect(screen.getByText('Transferencia')).toBeInTheDocument()
    expect(screen.getByText('Hacia')).toBeInTheDocument()
    expect(screen.getByText('Cuenta Ahorro')).toBeInTheDocument()
    expect(screen.queryByText('Pendiente')).not.toBeInTheDocument()
  })

  it('shows income status and omits unavailable optional rows and actions', () => {
    render(
      <TransactionDetail
        transaction={transaction({
          type: 'income',
          categoryId: null,
          merchant: undefined,
          msiPurchaseId: undefined,
          isReconciled: true,
        })}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Ingreso')).toBeInTheDocument()
    expect(screen.getByText('+$123.45')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText('Categoría')).not.toBeInTheDocument()
    expect(screen.queryByText('Establecimiento')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Eliminar' })).not.toBeInTheDocument()
  })
})
