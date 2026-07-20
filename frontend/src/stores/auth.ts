import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Mock auth store.
 *
 * Demo credentials (shown on the login page banner):
 *   email:    demo@budg.app
 *   password: demo1234
 *
 * `signIn` accepts ANY non-empty email/password so the demo is flexible,
 * but the login banner advertises the canonical demo creds.
 */
export interface MockUser {
  name: string
  email: string
}

interface AuthState {
  user: MockUser | null
  signIn: (email: string, password: string) => boolean
  updateProfile: (patch: Partial<Pick<MockUser, 'name'>>) => void
  signOut: () => void
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      signIn: (email, password) => {
        if (!email.trim() || !password.trim()) return false
        set({
          user: {
            name: 'Usuario Demo',
            email: email.trim(),
          },
        })
        return true
      },
      updateProfile: (patch) => set((s) => (s.user ? { user: { ...s.user, ...patch } } : s)),
      signOut: () => set({ user: null }),
    }),
    { name: 'budg.mock.auth' },
  ),
)
