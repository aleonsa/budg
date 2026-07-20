import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '@/stores/auth'

/**
 * Guard that redirects unauthenticated users to /login.
 * Wrap any protected route element with this.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const user = useAuth((s) => s.user)
  const location = useLocation()

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <>{children}</>
}
