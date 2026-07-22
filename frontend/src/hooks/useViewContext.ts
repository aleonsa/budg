import { useLocation } from 'react-router-dom'
import { useMemo } from 'react'
import type { ViewContext } from '@/lib/agent/types'

/**
 * Captures the current route and extracts an optional entity ID from the
 * path. This is a *hint* for the agent (so it can say "veo que estás en la
 * cuenta X" without an extra tool call), never authority — the backend
 * validates every ID under the authenticated user's scope regardless.
 *
 * The extraction is intentionally simple: it looks for a UUID-like segment
 * after a known resource prefix. Complex SPA routing state (filters, tabs,
 * selected period) is not captured here; that would require per-page
 * integration and is not worth the coupling for an MVP hint.
 */
export function useViewContext(): ViewContext {
  const location = useLocation()

  return useMemo(() => {
    const path = location.pathname
    const context: ViewContext = { route: path }

    // /accounts/:id  →  entityType: account
    const accountMatch = path.match(
      /^\/accounts\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    )
    if (accountMatch) {
      context.entityType = 'account'
      context.entityId = accountMatch[1]
    }

    // /transactions/:id  →  entityType: transaction
    const txMatch = path.match(
      /^\/transactions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    )
    if (txMatch) {
      context.entityType = 'transaction'
      context.entityId = txMatch[1]
    }

    return context
  }, [location.pathname])
}
