import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { router } from './router'
import { useAuth } from '@/stores/auth'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

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

function RecurringTransactionProcessor() {
  const status = useAuth((s) => s.status)
  const queryClient = useQueryClient()
  const { mutate } = useMutation({
    mutationFn: api.processRecurringTransactions,
    onSuccess: ({ created }) => {
      if (created === 0) return
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts })
      queryClient.invalidateQueries({ queryKey: queryKeys.recurringTransactions })
    },
  })

  useEffect(() => {
    if (status === 'authenticated') mutate()
  }, [mutate, status])

  return null
}

export function Providers() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionBootstrap>
        <RecurringTransactionProcessor />
        <RouterProvider router={router} />
      </SessionBootstrap>
    </QueryClientProvider>
  )
}
