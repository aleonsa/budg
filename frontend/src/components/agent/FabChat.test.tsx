import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAgentStore } from '@/stores/agent'
import { queryKeys } from '@/lib/query-keys'
import { FabChat } from './FabChat'

describe('FabChat', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    useAgentStore.getState().reset()
    useAgentStore.getState().setOpen(true)
  })

  function renderWithProviders() {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <FabChat />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('opens an accessible, enlarged desktop panel with prompt suggestions', () => {
    renderWithProviders()

    const dialog = screen.getByRole('dialog', { name: 'Asistente budg' })
    expect(dialog).toHaveClass('sm:w-[30rem]', 'sm:h-[42.5rem]')
    expect(screen.getByRole('log')).toHaveAttribute('aria-busy', 'false')
    expect(screen.getByRole('button', { name: '¿En qué gasté más este mes?' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Mensaje' })).toBeInTheDocument()
  })

  it('closes from the mobile header control', async () => {
    const user = userEvent.setup()
    renderWithProviders()

    await user.click(screen.getAllByRole('button', { name: 'Cerrar asistente budg' })[0])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('invalidates React Query caches when agent executes a confirmed mutation', () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    renderWithProviders()

    expect(invalidateSpy).not.toHaveBeenCalled()

    act(() => {
      useAgentStore.setState({ mutationExecutionCount: 1 })
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.transactions })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.dashboard })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.accounts })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.budgets })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.savingsGoals })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.savingsOverview })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.recurringTransactions })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.msiPurchases })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.yieldReconciliations })
  })
})
