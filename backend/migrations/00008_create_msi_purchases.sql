-- +goose Up
CREATE TABLE public.msi_purchases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    account_id uuid NOT NULL,
    category_id uuid,
    description text NOT NULL CHECK (btrim(description) <> ''),
    merchant text CHECK (merchant IS NULL OR btrim(merchant) <> ''),
    total_amount bigint NOT NULL CHECK (total_amount > 0),
    installment_amount bigint NOT NULL CHECK (installment_amount > 0),
    installment_count integer NOT NULL CHECK (installment_count > 0),
    installments_paid integer NOT NULL DEFAULT 0 CHECK (installments_paid >= 0),
    start_date date NOT NULL,
    next_installment_date date,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    UNIQUE (user_id, id),

    -- An MSI purchase without its credit account makes no sense; deleting
    -- the account deletes the purchase too.
    CONSTRAINT msi_purchases_account_same_user
        FOREIGN KEY (user_id, account_id)
        REFERENCES public.accounts (user_id, id)
        ON DELETE CASCADE,

    CONSTRAINT msi_purchases_category_same_user
        FOREIGN KEY (user_id, category_id)
        REFERENCES public.categories (user_id, id)
        ON DELETE SET NULL,

    CONSTRAINT msi_purchases_installments_paid_bound
        CHECK (installments_paid <= installment_count)
);

CREATE INDEX msi_purchases_user_idx
    ON public.msi_purchases (user_id);

ALTER TABLE public.msi_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.msi_purchases FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.msi_purchases FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.msi_purchases TO budg_api;

CREATE POLICY msi_purchases_user_scoped ON public.msi_purchases
    FOR ALL
    TO budg_api
    USING (user_id::text = current_setting('app.user_id', true))
    WITH CHECK (user_id::text = current_setting('app.user_id', true));

-- +goose Down
DROP TABLE public.msi_purchases;
