-- +goose Up
-- Add balance tracking fields to accounts. Untracked accounts default to false
-- so existing imported history does not alter current balances until explicitly activated.
ALTER TABLE public.accounts
    ADD COLUMN balance_tracking_enabled boolean NOT NULL DEFAULT false,
    ADD COLUMN balance_tracking_started_at timestamptz;

-- Relax available credit constraint to allow negative values for over-limit debt
-- or credit card overpayments.
ALTER TABLE public.accounts
    DROP CONSTRAINT IF EXISTS accounts_credit_fields;

ALTER TABLE public.accounts
    ADD CONSTRAINT accounts_credit_fields CHECK (
        (type = 'debit' AND balance_cents IS NOT NULL AND credit_limit_cents IS NULL AND available_credit_cents IS NULL AND statement_cut_day IS NULL AND payment_due_day IS NULL) OR
        (type = 'credit' AND balance_cents IS NULL AND credit_limit_cents IS NOT NULL AND available_credit_cents IS NOT NULL)
    );

-- Add affects_balance flag to transactions. Default existing history to false.
ALTER TABLE public.transactions
    ADD COLUMN affects_balance boolean;

UPDATE public.transactions SET affects_balance = false;

ALTER TABLE public.transactions
    ALTER COLUMN affects_balance SET NOT NULL,
    ALTER COLUMN affects_balance SET DEFAULT true;

-- Append-oriented audit ledger for every automatic balance mutation.
CREATE TABLE public.account_balance_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    account_id uuid NOT NULL,
    transaction_id uuid,
    kind text NOT NULL CHECK (kind IN ('opening', 'transaction', 'reconciliation')),
    delta_cents bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),

    FOREIGN KEY (user_id, account_id)
        REFERENCES public.accounts (user_id, id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, transaction_id)
        REFERENCES public.transactions (user_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX account_balance_entries_transaction_account_idx
    ON public.account_balance_entries (transaction_id, account_id)
    WHERE transaction_id IS NOT NULL;

CREATE INDEX account_balance_entries_user_account_created_idx
    ON public.account_balance_entries (user_id, account_id, created_at, id);

ALTER TABLE public.account_balance_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_balance_entries FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.account_balance_entries FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.account_balance_entries TO budg_api;

CREATE POLICY account_balance_entries_user_scoped ON public.account_balance_entries
    FOR ALL
    TO budg_api
    USING (user_id::text = current_setting('app.user_id', true))
    WITH CHECK (user_id::text = current_setting('app.user_id', true));

-- +goose Down
DROP POLICY IF EXISTS account_balance_entries_user_scoped ON public.account_balance_entries;
REVOKE ALL ON TABLE public.account_balance_entries FROM anon, authenticated, service_role;
DROP TABLE IF EXISTS public.account_balance_entries;

ALTER TABLE public.transactions DROP COLUMN IF EXISTS affects_balance;

ALTER TABLE public.accounts
    DROP CONSTRAINT IF EXISTS accounts_credit_fields;

ALTER TABLE public.accounts
    ADD CONSTRAINT accounts_credit_fields CHECK (
        (type = 'debit' AND balance_cents IS NOT NULL AND credit_limit_cents IS NULL AND available_credit_cents IS NULL AND statement_cut_day IS NULL AND payment_due_day IS NULL) OR
        (type = 'credit' AND balance_cents IS NULL AND credit_limit_cents IS NOT NULL AND available_credit_cents IS NOT NULL AND available_credit_cents >= 0)
    );

ALTER TABLE public.accounts
    DROP COLUMN IF EXISTS balance_tracking_started_at,
    DROP COLUMN IF EXISTS balance_tracking_enabled;
