import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { useAuth } from '@/stores/auth'
import { MobileUserMenu } from './MobileUserMenu'

function LocationProbe() {
  return <output aria-label="Current path">{useLocation().pathname}</output>
}

function renderMenu() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <MobileUserMenu />
      <LocationProbe />
    </MemoryRouter>,
  )
}

describe('MobileUserMenu', () => {
  afterEach(() => useAuth.setState({ status: 'unauthenticated', user: null, error: null }))

  it('shows signed-in account details and closes after navigating to settings', async () => {
    const user = userEvent.setup()
    useAuth.setState({
      status: 'authenticated',
      user: { id: 'u1', email: 'ana@example.com', name: 'ana pérez' },
    })
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Cuenta' }))
    expect(screen.getByText('ana pérez')).toBeInTheDocument()
    expect(screen.getByText('ana@example.com')).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Ajustes' }))
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/settings')
    expect(screen.queryByRole('heading', { name: 'Cuenta' })).not.toBeInTheDocument()
  })

  it('signs out and replaces the current route with login', async () => {
    const user = userEvent.setup()
    useAuth.setState({
      status: 'authenticated',
      user: { id: 'u1', email: 'ana@example.com', name: 'Ana' },
    })
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Cuenta' }))
    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }))

    expect(useAuth.getState().user).toBeNull()
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/login')
  })

  it('uses guest account fallbacks when no session exists', async () => {
    const user = userEvent.setup()
    useAuth.setState({ status: 'unauthenticated', user: null })
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Cuenta' }))

    expect(screen.getByText('Invitado')).toBeInTheDocument()
    expect(screen.getByText('sesión no iniciada')).toBeInTheDocument()
  })

  it('closes account details with Escape', async () => {
    const user = userEvent.setup()
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Cuenta' }))
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('heading', { name: 'Cuenta' })).not.toBeInTheDocument()
  })
})
