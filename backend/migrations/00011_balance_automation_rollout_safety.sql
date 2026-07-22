-- +goose Up
-- Transactions created after 00010 but before deployment of the balance engine
-- used the database default true without creating matching ledger entries. Mark
-- every such row historical-only so later edits cannot apply or reverse a
-- balance effect that never happened.
ALTER TABLE public.transactions
    ALTER COLUMN affects_balance SET DEFAULT false;

UPDATE public.transactions AS tx_row
SET affects_balance = false
WHERE tx_row.affects_balance
  AND NOT EXISTS (
      SELECT 1
      FROM public.account_balance_entries AS entry
      WHERE entry.transaction_id = tx_row.id
  );

-- +goose Down
-- Intentionally irreversible: the affected rows cannot be distinguished from
-- deliberately historical transactions after this safety correction.
ALTER TABLE public.transactions
    ALTER COLUMN affects_balance SET DEFAULT true;

SELECT 1;
