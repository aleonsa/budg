import { getSupabase } from '@/lib/supabase/client'

/**
 * Base URL for the Go backend.
 *
 * Production and Preview deployments serve the frontend and backend from the
 * same Vercel project/domain (see /vercel.json's service rewrites), so an
 * empty base — a same-origin relative path — is always correct there and
 * needs no configuration. This also means Preview deployments work out of
 * the box even though each PR gets its own unique *.vercel.app domain: there
 * is no single fixed URL to hardcode as an environment variable that would
 * be correct for every preview.
 *
 * Local `vite dev` runs the frontend on :5173 with the Go server (if any)
 * separately on :8080, which is genuinely cross-origin, so it falls back to
 * that unless VITE_API_BASE_URL overrides it explicitly.
 */
const DEFAULT_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ||
  (import.meta.env.DEV ? 'http://localhost:8080' : '')

/**
 * Build an absolute URL against the Go backend.
 */
export function backendUrl(path: string): string {
  return `${DEFAULT_BASE.replace(/\/$/, '')}${path}`
}

/**
 * Authenticated fetch against the backend. Reads the active Supabase access
 * token and attaches it as `Authorization: Bearer <jwt>`. Throws if there is
 * no session or no client configured.
 */
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const supabase = getSupabase()
  if (!supabase) {
    throw new Error('Supabase no está configurado.')
  }
  const { data, error } = await supabase.auth.getSession()
  if (error) {
    throw new Error(`No se pudo obtener la sesión: ${error.message}`)
  }
  const token = data.session?.access_token
  if (!token) {
    throw new Error('No hay sesión activa.')
  }
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  return fetch(backendUrl(path), { ...init, headers })
}
