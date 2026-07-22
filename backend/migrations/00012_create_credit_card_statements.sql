-- +goose Up
CREATE TABLE public.credit_card_statements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    account_id uuid NOT NULL,
    cycle_start_date date NOT NULL,
    cycle_end_date date NOT NULL,
    payment_due_date date NOT NULL,
    statement_balance_cents bigint NOT NULL CHECK (statement_balance_cents >= 0),
    minimum_payment_cents bigint CHECK (minimum_payment_cents >= 0),
    confirmed_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    UNIQUE (user_id, id),
    CONSTRAINT credit_card_statements_account_same_user
        FOREIGN KEY (user_id, account_id)
        REFERENCES public.accounts (user_id, id)
        ON DELETE CASCADE,
    CONSTRAINT credit_card_statements_cycle_dates
        CHECK (cycle_start_date <= cycle_end_date),
    CONSTRAINT credit_card_statements_due_date
        CHECK (payment_due_date > cycle_end_date),
    CONSTRAINT credit_card_statements_account_cycle_unique
        UNIQUE (account_id, cycle_end_date)
);

CREATE INDEX credit_card_statements_user_account_cycle_idx
    ON public.credit_card_statements (user_id, account_id, cycle_end_date DESC);

CREATE INDEX credit_card_statements_user_due_idx
    ON public.credit_card_statements (user_id, payment_due_date);

ALTER TABLE public.credit_card_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_card_statements FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.credit_card_statements FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.credit_card_statements TO budg_api;

CREATE POLICY credit_card_statements_user_scoped ON public.credit_card_statements
    FOR ALL
    TO budg_api
    USING (user_id::text = current_setting('app.user_id', true))
    WITH CHECK (user_id::text = current_setting('app.user_id', true));

ALTER TABLE public.transactions
    ADD COLUMN credit_card_statement_id uuid,
    ADD CONSTRAINT transactions_credit_card_statement_same_user
        FOREIGN KEY (user_id, credit_card_statement_id)
        REFERENCES public.credit_card_statements (user_id, id)
        ON DELETE SET NULL (credit_card_statement_id),
    ADD CONSTRAINT transactions_credit_card_statement_shape
        CHECK (credit_card_statement_id IS NULL OR (type = 'transfer' AND affects_balance));

CREATE INDEX transactions_credit_card_statement_idx
    ON public.transactions (credit_card_statement_id)
    WHERE credit_card_statement_id IS NOT NULL;

-- +goose Down
ALTER TABLE public.transactions
    DROP COLUMN credit_card_statement_id;

DROP TABLE public.credit_card_statements;
