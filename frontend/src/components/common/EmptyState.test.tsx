import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('explains the empty state and exposes its recovery action', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    render(
      <EmptyState
        title="No hay movimientos"
        description="Agrega tu primer movimiento."
        action={<button onClick={onCreate}>Agregar</button>}
      />,
    )

    expect(screen.getByText('No hay movimientos')).toBeInTheDocument()
    expect(screen.getByText('Agrega tu primer movimiento.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Agregar' }))
    expect(onCreate).toHaveBeenCalledOnce()
  })

  it('does not invent optional guidance or actions', () => {
    render(<EmptyState title="Nada pendiente" />)

    expect(screen.getByText('Nada pendiente')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
