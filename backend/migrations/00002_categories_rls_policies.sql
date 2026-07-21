-- +goose Up
-- budg_api no longer has BYPASSRLS (see bootstrap-runtime-role.sql), so RLS
-- is now a real second enforcement layer beneath the application's explicit
-- WHERE user_id = $1 filtering. The app scopes every request-carrying
-- transaction with `SELECT set_config('app.user_id', <uuid>, true)` (see
-- internal/store.RunScoped) before running any query; policies below check
-- that session-local setting.
--
-- Comparison is done as text, not uuid: custom ("app.*") GUC parameters are
-- lazily initialized to '' the first time they're referenced in a backend
-- session, and a transaction-local SET (is_local=true) reverts to that ''
-- once committed -- NOT to NULL -- on any connection that has run a scoped
-- query before (pgxpool reuses connections). Casting '' to uuid raises an
-- error instead of comparing false. Text comparison never throws and simply
-- evaluates to false when unset, denying access by default either way.
CREATE POLICY categories_user_scoped ON public.categories
    FOR ALL
    TO budg_api
    USING (user_id::text = current_setting('app.user_id', true))
    WITH CHECK (user_id::text = current_setting('app.user_id', true));

-- +goose Down
DROP POLICY categories_user_scoped ON public.categories;
