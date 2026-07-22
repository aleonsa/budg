-- +goose Up
CREATE TABLE public.recurring_transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    account_id uuid NOT NULL,
    category_id uuid,
    description text NOT NULL CHECK (btrim(description) <> ''),
    merchant text CHECK (merchant IS NULL OR btrim(merchant) <> ''),
    amount bigint NOT NULL CHECK (amount > 0),
    frequency text NOT NULL CHECK (frequency IN ('monthly', 'yearly')),
    start_date date NOT NULL,
    next_date date NOT NULL,
    occurrences_generated integer NOT NULL DEFAULT 0 CHECK (occurrences_generated >= 0),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    UNIQUE (user_id, id),
    CONSTRAINT recurring_transactions_account_same_user
        FOREIGN KEY (user_id, account_id)
        REFERENCES public.accounts (user_id, id)
        ON DELETE CASCADE,
    CONSTRAINT recurring_transactions_category_same_user
        FOREIGN KEY (user_id, category_id)
        REFERENCES public.categories (user_id, id)
        ON DELETE SET NULL
);

CREATE INDEX recurring_transactions_user_next_date_idx
    ON public.recurring_transactions (user_id, next_date)
    WHERE is_active;

ALTER TABLE public.recurring_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_transactions FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.recurring_transactions FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.recurring_transactions TO budg_api;

CREATE POLICY recurring_transactions_user_scoped ON public.recurring_transactions
    FOR ALL
    TO budg_api
    USING (user_id::text = current_setting('app.user_id', true))
    WITH CHECK (user_id::text = current_setting('app.user_id', true));

-- +goose Down
DROP TABLE public.recurring_transactions;
