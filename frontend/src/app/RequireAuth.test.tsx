import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { useAuth } from '@/stores/auth'
import { RequireAuth } from './RequireAuth'

function LoginDestination() {
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  return <p>Login requested from {from}</p>
}

function renderProtectedRoute() {
  return render(
    <MemoryRouter initialEntries={['/accounts']}>
      <Routes>
        <Route
          path="/accounts"
          element={
            <RequireAuth>
              <p>Private accounts</p>
            </RequireAuth>
          }
        />
        <Route path="/login" element={<LoginDestination />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RequireAuth', () => {
  afterEach(() => useAuth.setState({ user: null }))

  it('redirects signed-out users to login and preserves their destination', () => {
    useAuth.setState({ user: null })

    renderProtectedRoute()

    expect(screen.getByText('Login requested from /accounts')).toBeInTheDocument()
    expect(screen.queryByText('Private accounts')).not.toBeInTheDocument()
  })

  it('shows protected content to signed-in users', () => {
    useAuth.setState({ user: { name: 'Ana', email: 'ana@example.com' } })

    renderProtectedRoute()

    expect(screen.getByText('Private accounts')).toBeInTheDocument()
  })
})
