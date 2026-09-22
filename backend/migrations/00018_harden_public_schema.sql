-- +goose Up
-- Supabase Security Advisor hardening (rls_disabled_in_public +
-- function_search_path_mutable) without touching the runtime path:
--
--   * goose_db_version is tooling-owned by the `postgres` migration user
--     (table owner), which bypasses non-FORCED RLS, so plain ENABLE keeps
--     goose working while closing Data API (anon/authenticated) access.
--   * The app role budg_api already works under FORCE RLS on every table;
--     it never reads goose_db_version.
--
-- The advisor flags any public table without RLS; the REVOKE additionally
-- removes the legacy Data API grants that made the migration ledger
-- readable and writable (even TRUNCATE) with the browser anon key.
REVOKE ALL ON public.goose_db_version FROM anon, authenticated, service_role;

ALTER TABLE public.goose_db_version ENABLE ROW LEVEL SECURITY;

-- Function bodies are fully schema-qualified (public.* + pg_catalog builtins
-- only), so an empty search_path is safe and stops search-path hijacking on
-- SECURITY-adjacent trigger execution.
ALTER FUNCTION public.enforce_savings_allocation_currency() SET search_path = '';

-- +goose Down
ALTER FUNCTION public.enforce_savings_allocation_currency() RESET search_path;

ALTER TABLE public.goose_db_version DISABLE ROW LEVEL SECURITY;

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON public.goose_db_version TO anon, authenticated, service_role;
