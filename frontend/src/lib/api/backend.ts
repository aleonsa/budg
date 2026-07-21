import { getSupabase } from '@/lib/supabase/client'

const DEFAULT_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || 'http://localhost:8080'

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
