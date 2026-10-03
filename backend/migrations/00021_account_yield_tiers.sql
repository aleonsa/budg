-- +goose Up
-- Tiered savings yields: most Mexican accounts pay a high rate up to a
-- balance cap and a lower rate above it (e.g. 15% up to $25,000, then 7%).
-- Tiers are stored as a JSON array on the account:
--   [{"upToCents": 2500000, "annualYieldBps": 1500},
--    {"upToCents": null,    "annualYieldBps": 700}]
-- Each tier covers the balance above the previous cap through upToCents; the
-- final tier has null (no cap). A flat annual_yield_bps keeps working when
-- tiers are absent; tiers take precedence for estimates when present.
-- +goose StatementBegin
CREATE FUNCTION public.valid_annual_yield_tiers(tiers jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
DECLARE
    tier_count integer;
    tier_index integer;
    tier jsonb;
    rate_text text;
    cap_text text;
    cap bigint;
    previous_cap bigint := 0;
BEGIN
    IF jsonb_typeof(tiers) <> 'array' THEN
        RETURN false;
    END IF;
    tier_count := jsonb_array_length(tiers);
    IF tier_count < 1 OR tier_count > 8 THEN
        RETURN false;
    END IF;

    FOR tier_index IN 0..tier_count - 1 LOOP
        tier := tiers -> tier_index;
        IF jsonb_typeof(tier) <> 'object' OR
           (tier - 'upToCents' - 'annualYieldBps') <> '{}'::jsonb OR
           NOT (tier ? 'upToCents') OR
           NOT (tier ? 'annualYieldBps') THEN
            RETURN false;
        END IF;

        rate_text := tier ->> 'annualYieldBps';
        IF rate_text IS NULL OR char_length(rate_text) > 5 OR
           rate_text !~ '^[0-9]+$' OR rate_text::numeric > 10000 THEN
            RETURN false;
        END IF;

        IF tier_index = tier_count - 1 THEN
            IF tier -> 'upToCents' <> 'null'::jsonb THEN
                RETURN false;
            END IF;
        ELSE
            IF jsonb_typeof(tier -> 'upToCents') <> 'number' THEN
                RETURN false;
            END IF;
            cap_text := tier ->> 'upToCents';
            IF char_length(cap_text) > 19 OR cap_text !~ '^[0-9]+$' THEN
                RETURN false;
            END IF;
            cap := cap_text::bigint;
            IF cap <= previous_cap THEN
                RETURN false;
            END IF;
            previous_cap := cap;
        END IF;
    END LOOP;
    RETURN true;
EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RETURN false;
END;
$$;
-- +goose StatementEnd

REVOKE ALL ON FUNCTION public.valid_annual_yield_tiers(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.valid_annual_yield_tiers(jsonb) TO budg_api;

ALTER TABLE public.accounts
    ADD COLUMN annual_yield_tiers jsonb,
    ADD CONSTRAINT accounts_annual_yield_tiers_valid
        CHECK (
            annual_yield_tiers IS NULL OR
            (type = 'debit' AND public.valid_annual_yield_tiers(annual_yield_tiers))
        );

ALTER TABLE public.account_yield_reconciliations
    ADD COLUMN annual_yield_tiers jsonb,
    ADD CONSTRAINT account_yield_reconciliations_tiers_valid
        CHECK (
            annual_yield_tiers IS NULL OR
            public.valid_annual_yield_tiers(annual_yield_tiers)
        );

-- +goose Down
ALTER TABLE public.account_yield_reconciliations
    DROP CONSTRAINT account_yield_reconciliations_tiers_valid,
    DROP COLUMN annual_yield_tiers;

ALTER TABLE public.accounts
    DROP CONSTRAINT accounts_annual_yield_tiers_valid,
    DROP COLUMN annual_yield_tiers;

DROP FUNCTION public.valid_annual_yield_tiers(jsonb);
