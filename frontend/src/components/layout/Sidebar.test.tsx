import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { useAuth } from '@/stores/auth'
import { Sidebar } from './Sidebar'

function LocationProbe() {
  return <output aria-label="Current path">{useLocation().pathname}</output>
}

function renderSidebar(path = '/transactions') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar />
      <LocationProbe />
    </MemoryRouter>,
  )
}

describe('Sidebar', () => {
  afterEach(() => useAuth.setState({ user: null }))

  it('marks the current destination and navigates among primary routes', async () => {
    const user = userEvent.setup()
    renderSidebar()

    expect(screen.getByRole('link', { name: 'Movimientos' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: 'Inicio' })).not.toHaveAttribute('aria-current')

    await user.click(screen.getByRole('link', { name: 'Presupuestos' }))
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/budgets')
  })

  it('opens account details and closes them with Escape or an outside pointer', async () => {
    const user = userEvent.setup()
    useAuth.setState({ user: { name: 'Ana', email: 'ana@example.com' } })
    renderSidebar()
    const trigger = screen.getByRole('button', { name: /Ana ana@example.com/ })

    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Enter' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{Escape}')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await user.click(trigger)
    fireEvent.pointerDown(document.body)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('signs out and replaces the current route with login', async () => {
    const user = userEvent.setup()
    useAuth.setState({ user: { name: 'Ana', email: 'ana@example.com' } })
    renderSidebar()

    await user.click(screen.getByRole('button', { name: /Ana ana@example.com/ }))
    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }))

    expect(useAuth.getState().user).toBeNull()
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/login')
  })

  it('closes account details after navigating to settings', async () => {
    const user = userEvent.setup()
    useAuth.setState({ user: { name: 'Ana', email: 'ana@example.com' } })
    renderSidebar()
    const trigger = screen.getByRole('button', { name: /Ana ana@example.com/ })

    await user.click(trigger)
    const accountMenu = trigger.parentElement
    if (!accountMenu) throw new Error('Account menu not found')
    await user.click(within(accountMenu).getByRole('link', { name: 'Ajustes' }))

    expect(screen.getByLabelText('Current path')).toHaveTextContent('/settings')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('offers guest account fallbacks when no session exists', async () => {
    const user = userEvent.setup()
    renderSidebar()

    await user.click(screen.getByRole('button', { name: /Invitado sesión no iniciada/ }))

    expect(screen.getAllByText('Invitado')).toHaveLength(2)
    expect(screen.getAllByText('sesión no iniciada')).toHaveLength(2)
  })
})
