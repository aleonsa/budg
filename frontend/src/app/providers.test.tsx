import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { useAuth } from '@/stores/auth'
import { Providers } from './providers'
import { router } from './router'

describe('Providers', () => {
  afterEach(() => useAuth.setState({ user: null }))

  it('wires the application router to the public login route', async () => {
    useAuth.setState({ user: null })
    await act(() => router.navigate('/login'))

    render(<Providers />)

    expect(await screen.findByRole('textbox', { name: 'Email' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeEnabled()
  })
})
