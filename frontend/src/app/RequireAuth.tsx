import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '@/stores/auth'

/**
 * Guard that redirects unauthenticated users to /login. While the session is
 * being restored on first load (`status === 'loading'`), it renders nothing so
 * we don't bounce to /login before Supabase answers.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status)
  const location = useLocation()

  if (status === 'loading') return null
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <>{children}</>
}
