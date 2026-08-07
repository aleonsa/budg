import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAgentStore } from '@/stores/agent'
import { FabChat } from './FabChat'

describe('FabChat', () => {
  beforeEach(() => {
    useAgentStore.getState().reset()
    useAgentStore.getState().setOpen(true)
  })

  it('opens an accessible, enlarged desktop panel with prompt suggestions', () => {
    render(
      <MemoryRouter>
        <FabChat />
      </MemoryRouter>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Asistente budg' })
    expect(dialog).toHaveClass('sm:w-[30rem]', 'sm:h-[42.5rem]')
    expect(screen.getByRole('log')).toHaveAttribute('aria-busy', 'false')
    expect(screen.getByRole('button', { name: '¿En qué gasté más este mes?' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Mensaje' })).toBeInTheDocument()
  })

  it('closes from the mobile header control', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <FabChat />
      </MemoryRouter>,
    )

    await user.click(screen.getAllByRole('button', { name: 'Cerrar asistente budg' })[0])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
