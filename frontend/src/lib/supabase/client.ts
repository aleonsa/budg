import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase browser client singleton.
 *
 * Reads public env vars (URL + anon key — both are safe to expose). When the
 * vars are missing (e.g. unit tests, demo builds without backend wiring) we
 * return null and let callers decide. We never throw at module load so that
 * tooling (vitest, typecheck, build) keeps working without a .env file.
 */
let cached: SupabaseClient | null = null
let missingLogged = false

function env(): { url: string; anon: string } {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  return { url: (url ?? '').trim(), anon: (anon ?? '').trim() }
}

export function isSupabaseConfigured(): boolean {
  const { url, anon } = env()
  return url.length > 0 && anon.length > 0
}

export function getSupabase(): SupabaseClient | null {
  if (cached) return cached
  const { url, anon } = env()
  if (!url || !anon) {
    if (!missingLogged && import.meta.env.DEV) {
      // Surface once per session so devs notice missing wiring, but never throw.
      console.warn('[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set — auth disabled.')
      missingLogged = true
    }
    return null
  }
  cached = createClient(url, anon, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  })
  return cached
}

/**
 * Test-only seam: inject a fake client so unit tests can drive the auth store
 * without env vars or a network. Pass null to reset.
 */
export function __setSupabaseForTests(client: SupabaseClient | null): void {
  cached = client
}
