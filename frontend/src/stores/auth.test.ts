import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setSupabaseForTests } from '@/lib/supabase/client'
import { __resetAuthSubscriptionBindingForTests, useAuth, type AuthUser } from './auth'

type AuthState =
  | { data: { session: unknown }; error: null }
  | { data: { session: null }; error: null }
  | { data: { session: null }; error: { message: string } }

interface FakeAuth {
  getSession: ReturnType<typeof vi.fn>
  signInWithPassword: ReturnType<typeof vi.fn>
  signOut: ReturnType<typeof vi.fn>
  updateUser: ReturnType<typeof vi.fn>
  onAuthStateChange: ReturnType<typeof vi.fn>
}

interface FakeSupabase {
  auth: FakeAuth
}

function fakeSessionUser(overrides: Partial<AuthUser> = {}): {
  user: { id: string; email?: string; user_metadata?: { name?: string } }
} {
  return {
    user: {
      id: overrides.id ?? 'user-1',
      email: overrides.email ?? 'ada@example.com',
      user_metadata: overrides.name ? { name: overrides.name } : { name: 'Ada' },
    },
  }
}

function makeFakeSupabase(initial: {
  session?: AuthState
  signIn?: AuthState
  updateUser?: AuthState
}): FakeSupabase {
  return {
    auth: {
      getSession: vi
        .fn()
        .mockResolvedValue(initial.session ?? { data: { session: null }, error: null }),
      signInWithPassword: vi.fn().mockResolvedValue(initial.signIn ?? { data: {}, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      updateUser: vi.fn().mockResolvedValue(initial.updateUser ?? { data: {}, error: null }),
      onAuthStateChange: vi.fn().mockImplementation(() => ({ unsubscribe: vi.fn() })),
    },
  }
}

describe('auth store', () => {
  beforeEach(() => {
    __resetAuthSubscriptionBindingForTests()
    useAuth.setState({ status: 'loading', user: null, error: null })
  })

  afterEach(() => {
    __setSupabaseForTests(null)
    __resetAuthSubscriptionBindingForTests()
    vi.restoreAllMocks()
  })

  it('reports unauthenticated without a configured client', async () => {
    __setSupabaseForTests(null)
    await useAuth.getState().initialize()
    expect(useAuth.getState().status).toBe('unauthenticated')
    expect(useAuth.getState().user).toBeNull()
  })

  it('restores an existing session on initialize', async () => {
    const supa = makeFakeSupabase({
      session: { data: { session: fakeSessionUser() }, error: null },
    })
    __setSupabaseForTests(supa as never)

    await useAuth.getState().initialize()

    expect(supa.auth.onAuthStateChange).toHaveBeenCalledTimes(1)
    expect(useAuth.getState().status).toBe('authenticated')
    expect(useAuth.getState().user).toEqual({
      id: 'user-1',
      email: 'ada@example.com',
      name: 'Ada',
    })
  })

  it('binds the auth listener only once across multiple initializes', async () => {
    const supa = makeFakeSupabase({ session: { data: { session: null }, error: null } })
    __setSupabaseForTests(supa as never)

    await useAuth.getState().initialize()
    await useAuth.getState().initialize()

    expect(supa.auth.onAuthStateChange).toHaveBeenCalledTimes(1)
  })

  it('reflects session errors as unauthenticated with a stored message', async () => {
    __setSupabaseForTests(
      makeFakeSupabase({
        session: { data: { session: null }, error: { message: 'invalid token' } },
      }) as never,
    )

    await useAuth.getState().initialize()

    expect(useAuth.getState().status).toBe('unauthenticated')
    expect(useAuth.getState().error).toMatch(/invalid token/)
  })

  it('rejects blank credentials synchronously before calling Supabase', async () => {
    const supa = makeFakeSupabase({})
    __setSupabaseForTests(supa as never)

    const result = await useAuth.getState().signIn('   ', 'password')

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Ingresa email y contraseña/)
    expect(supa.auth.signInWithPassword).not.toHaveBeenCalled()
  })

  it('signs in with trimmed credentials and populates the user', async () => {
    const supa = makeFakeSupabase({
      signIn: { data: { session: null }, error: null },
    })
    supa.auth.getSession.mockResolvedValue({
      data: { session: fakeSessionUser({ email: 'ada@example.com' }) },
      error: null,
    })
    __setSupabaseForTests(supa as never)

    const result = await useAuth.getState().signIn('  ada@example.com  ', ' secret ')

    expect(result.ok).toBe(true)
    expect(supa.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'secret',
    })
    expect(useAuth.getState().user).toEqual({
      id: 'user-1',
      email: 'ada@example.com',
      name: 'Ada',
    })
    expect(useAuth.getState().status).toBe('authenticated')
  })

  it('surfaces Supabase sign-in errors', async () => {
    __setSupabaseForTests(
      makeFakeSupabase({
        signIn: { data: { session: null }, error: { message: 'Invalid login credentials' } },
      }) as never,
    )

    const result = await useAuth.getState().signIn('ada@example.com', 'wrong')

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Invalid login credentials/)
    expect(useAuth.getState().user).toBeNull()
  })

  it('updates profile via Supabase and stores the new name', async () => {
    const updated = fakeSessionUser({ name: 'Augusta' })
    const supa = makeFakeSupabase({})
    supa.auth.updateUser.mockResolvedValueOnce({ data: updated, error: null })
    __setSupabaseForTests(supa as never)
    useAuth.setState({
      user: { id: 'user-1', email: 'ada@example.com', name: 'Ada' },
      status: 'authenticated',
    })

    await useAuth.getState().updateProfile({ name: 'Augusta' })

    expect(supa.auth.updateUser).toHaveBeenCalledWith({ data: { name: 'Augusta' } })
    expect(useAuth.getState().user?.name).toBe('Augusta')
  })

  it('signs out and clears local state', async () => {
    const supa = makeFakeSupabase({})
    __setSupabaseForTests(supa as never)
    useAuth.setState({
      user: { id: 'user-1', email: 'ada@example.com', name: 'Ada' },
      status: 'authenticated',
    })

    await useAuth.getState().signOut()

    expect(supa.auth.signOut).toHaveBeenCalled()
    expect(useAuth.getState().user).toBeNull()
    expect(useAuth.getState().status).toBe('unauthenticated')
  })
})
