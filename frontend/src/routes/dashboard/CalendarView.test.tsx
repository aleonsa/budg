import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CalendarView } from './CalendarView'
import type { Category, Transaction } from '@/types'

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
  date = '2026-02-10',
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

describe('CalendarView', () => {
  const categories = new Map<string, Category>([
    ['food', category('food', 'Comida', 'expense')],
    ['salary', category('salary', 'Salario', 'income')],
  ])

  it('renders month navigator, summary metrics, calendar grid, and day legend', () => {
    const txs: Transaction[] = [
      transaction('Groceries', 'expense', 20_589_36, 'food', '2026-02-08'),
      transaction('Salary', 'income', 22_076_69, 'salary', '2026-02-03'),
      transaction('Savings Transfer', 'transfer', 1_601_35, null, '2026-02-10'),
    ]

    render(
      <CalendarView
        transactions={txs}
        categories={categories}
        initialDate={new Date('2026-02-10')}
      />,
    )

    expect(screen.getByText('DOM')).toBeInTheDocument()
    expect(screen.getByText('LUN')).toBeInTheDocument()
    expect(screen.getByText('MAR')).toBeInTheDocument()
    expect(screen.getByText('MIÉ')).toBeInTheDocument()
    expect(screen.getByText('JUE')).toBeInTheDocument()
    expect(screen.getByText('VIE')).toBeInTheDocument()
    expect(screen.getByText('SÁB')).toBeInTheDocument()

    expect(screen.getAllByText('Gastos')).not.toHaveLength(0)
    expect(screen.getAllByText('Ingresos')).not.toHaveLength(0)
    expect(screen.getAllByText('Ahorro')).not.toHaveLength(0)
    expect(screen.getByText('Balance')).toBeInTheDocument()
    expect(screen.getByText('Prom. diario')).toBeInTheDocument()

    expect(screen.getByText('Mayor gasto')).toBeInTheDocument()
  })

  it('navigates to previous and next months', () => {
    render(<CalendarView transactions={[]} categories={categories} />)

    const prevBtn = screen.getByRole('button', { name: 'Mes anterior' })
    const nextBtn = screen.getByRole('button', { name: 'Mes siguiente' })

    expect(prevBtn).toBeInTheDocument()
    expect(nextBtn).toBeInTheDocument()

    fireEvent.click(prevBtn)
    fireEvent.click(nextBtn)
  })

  it('displays transactions for selected day and handles add transaction callback', () => {
    const onAdd = vi.fn()
    const txs: Transaction[] = [transaction('Dinner', 'expense', 500_00, 'food', '2026-02-15')]

    render(
      <CalendarView
        transactions={txs}
        categories={categories}
        initialDate={new Date('2026-02-15')}
        onAddTransactionForDate={onAdd}
      />,
    )

    // Find day button for 15
    const day15Btn = screen.getByRole('button', { name: /15/ })
    fireEvent.click(day15Btn)

    expect(screen.getByText('Dinner')).toBeInTheDocument()

    const addBtn = screen.getByRole('button', { name: 'Agregar' })
    fireEvent.click(addBtn)

    expect(onAdd).toHaveBeenCalledWith('2026-02-15')
  })
})
