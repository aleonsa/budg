-- +goose Up
ALTER TABLE public.transactions
    ADD COLUMN idempotency_key text;

CREATE UNIQUE INDEX transactions_user_idempotency_key_idx
    ON public.transactions (user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- +goose Down
DROP INDEX public.transactions_user_idempotency_key_idx;

ALTER TABLE public.transactions
    DROP COLUMN idempotency_key;
