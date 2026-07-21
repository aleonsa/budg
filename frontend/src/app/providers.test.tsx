import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setSupabaseForTests } from '@/lib/supabase/client'
import { __resetAuthSubscriptionBindingForTests, useAuth } from '@/stores/auth'
import { Providers } from './providers'
import { router } from './router'

describe('Providers', () => {
  beforeEach(() => {
    __resetAuthSubscriptionBindingForTests()
    __setSupabaseForTests({
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        onAuthStateChange: vi.fn(() => ({ unsubscribe: vi.fn() })),
      },
    } as never)
    useAuth.setState({ status: 'loading', user: null, error: null })
  })

  afterEach(() => {
    __setSupabaseForTests(null)
    __resetAuthSubscriptionBindingForTests()
    useAuth.setState({ status: 'loading', user: null, error: null })
  })

  it('wires the application router to the public login route', async () => {
    await act(() => router.navigate('/login'))

    render(<Providers />)

    expect(await screen.findByRole('textbox', { name: 'Email' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeEnabled()
  })
})
