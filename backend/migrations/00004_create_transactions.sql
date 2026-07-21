-- +goose Up
CREATE TABLE public.transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    account_id uuid NOT NULL,
    type text NOT NULL CHECK (type IN ('expense', 'income', 'transfer')),
    amount bigint NOT NULL CHECK (amount > 0),
    category_id uuid,
    date date NOT NULL,
    description text NOT NULL CHECK (btrim(description) <> ''),
    merchant text CHECK (merchant IS NULL OR btrim(merchant) <> ''),
    msi_purchase_id uuid,
    transfer_to_account_id uuid,
    is_reconciled boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    -- Same-user foreign key enforcement using the UNIQUE (user_id, id) keys
    -- on accounts and categories.
    CONSTRAINT transactions_account_same_user
        FOREIGN KEY (user_id, account_id)
        REFERENCES public.accounts (user_id, id)
        ON DELETE RESTRICT,

    CONSTRAINT transactions_category_same_user
        FOREIGN KEY (user_id, category_id)
        REFERENCES public.categories (user_id, id)
        ON DELETE SET NULL,

    CONSTRAINT transactions_transfer_account_same_user
        FOREIGN KEY (user_id, transfer_to_account_id)
        REFERENCES public.accounts (user_id, id)
        ON DELETE RESTRICT,

    -- Business logic shape constraints
    CONSTRAINT transactions_transfer_shape CHECK (
        (type = 'transfer' AND transfer_to_account_id IS NOT NULL AND transfer_to_account_id <> account_id AND category_id IS NULL)
        OR
        (type <> 'transfer' AND transfer_to_account_id IS NULL)
    )
);

CREATE INDEX transactions_user_date_idx
    ON public.transactions (user_id, date DESC, id DESC);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.transactions FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.transactions TO budg_api;

CREATE POLICY transactions_user_scoped ON public.transactions
    FOR ALL
    TO budg_api
    USING (user_id::text = current_setting('app.user_id', true))
    WITH CHECK (user_id::text = current_setting('app.user_id', true));

-- +goose Down
DROP TABLE public.transactions;
