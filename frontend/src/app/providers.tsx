import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { router } from './router'
import { useAuth } from '@/stores/auth'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 min
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
})

/**
 * Restores the Supabase session before rendering routes so RequireAuth sees a
 * resolved status instead of bouncing to /login while a session still exists.
 */
function SessionBootstrap({ children }: { children: React.ReactNode }) {
  const initialize = useAuth((s) => s.initialize)
  const status = useAuth((s) => s.status)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    void initialize().finally(() => {
      if (!cancelled) setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [initialize])

  if (!ready || status === 'loading') return null
  return <>{children}</>
}

export function Providers() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionBootstrap>
        <RouterProvider router={router} />
      </SessionBootstrap>
    </QueryClientProvider>
  )
}
