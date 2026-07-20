import { act } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '@/stores/auth'
import LoginPage from './LoginPage'

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<p>Dashboard destination</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('LoginPage', () => {
  beforeEach(() => {
    useAuth.setState({ user: null })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    useAuth.setState({ user: null })
  })

  it('shows validation feedback and stays put when credentials are empty', async () => {
    const user = userEvent.setup()
    renderLogin()

    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }))

    const error = screen.getByRole('alert')
    expect(error).toHaveTextContent('Ingresa email y contraseña.')
    const email = screen.getByRole('textbox', { name: 'Email' })
    const password = screen.getByLabelText('Contraseña')
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(password).toHaveAttribute('aria-invalid', 'true')
    expect(email).toHaveAccessibleDescription('Ingresa email y contraseña.')
    expect(password).toHaveAccessibleDescription('Ingresa email y contraseña.')
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeEnabled()
    expect(useAuth.getState().user).toBeNull()
  })

  it('marks only missing credentials as invalid', async () => {
    const user = userEvent.setup()
    renderLogin()

    const email = screen.getByRole('textbox', { name: 'Email' })
    await user.type(email, 'ana@example.com')
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Ingresa email y contraseña.')
    expect(email).not.toHaveAttribute('aria-invalid')
    expect(email).not.toHaveAttribute('aria-describedby')
    const password = screen.getByLabelText('Contraseña')
    expect(password).toHaveAttribute('aria-invalid', 'true')
    expect(password).toHaveAccessibleDescription('Ingresa email y contraseña.')
  })

  it('enters a pending state, signs in, and replaces login after valid submission', async () => {
    const user = userEvent.setup()
    renderLogin()

    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'ana@example.com')
    await user.type(screen.getByLabelText('Contraseña'), 'secret')
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))

    expect(screen.getByRole('button', { name: 'Ingresando…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Usar credenciales demo' })).toBeDisabled()
    expect(useAuth.getState().user).toBeNull()

    act(() => vi.advanceTimersByTime(250))

    expect(screen.getByText('Dashboard destination')).toBeInTheDocument()
    expect(useAuth.getState().user).toEqual({ name: 'Usuario Demo', email: 'ana@example.com' })
  })

  it('fills and submits canonical demo credentials in one action', async () => {
    renderLogin()

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Usar credenciales demo' }))

    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue('demo@budg.app')
    expect(screen.getByLabelText('Contraseña')).toHaveValue('demo1234')
    expect(screen.getByRole('button', { name: 'Ingresando…' })).toBeDisabled()

    act(() => vi.advanceTimersByTime(250))

    expect(screen.getByText('Dashboard destination')).toBeInTheDocument()
    expect(useAuth.getState().user?.email).toBe('demo@budg.app')
  })
})
