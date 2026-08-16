-- +goose Up
CREATE TABLE public.savings_goal_allocations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    goal_id uuid NOT NULL,
    account_id uuid,
    transaction_id uuid,
    operation_id uuid NOT NULL DEFAULT gen_random_uuid(),
    idempotency_key text,
    amount_cents bigint NOT NULL CHECK (amount_cents <> 0),
    kind text NOT NULL CHECK (kind IN ('opening', 'manual', 'transfer', 'allocation', 'release', 'reallocation')),
    occurred_on date NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),

    FOREIGN KEY (user_id, goal_id)
        REFERENCES public.savings_goals (user_id, id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, account_id)
        REFERENCES public.accounts (user_id, id) ON DELETE SET NULL (account_id),
    FOREIGN KEY (user_id, transaction_id)
        REFERENCES public.transactions (user_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX savings_goal_allocations_transaction_idx
    ON public.savings_goal_allocations (transaction_id)
    WHERE transaction_id IS NOT NULL;

CREATE UNIQUE INDEX savings_goal_allocations_idempotency_idx
    ON public.savings_goal_allocations (user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX savings_goal_allocations_goal_account_idx
    ON public.savings_goal_allocations (user_id, goal_id, account_id, occurred_on, id);

CREATE INDEX savings_goal_allocations_account_idx
    ON public.savings_goal_allocations (user_id, account_id, occurred_on, id)
    WHERE account_id IS NOT NULL;

-- +goose StatementBegin
CREATE FUNCTION public.enforce_savings_allocation_currency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    allocation_currency text;
BEGIN
    IF NEW.account_id IS NULL THEN
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text, 0));

    SELECT currency INTO allocation_currency
    FROM public.accounts
    WHERE user_id = NEW.user_id AND id = NEW.account_id;

    IF EXISTS (
        SELECT 1
        FROM public.savings_goal_allocations existing
        JOIN public.accounts account
            ON account.user_id = existing.user_id AND account.id = existing.account_id
        WHERE existing.user_id = NEW.user_id
          AND account.currency <> allocation_currency
    ) THEN
        RAISE EXCEPTION 'savings allocations must use one currency per user'
            USING ERRCODE = '23514', CONSTRAINT = 'savings_goal_allocations_currency_guard';
    END IF;

    RETURN NEW;
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER savings_goal_allocations_currency_guard
    BEFORE INSERT OR UPDATE OF account_id
    ON public.savings_goal_allocations
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_savings_allocation_currency();

ALTER TABLE public.savings_goal_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.savings_goal_allocations FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.savings_goal_allocations FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.savings_goal_allocations TO budg_api;

CREATE POLICY savings_goal_allocations_user_scoped ON public.savings_goal_allocations
    FOR ALL
    TO budg_api
    USING (user_id::text = current_setting('app.user_id', true))
    WITH CHECK (user_id::text = current_setting('app.user_id', true));

-- +goose Down
DROP TABLE public.savings_goal_allocations;
DROP FUNCTION public.enforce_savings_allocation_currency();
