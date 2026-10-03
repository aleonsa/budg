-- +goose Up
-- Savings yields: an optional annual rate per debit account, a yield
-- reconciliation log, and goal allocations that distribute earned yield.
ALTER TABLE public.accounts
    ADD COLUMN annual_yield_bps integer,
    ADD COLUMN yield_reconciled_on date,
    ADD CONSTRAINT accounts_annual_yield_bps_range
        CHECK (annual_yield_bps IS NULL OR annual_yield_bps BETWEEN 0 AND 10000),
    ADD CONSTRAINT accounts_annual_yield_debit_only
        CHECK (annual_yield_bps IS NULL OR type = 'debit');

ALTER TABLE public.savings_goal_allocations
    DROP CONSTRAINT savings_goal_allocations_kind_check,
    ADD CONSTRAINT savings_goal_allocations_kind_check
        CHECK (kind IN ('opening', 'manual', 'transfer', 'allocation', 'release', 'reallocation', 'yield'));

-- Bug fix: a bare SET NULL on the composite (user_id, account_id) key also
-- nulls user_id, so deleting an account linked to a goal violated NOT NULL.
-- Only the account reference should be cleared.
ALTER TABLE public.savings_goals
    DROP CONSTRAINT savings_goals_account_same_user,
    ADD CONSTRAINT savings_goals_account_same_user
        FOREIGN KEY (user_id, account_id)
        REFERENCES public.accounts (user_id, id)
        ON DELETE SET NULL (account_id);

ALTER TABLE public.create_idempotency_receipts
    DROP CONSTRAINT create_idempotency_receipts_resource_type_check,
    ADD CONSTRAINT create_idempotency_receipts_resource_type_check
        CHECK (resource_type IN (
            'transaction', 'budget', 'savings_goal', 'recurring_transaction',
            'msi_purchase', 'yield_reconciliation'
        ));

CREATE TABLE public.account_yield_reconciliations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    account_id uuid NOT NULL,
    transaction_id uuid,
    operation_id uuid NOT NULL DEFAULT gen_random_uuid(),
    occurred_on date NOT NULL,
    period_start date NOT NULL,
    balance_before_cents bigint NOT NULL,
    balance_after_cents bigint NOT NULL,
    yield_cents bigint NOT NULL CHECK (yield_cents >= 0),
    adjustment_cents bigint NOT NULL,
    estimated_yield_cents bigint NOT NULL,
    annual_yield_bps integer,
    created_at timestamptz NOT NULL DEFAULT now(),

    CHECK (period_start <= occurred_on),
    CHECK (balance_after_cents = balance_before_cents + yield_cents + adjustment_cents),
    FOREIGN KEY (user_id, account_id)
        REFERENCES public.accounts (user_id, id) ON DELETE CASCADE,
    -- NO ACTION (checked at statement end) blocks deleting the yield
    -- transaction directly while still letting account/user cascades remove
    -- both rows together.
    FOREIGN KEY (user_id, transaction_id)
        REFERENCES public.transactions (user_id, id)
);

CREATE UNIQUE INDEX account_yield_reconciliations_transaction_idx
    ON public.account_yield_reconciliations (transaction_id)
    WHERE transaction_id IS NOT NULL;

CREATE INDEX account_yield_reconciliations_account_idx
    ON public.account_yield_reconciliations (user_id, account_id, occurred_on DESC, created_at DESC);

ALTER TABLE public.account_yield_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_yield_reconciliations FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.account_yield_reconciliations FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.account_yield_reconciliations TO budg_api;

CREATE POLICY account_yield_reconciliations_user_scoped ON public.account_yield_reconciliations
    FOR ALL
    TO budg_api
    USING (user_id::text = current_setting('app.user_id', true))
    WITH CHECK (user_id::text = current_setting('app.user_id', true));

-- +goose Down
DROP TABLE public.account_yield_reconciliations;

DELETE FROM public.create_idempotency_receipts WHERE resource_type = 'yield_reconciliation';
ALTER TABLE public.create_idempotency_receipts
    DROP CONSTRAINT create_idempotency_receipts_resource_type_check,
    ADD CONSTRAINT create_idempotency_receipts_resource_type_check
        CHECK (resource_type IN ('transaction', 'budget', 'savings_goal', 'recurring_transaction', 'msi_purchase'));

-- Yield allocations cannot survive without their kind; reverse their effect
-- on goal balances before removing them. Lossy by design: if a goal was
-- reduced after receiving yield, its amount is clamped at zero.
UPDATE public.savings_goals AS goal
SET current_amount = GREATEST(0, goal.current_amount - yields.amount),
    is_completed = GREATEST(0, goal.current_amount - yields.amount) >= goal.target_amount,
    updated_at = now()
FROM (
    SELECT user_id, goal_id, SUM(amount_cents) AS amount
    FROM public.savings_goal_allocations
    WHERE kind = 'yield'
    GROUP BY user_id, goal_id
) AS yields
WHERE goal.user_id = yields.user_id AND goal.id = yields.goal_id;
DELETE FROM public.savings_goal_allocations WHERE kind = 'yield';
ALTER TABLE public.savings_goal_allocations
    DROP CONSTRAINT savings_goal_allocations_kind_check,
    ADD CONSTRAINT savings_goal_allocations_kind_check
        CHECK (kind IN ('opening', 'manual', 'transfer', 'allocation', 'release', 'reallocation'));

ALTER TABLE public.savings_goals
    DROP CONSTRAINT savings_goals_account_same_user,
    ADD CONSTRAINT savings_goals_account_same_user
        FOREIGN KEY (user_id, account_id)
        REFERENCES public.accounts (user_id, id)
        ON DELETE SET NULL;

ALTER TABLE public.accounts
    DROP CONSTRAINT accounts_annual_yield_debit_only,
    DROP CONSTRAINT accounts_annual_yield_bps_range,
    DROP COLUMN yield_reconciled_on,
    DROP COLUMN annual_yield_bps;
