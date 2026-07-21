import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setSupabaseForTests } from '@/lib/supabase/client'
import { __resetAuthSubscriptionBindingForTests, useAuth } from '@/stores/auth'
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

function fakeSupabase(auth: {
  getSession?: ReturnType<typeof vi.fn>
  signInWithPassword?: ReturnType<typeof vi.fn>
}) {
  return {
    auth: {
      getSession:
        auth.getSession ?? vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      signInWithPassword:
        auth.signInWithPassword ?? vi.fn().mockResolvedValue({ data: {}, error: null }),
      onAuthStateChange: vi.fn(() => ({ unsubscribe: vi.fn() })),
    },
  }
}

describe('LoginPage', () => {
  beforeEach(() => {
    __resetAuthSubscriptionBindingForTests()
    useAuth.setState({ status: 'unauthenticated', user: null, error: null })
  })

  afterEach(() => {
    __setSupabaseForTests(null)
    __resetAuthSubscriptionBindingForTests()
    vi.restoreAllMocks()
    useAuth.setState({ status: 'loading', user: null, error: null })
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

  it('enters a pending state, signs in, and navigates to the dashboard on success', async () => {
    const supa = fakeSupabase({})
    supa.auth.getSession.mockResolvedValue({
      data: {
        session: {
          user: {
            id: 'user-1',
            email: 'ana@example.com',
            user_metadata: { name: 'Ana' },
          },
        },
      },
      error: null,
    })
    __setSupabaseForTests(supa as never)

    const user = userEvent.setup()
    renderLogin()

    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'ana@example.com')
    await user.type(screen.getByLabelText('Contraseña'), 'secret')
    const submit = screen.getByRole('button', { name: 'Iniciar sesión' })
    await user.click(submit)

    expect(await screen.findByText('Dashboard destination')).toBeInTheDocument()
    expect(useAuth.getState().user).toEqual({
      id: 'user-1',
      email: 'ana@example.com',
      name: 'Ana',
    })
  })

  it('surfaces Supabase sign-in errors in the alert region', async () => {
    const supa = fakeSupabase({
      signInWithPassword: vi.fn().mockResolvedValue({
        data: { session: null },
        error: { message: 'Invalid login credentials' },
      }),
    })
    __setSupabaseForTests(supa as never)

    const user = userEvent.setup()
    renderLogin()

    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'ana@example.com')
    await user.type(screen.getByLabelText('Contraseña'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login credentials')
    expect(useAuth.getState().user).toBeNull()
  })

  it('warns when Supabase is not configured and refuses to submit', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    __setSupabaseForTests(null)
    const user = userEvent.setup()
    renderLogin()

    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'ana@example.com')
    await user.type(screen.getByLabelText('Contraseña'), 'secret')
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.',
    )
    expect(useAuth.getState().user).toBeNull()
  })
})
