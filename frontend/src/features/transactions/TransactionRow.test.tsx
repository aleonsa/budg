import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Account, Category, Transaction } from '@/types'
import { DayGroupHeader, TransactionRow } from './TransactionRow'

const account: Account = {
  id: 'checking',
  name: 'Cuenta Nómina',
  type: 'debit',
  institution: 'Banco Uno',
  last4: '1234',
  currency: 'MXN',
  isActive: true,
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
    isReconciled: false,
    createdAt: '2026-07-18',
    ...overrides,
  }
}

describe('TransactionRow', () => {
  it('shows expense context, status, and handles row selection', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <TransactionRow
        transaction={transaction({ msiPurchaseId: 'msi-1' })}
        category={category}
        account={account}
        showAccount
        onClick={onClick}
      />,
    )

    expect(screen.getByText('Supermercado')).toBeInTheDocument()
    expect(screen.getByText('Cuenta Nómina')).toBeInTheDocument()
    expect(screen.getByText(/Mercado Central/)).toBeInTheDocument()
    expect(screen.getByText('MSI')).toBeInTheDocument()
    expect(screen.getByText('−$123.45')).toBeInTheDocument()
    expect(screen.getByText('pendiente')).toBeInTheDocument()

    await user.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('shows income as a positive reconciled amount', () => {
    render(<TransactionRow transaction={transaction({ type: 'income', isReconciled: true })} />)

    expect(screen.getByText('+$123.45')).toBeInTheDocument()
    expect(screen.queryByText('pendiente')).not.toBeInTheDocument()
  })

  it('shows a transfer as money leaving its source account', () => {
    render(<TransactionRow transaction={transaction({ type: 'transfer', isReconciled: true })} />)

    expect(screen.getByText('−$123.45')).toBeInTheDocument()
    expect(screen.queryByText('+$123.45')).not.toBeInTheDocument()
  })
})

describe('DayGroupHeader', () => {
  it('shows the day and positive net total', () => {
    render(<DayGroupHeader date="2026-07-18" totalSpent={5000} totalIncome={12000} />)

    expect(screen.getByText(/sáb/i)).toBeInTheDocument()
    expect(screen.getByText('+$70.00')).toBeInTheDocument()
  })

  it('shows a negative net total and omits a zero total', () => {
    const { rerender } = render(
      <DayGroupHeader date="2026-07-18" totalSpent={12000} totalIncome={5000} />,
    )
    expect(screen.getByText('−$70.00')).toBeInTheDocument()

    rerender(<DayGroupHeader date="2026-07-18" totalSpent={5000} totalIncome={5000} />)
    expect(screen.queryByText(/[+−]\$70\.00/)).not.toBeInTheDocument()
  })
})
