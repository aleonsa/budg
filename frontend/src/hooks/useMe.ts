import { useQuery } from '@tanstack/react-query'
import { authFetch } from '@/lib/api/backend'
import { authQueryKeys } from '@/lib/query-keys'

export interface MeResponse {
  userId: string
  email?: string
  authenticated: boolean
}

/**
 * Smoke hook that proves end-to-end wiring: browser -> Supabase session ->
  Bearer JWT -> backend verifier -> /v1/me identity.
 *
 * `enabled` defaults to `false` because the hook is a manual smoke test, not
 * part of the regular data flow. Callers trigger it via `refetch()`.
 */
export function useMe(options: { enabled?: boolean } = {}) {
  return useQuery<MeResponse>({
    queryKey: authQueryKeys.me(),
    queryFn: async () => {
      const res = await authFetch('/v1/me')
      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`)
      }
      return (await res.json()) as MeResponse
    },
    enabled: options.enabled ?? false,
  })
}
