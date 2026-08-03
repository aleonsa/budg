-- +goose Up
ALTER TABLE public.account_balance_entries
    DROP CONSTRAINT account_balance_entries_kind_check;

ALTER TABLE public.account_balance_entries
    ADD COLUMN msi_purchase_id uuid,
    ADD CONSTRAINT account_balance_entries_msi_purchase_same_user
        FOREIGN KEY (user_id, msi_purchase_id)
        REFERENCES public.msi_purchases (user_id, id)
        ON DELETE CASCADE,
    ADD CONSTRAINT account_balance_entries_kind_check
        CHECK (kind IN ('opening', 'transaction', 'reconciliation', 'msi_purchase')),
    ADD CONSTRAINT account_balance_entries_source_check
        CHECK (
            (kind = 'transaction' AND transaction_id IS NOT NULL AND msi_purchase_id IS NULL)
            OR (kind = 'msi_purchase' AND transaction_id IS NULL AND msi_purchase_id IS NOT NULL)
            OR (kind IN ('opening', 'reconciliation') AND transaction_id IS NULL AND msi_purchase_id IS NULL)
        );

CREATE UNIQUE INDEX account_balance_entries_msi_purchase_idx
    ON public.account_balance_entries (msi_purchase_id)
    WHERE msi_purchase_id IS NOT NULL;

ALTER TABLE public.msi_purchases
    ADD COLUMN idempotency_key text;

CREATE UNIQUE INDEX msi_purchases_user_idempotency_key_idx
    ON public.msi_purchases (user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- The column predated its parent table and was historically unconstrained.
-- Detach invalid links before enforcing same-user ownership; the transaction
-- remains as an ordinary historical movement.
UPDATE public.transactions AS transaction
SET msi_purchase_id = NULL
WHERE transaction.msi_purchase_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM public.msi_purchases AS purchase
      WHERE purchase.user_id = transaction.user_id
        AND purchase.id = transaction.msi_purchase_id
  );

ALTER TABLE public.transactions
    ADD CONSTRAINT transactions_msi_purchase_same_user
        FOREIGN KEY (user_id, msi_purchase_id)
        REFERENCES public.msi_purchases (user_id, id)
        ON DELETE CASCADE;

-- +goose Down
ALTER TABLE public.transactions
    DROP CONSTRAINT transactions_msi_purchase_same_user;

UPDATE public.accounts AS account
SET available_credit_cents = account.available_credit_cents - effects.delta_cents,
    updated_at = now()
FROM (
    SELECT account_id, sum(delta_cents) AS delta_cents
    FROM public.account_balance_entries
    WHERE kind = 'msi_purchase'
    GROUP BY account_id
) AS effects
WHERE account.id = effects.account_id;

DELETE FROM public.account_balance_entries WHERE kind = 'msi_purchase';

DROP INDEX IF EXISTS public.msi_purchases_user_idempotency_key_idx;

ALTER TABLE public.msi_purchases
    DROP COLUMN idempotency_key;

DROP INDEX IF EXISTS public.account_balance_entries_msi_purchase_idx;

ALTER TABLE public.account_balance_entries
    DROP CONSTRAINT account_balance_entries_source_check,
    DROP CONSTRAINT account_balance_entries_kind_check,
    DROP CONSTRAINT account_balance_entries_msi_purchase_same_user,
    DROP COLUMN msi_purchase_id,
    ADD CONSTRAINT account_balance_entries_kind_check
        CHECK (kind IN ('opening', 'transaction', 'reconciliation'));
