-- +goose Up
CREATE TABLE public.loans (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    account_id uuid NOT NULL,
    description text NOT NULL CHECK (btrim(description) <> ''),
    lender text,
    principal_cents bigint NOT NULL CHECK (principal_cents > 0),
    annual_rate_bps integer NOT NULL CHECK (annual_rate_bps >= 0 AND annual_rate_bps <= 100000),
    term_months integer NOT NULL CHECK (term_months BETWEEN 1 AND 600),
    monthly_payment_cents bigint NOT NULL CHECK (monthly_payment_cents > 0),
    start_date date NOT NULL,
    day_of_month smallint NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paid_off')),
    idempotency_key text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    UNIQUE (user_id, id),
    FOREIGN KEY (user_id, account_id)
        REFERENCES public.accounts (user_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX loans_idempotency_idx
    ON public.loans (user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX loans_user_idx
    ON public.loans (user_id, start_date DESC, id);

CREATE TABLE public.loan_payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    loan_id uuid NOT NULL,
    sequence integer NOT NULL,
    due_date date NOT NULL,
    principal_cents bigint NOT NULL CHECK (principal_cents >= 0),
    interest_cents bigint NOT NULL CHECK (interest_cents >= 0),
    total_cents bigint NOT NULL CHECK (total_cents >= 0),
    -- signed: reconciliation adjustments may be negative when the bank
    -- reports a higher balance than the tracked schedule
    paid_principal_cents bigint,
    paid_interest_cents bigint CHECK (paid_interest_cents IS NULL OR paid_interest_cents >= 0),
    paid_total_cents bigint CHECK (paid_total_cents IS NULL OR paid_total_cents >= 0),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'adjustment')),
    transaction_id uuid,
    paid_at date,
    idempotency_key text,
    created_at timestamptz NOT NULL DEFAULT now(),

    CHECK (total_cents = principal_cents + interest_cents),
    CHECK (
        (status = 'pending' AND sequence > 0 AND paid_principal_cents IS NULL AND paid_interest_cents IS NULL AND paid_total_cents IS NULL AND paid_at IS NULL AND transaction_id IS NULL)
        OR (status = 'paid' AND sequence >= 0 AND paid_principal_cents >= 0 AND paid_principal_cents IS NOT NULL AND paid_total_cents IS NOT NULL AND paid_total_cents >= paid_principal_cents + COALESCE(paid_interest_cents, 0) AND transaction_id IS NOT NULL AND paid_at IS NOT NULL)
        OR (status = 'adjustment' AND sequence = -1 AND paid_principal_cents IS NOT NULL AND paid_total_cents = 0 AND transaction_id IS NULL AND paid_at IS NOT NULL)
    ),
    FOREIGN KEY (user_id, loan_id)
        REFERENCES public.loans (user_id, id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, transaction_id)
        REFERENCES public.transactions (user_id, id) ON DELETE NO ACTION
);

CREATE UNIQUE INDEX loan_payments_loan_sequence_idx
    ON public.loan_payments (loan_id, sequence)
    WHERE sequence > 0;

CREATE UNIQUE INDEX loan_payments_transaction_idx ON public.loan_payments (transaction_id) WHERE transaction_id IS NOT NULL;

ALTER TABLE public.create_idempotency_receipts DROP CONSTRAINT create_idempotency_receipts_resource_type_check;
ALTER TABLE public.create_idempotency_receipts ADD CONSTRAINT create_idempotency_receipts_resource_type_check CHECK (resource_type IN ('transaction', 'budget', 'savings_goal', 'recurring_transaction', 'msi_purchase', 'yield_reconciliation', 'loan', 'loan_extra'));

CREATE INDEX loan_payments_user_loan_idx
    ON public.loan_payments (user_id, loan_id, due_date, sequence);

ALTER TABLE public.loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loans FORCE ROW LEVEL SECURITY;
ALTER TABLE public.loan_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_payments FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.loans FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.loans TO budg_api;
REVOKE ALL ON TABLE public.loan_payments FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.loan_payments TO budg_api;

CREATE POLICY loans_user_scoped ON public.loans
    FOR ALL
    TO budg_api
    USING (user_id::text = current_setting('app.user_id', true))
    WITH CHECK (user_id::text = current_setting('app.user_id', true));

CREATE POLICY loan_payments_user_scoped ON public.loan_payments
    FOR ALL
    TO budg_api
    USING (user_id::text = current_setting('app.user_id', true))
    WITH CHECK (user_id::text = current_setting('app.user_id', true));

-- +goose Down
DROP TABLE public.loan_payments;
DROP TABLE public.loans;
DELETE FROM public.create_idempotency_receipts WHERE resource_type IN ('loan', 'loan_extra');
ALTER TABLE public.create_idempotency_receipts DROP CONSTRAINT create_idempotency_receipts_resource_type_check;
ALTER TABLE public.create_idempotency_receipts ADD CONSTRAINT create_idempotency_receipts_resource_type_check CHECK (resource_type IN ('transaction', 'budget', 'savings_goal', 'recurring_transaction', 'msi_purchase', 'yield_reconciliation'));
