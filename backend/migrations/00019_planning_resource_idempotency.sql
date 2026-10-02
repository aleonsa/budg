-- +goose Up
CREATE TABLE public.create_idempotency_receipts (
    user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    idempotency_key text NOT NULL,
    resource_type text NOT NULL CHECK (
        resource_type IN ('transaction', 'budget', 'savings_goal', 'recurring_transaction', 'msi_purchase')
    ),
    request_hash text NOT NULL,
    resource_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, resource_type, idempotency_key)
);

ALTER TABLE public.create_idempotency_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.create_idempotency_receipts FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.create_idempotency_receipts FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.create_idempotency_receipts TO budg_api;

CREATE POLICY create_idempotency_receipts_user_scoped ON public.create_idempotency_receipts
    FOR ALL
    TO budg_api
    USING (user_id::text = current_setting('app.user_id', true))
    WITH CHECK (user_id::text = current_setting('app.user_id', true));

-- +goose Down
DROP TABLE public.create_idempotency_receipts;
