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
const LOOPBACK_HOST =
  /^(?:https?:)?\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::\d+)?(?:\/|$)/i

/**
 * Accept the configured override, or return '' when there is nothing usable.
 *
 * A loopback override is rejected outside dev because it is never reachable
 * from a user's browser in a deployed build — honouring it would only produce
 * ERR_CONNECTION_REFUSED on every request. That is exactly what happened on
 * 2026-08-03: a `vercel deploy` from a laptop uploaded frontend/.env (see
 * /.vercelignore) and Vite inlined its VITE_API_BASE_URL=http://localhost:8080
 * into the production bundle.
 *
 * Takes both inputs as arguments rather than reading `import.meta.env` directly
 * so the non-dev paths stay testable: Vite inlines those values at build time,
 * which makes them impossible to vary from a test.
 *
 * Deliberately does NOT own the dev fallback. Keeping that literal at the call
 * site, behind the `import.meta.env.DEV` that Vite inlines to `false`, lets the
 * production bundle drop the string 'http://localhost:8080' entirely — so
 * grepping a built bundle for it stays a meaningful regression check.
 */
export function resolveApiBaseOverride(configured: string | undefined, isDev: boolean): string {
  const override = configured?.trim()
  if (!override) {
    return ''
  }
  if (!isDev && LOOPBACK_HOST.test(override)) {
    console.warn(
      `[backend] Ignoring VITE_API_BASE_URL="${override}": a loopback address ` +
        'cannot be reached from a deployed build. Falling back to same-origin.',
    )
    return ''
  }
  return override
}

const DEFAULT_BASE =
  resolveApiBaseOverride(import.meta.env.VITE_API_BASE_URL, import.meta.env.DEV) ||
  (import.meta.env.DEV ? 'http://localhost:8080' : '')

/**
 * The base every request actually goes to, for display in diagnostics UI.
 * Empty means same-origin. Read this instead of VITE_API_BASE_URL directly, so
 * what the UI reports can never disagree with where requests are sent.
 */
export const apiBaseUrl = DEFAULT_BASE

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
