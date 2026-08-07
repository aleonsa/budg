import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FabQuickAction } from './FabQuickAction'
import { useQuickActionStore } from '@/stores/quickAction'

vi.mock('@/hooks/useQueries', () => ({
  useAccounts: () => ({
    data: [
      {
        id: 'debit-1',
        name: 'BBVA Nómina',
        type: 'debit',
        institution: 'BBVA',
        last4: '1234',
        currency: 'MXN',
        balance: 10000,
        isActive: true,
      },
    ],
    isLoading: false,
  }),
  useCategories: () => ({
    data: [
      {
        id: 'cat-1',
        name: 'Comida',
        kind: 'expense',
        color: 'orange',
        icon: 'ShoppingCart',
        parentId: null,
        isSystem: true,
        order: 0,
      },
    ],
    isLoading: false,
  }),
}))

vi.mock('@/hooks/useTransactionMutations', () => ({
  useCreateTransaction: () => ({
    isPending: false,
    error: null,
    mutate: vi.fn(),
    reset: vi.fn(),
  }),
}))

vi.mock('@/hooks/useMSIPurchaseMutations', () => ({
  useCreateMSIPurchase: () => ({
    isPending: false,
    error: null,
    mutate: vi.fn(),
    reset: vi.fn(),
  }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ isPending: false, error: null, mutate: vi.fn(), reset: vi.fn() }),
}))

describe('FabQuickAction', () => {
  it('renders floating plus button and opens quick action modal on click', () => {
    useQuickActionStore.getState().closeQuickAction()
    render(<FabQuickAction />)

    const btn = screen.getByRole('button', { name: 'Nuevo movimiento' })
    expect(btn).toBeInTheDocument()

    fireEvent.click(btn)

    expect(screen.getByRole('heading', { name: 'Agregar movimiento' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Gasto' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ingreso' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Transfer' })).toBeInTheDocument()
  })
})
