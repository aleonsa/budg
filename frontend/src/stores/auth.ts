import { create } from 'zustand'
import { getSupabase } from '@/lib/supabase/client'

/**
 * Auth store backed by Supabase sessions.
 *
 * The store is a thin reactive adapter over `supabase.auth`. It exposes the
 * current session/user, a status machine for loading gates, and async
 * sign-in/sign-out/profile updates. Identity comes only from Supabase; we
 * never store a client-supplied user.
 */
export interface AuthUser {
  id: string
  email: string
  name: string
}

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

interface SessionLike {
  user?: {
    id: string
    email?: string
    user_metadata?: { name?: string } | null
  } | null
}

interface AuthState {
  status: AuthStatus
  user: AuthUser | null
  error: string | null
  initialize: () => Promise<void>
  signIn: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>
  signOut: () => Promise<void>
  updateProfile: (patch: Partial<Pick<AuthUser, 'name'>>) => Promise<void>
  clearError: () => void
}

let subscriptionBound = false

function deriveName(session: SessionLike, email: string): string {
  const fromMeta = session.user?.user_metadata?.name?.trim()
  if (fromMeta) return fromMeta
  const at = email.indexOf('@')
  return at > 0 ? email.slice(0, at) : email
}

function userFromSession(session: SessionLike | null): AuthUser | null {
  if (!session?.user) return null
  const u = session.user
  if (!u.id || !u.email) return null
  return { id: u.id, email: u.email, name: deriveName(session, u.email) }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as { message?: unknown }).message
    if (typeof msg === 'string' && msg.length > 0) return msg
  }
  return 'Ocurrió un error inesperado.'
}

export const useAuth = create<AuthState>((set) => ({
  status: 'loading',
  user: null,
  error: null,

  initialize: async () => {
    const supabase = getSupabase()
    if (!supabase) {
      set({ status: 'unauthenticated' })
      return
    }
    // Bind the global listener once; React strict-mode double-mount would
    // otherwise leak subscriptions.
    if (!subscriptionBound) {
      subscriptionBound = true
      supabase.auth.onAuthStateChange((_event, session) => {
        const user = userFromSession(session)
        set({ status: user ? 'authenticated' : 'unauthenticated', user })
      })
    }
    const { data, error } = await supabase.auth.getSession()
    if (error) {
      set({ status: 'unauthenticated', user: null, error: errorMessage(error) })
      return
    }
    const user = userFromSession(data.session)
    set({ status: user ? 'authenticated' : 'unauthenticated', user })
  },

  signIn: async (email, password) => {
    const trimmedEmail = email.trim()
    if (!trimmedEmail || !password.trim()) {
      const msg = 'Ingresa email y contraseña.'
      set({ error: msg })
      return { ok: false, error: msg }
    }
    const supabase = getSupabase()
    if (!supabase) {
      const msg = 'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.'
      set({ error: msg })
      return { ok: false, error: msg }
    }
    const { error } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password: password.trim(),
    })
    if (error) {
      const msg = errorMessage(error)
      set({ error: msg })
      return { ok: false, error: msg }
    }
    const { data } = await supabase.auth.getSession()
    const user = userFromSession(data.session)
    set({ user, status: user ? 'authenticated' : 'loading', error: null })
    return { ok: true }
  },

  signOut: async () => {
    const supabase = getSupabase()
    if (supabase) {
      try {
        await supabase.auth.signOut()
      } catch {
        // ignore — we always clear local state regardless
      }
    }
    set({ user: null, status: 'unauthenticated', error: null })
  },

  updateProfile: async (patch) => {
    const supabase = getSupabase()
    if (!supabase) return
    const { data, error } = await supabase.auth.updateUser({ data: patch })
    if (error) {
      set({ error: errorMessage(error) })
      return
    }
    const user = userFromSession(data)
    if (user) set({ user })
  },

  clearError: () => set({ error: null }),
}))

// Exported for tests that need to reset the module-local subscription guard.
export function __resetAuthSubscriptionBindingForTests(): void {
  subscriptionBound = false
}
