-- +goose Up
CREATE TABLE public.accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    name text NOT NULL CHECK (btrim(name) <> ''),
    type text NOT NULL CHECK (type IN ('debit', 'credit')),
    institution text NOT NULL CHECK (btrim(institution) <> ''),
    last4 text NOT NULL CHECK (last4 ~ '^[0-9]{4}$'),
    currency text NOT NULL CHECK (currency IN ('MXN', 'USD')),

    -- debit-only
    balance_cents bigint,

    -- credit-only
    credit_limit_cents bigint CHECK (credit_limit_cents IS NULL OR credit_limit_cents >= 0),
    available_credit_cents bigint CHECK (available_credit_cents IS NULL OR available_credit_cents >= 0),
    statement_cut_day smallint CHECK (statement_cut_day IS NULL OR statement_cut_day BETWEEN 1 AND 28),
    payment_due_day smallint CHECK (payment_due_day IS NULL OR payment_due_day BETWEEN 1 AND 31),

    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    -- Lets a future FK (e.g. transactions.account_id) enforce same-user
    -- ownership at the database level, mirroring categories_parent_same_user.
    UNIQUE (user_id, id),

    -- Debit accounts carry a balance and no credit fields; credit accounts
    -- carry credit fields and no balance. Keeps the two shapes honest at the
    -- schema level instead of relying only on application code.
    CONSTRAINT accounts_type_fields CHECK (
        (
            type = 'debit'
            AND credit_limit_cents IS NULL
            AND available_credit_cents IS NULL
            AND statement_cut_day IS NULL
            AND payment_due_day IS NULL
        )
        OR (
            type = 'credit'
            AND balance_cents IS NULL
        )
    )
);

CREATE INDEX accounts_user_idx ON public.accounts (user_id, name);

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.accounts FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.accounts TO budg_api;

-- See migrations/00002_categories_rls_policies.sql for why this compares as
-- text rather than casting current_setting(...) to uuid.
CREATE POLICY accounts_user_scoped ON public.accounts
    FOR ALL
    TO budg_api
    USING (user_id::text = current_setting('app.user_id', true))
    WITH CHECK (user_id::text = current_setting('app.user_id', true));

-- +goose Down
DROP TABLE public.accounts;
