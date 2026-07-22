# Automatic Account Balance Tracking

Status: Implemented

## Summary

After historical migration and manual reconciliation, budg should update account
balances automatically whenever a transaction is created, edited, or deleted.

Existing imported history must not alter the reconciled current balance. Each
account therefore starts automatic tracking from an explicit user-confirmed
baseline. New transactions affect balances by default; historical backfills can
opt out.

The implementation keeps the current materialized account fields for fast UI
reads and adds an auditable balance ledger so every automatic change can be
explained and reversed.

## Prior Behavior

- Debit account cards read `accounts.balance_cents`.
- Credit account cards derive debt as `credit_limit_cents - available_credit_cents`.
- Transaction create, update, and delete only modify `transactions`.
- Transfers do not update source or destination accounts.
- Imported transactions affect history and statistics but not account cards.

## Goals

- Establish a current balance baseline after historical migration.
- Update debit balances and credit availability automatically for new activity.
- Handle expenses, income, refunds, payments, and transfers consistently.
- Reverse prior effects correctly when a transaction is edited or deleted.
- Keep transaction and account changes atomic.
- Preserve an audit trail for every automatic balance mutation.
- Allow historical backfills that do not affect the current balance.
- Keep account list reads fast without summing all transaction history.

## Non-Goals

- Bank synchronization or statement ingestion.
- Currency conversion or cross-currency transfers.
- Replaying imported history to calculate the initial current balance.
- Double-entry accounting outside the user's budg accounts.
- Automatically resolving reconciliation differences with a bank.
- Changing budget or spending-statistics semantics.

## Balance Semantics

Budg tracks available funds for both account types:

| Account type | Materialized field | Meaning |
| --- | --- | --- |
| Debit | `balance_cents` | Cash currently available |
| Credit | `available_credit_cents` | Credit currently available |

This gives both account types the same signed transaction effects:

| Transaction | Source account delta | Destination account delta |
| --- | ---: | ---: |
| Expense | `-amount` | N/A |
| Income/refund | `+amount` | N/A |
| Transfer | `-amount` | `+amount` |

Examples:

- Debit purchase: debit balance decreases.
- Credit purchase: available credit decreases and displayed debt increases.
- Credit refund: available credit increases and displayed debt decreases.
- Debit-to-credit payment: debit balance decreases; available credit increases.
- Credit cash advance to debit: available credit decreases; debit balance increases.

Negative debit balances remain valid. Credit availability may become negative
for over-limit debt or exceed the credit limit after an overpayment. The current
`available_credit_cents >= 0` constraint must therefore be relaxed.

## Activation Model

Automatic tracking is disabled by default for every existing account.

After migration is complete, the user reconciles each account and enables
tracking with its real current value:

- Debit: current bank balance.
- Credit: current available credit.

Enabling tracking creates an opening ledger entry and updates the materialized
field in one database transaction. Existing transactions are not replayed.

Once enabled:

- New transactions affect the balance by default.
- A transaction created with `affectsBalance: false` remains historical only.
- Enabling another account later does not replay transfers created before that
  account was enabled.
- Tracking cannot be disabled in v1. A user can reconcile the balance instead.

## Database Design

### Accounts

Add:

```sql
ALTER TABLE public.accounts
    ADD COLUMN balance_tracking_enabled boolean NOT NULL DEFAULT false,
    ADD COLUMN balance_tracking_started_at timestamptz;
```

Rules:

- `balance_tracking_started_at` is null while tracking is disabled.
- Enabling tracking sets both fields atomically.
- A tracked debit account requires non-null `balance_cents`.
- A tracked credit account requires non-null `credit_limit_cents` and
  `available_credit_cents`.
- Remove the non-negative constraint from `available_credit_cents`.

### Transactions

Add:

```sql
ALTER TABLE public.transactions
    ADD COLUMN affects_balance boolean;

UPDATE public.transactions SET affects_balance = false;

ALTER TABLE public.transactions
    ALTER COLUMN affects_balance SET NOT NULL,
    ALTER COLUMN affects_balance SET DEFAULT true;
```

All transactions existing when the migration runs become historical-only.
New API-created transactions default to affecting balances.

### Account Balance Entries

Add an append-oriented audit table:

```sql
CREATE TABLE public.account_balance_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    account_id uuid NOT NULL,
    transaction_id uuid,
    kind text NOT NULL CHECK (kind IN ('opening', 'transaction', 'reconciliation')),
    delta_cents bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),

    FOREIGN KEY (user_id, account_id)
        REFERENCES public.accounts (user_id, id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, transaction_id)
        REFERENCES public.transactions (user_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX account_balance_entries_transaction_account_idx
    ON public.account_balance_entries (transaction_id, account_id)
    WHERE transaction_id IS NOT NULL;

CREATE INDEX account_balance_entries_user_account_created_idx
    ON public.account_balance_entries (user_id, account_id, created_at, id);
```

Enable and force RLS. Grant only `budg_api`. Use the same user-scoped policy as
accounts and transactions.

Ledger invariants:

- Opening entry delta equals the confirmed available amount at activation.
- Transaction entries contain the signed effect for one account.
- Transfers create up to two entries, one for each tracking-enabled side.
- Reconciliation entry delta equals `confirmed amount - current amount`.
- Opening plus subsequent deltas equals the materialized account value.
- At most one transaction entry exists per transaction/account pair.

## Transaction Mutation Algorithm

Every balance-affecting transaction mutation runs in one PostgreSQL transaction.

### Account Locking

1. Determine every account affected by old and new transaction shapes.
2. Sort account UUIDs lexicographically.
3. Lock accounts in that order using `SELECT ... FOR UPDATE`.
4. Validate ownership, account type, currency, and tracking state.

Stable lock order prevents deadlocks when concurrent transfers touch the same
accounts in opposite directions.

### Create

1. Insert transaction.
2. If `affects_balance` is false, stop.
3. Compute effects from transaction type.
4. For each tracking-enabled account, insert ledger entry and update its
   materialized value by the same delta.
5. Return transaction and updated account data after commit.

### Update

1. Lock existing transaction and all old/new affected accounts.
2. Reverse each existing ledger effect from materialized account values.
3. Delete old transaction ledger entries.
4. Apply transaction patch.
5. Recompute and apply new effects when `affects_balance` is true.
6. Commit transaction, ledger, and account snapshots together.

Changing only description, merchant, category, or date produces no balance
delta, but the same generic algorithm is acceptable initially.

### Delete

1. Lock transaction and affected accounts.
2. Reverse existing ledger effects.
3. Delete transaction; ledger rows cascade.
4. Commit account and transaction changes together.

### Failure Behavior

- Any validation, ledger, or account update failure rolls back everything.
- API never returns success before transaction commit.
- Retrying a failed client request must not silently create duplicates. A future
  idempotency key can improve this, but is separate from balance correctness.

## Account Reconciliation

Tracked balances cannot be edited through generic account PATCH fields.

Add:

```http
POST /v1/accounts/{id}/reconcile-balance
Content-Type: application/json

{
  "currentAmount": 123450
}
```

`currentAmount` means debit balance or credit available credit according to
account type.

Behavior:

1. Lock account.
2. Calculate delta from current materialized value.
3. Insert `reconciliation` ledger entry, including zero only if product wants an
   explicit confirmation event; otherwise return no-op.
4. Update materialized field.
5. Return updated account.

Reconciliation entries do not appear as income or expense and do not affect
budgets/statistics.

## API Changes

### Account Response

Add:

```json
{
  "balanceTrackingEnabled": true,
  "balanceTrackingStartedAt": "2026-08-01T12:00:00Z"
}
```

### Enable Tracking

```http
POST /v1/accounts/{id}/balance-tracking
Content-Type: application/json

{
  "currentAmount": 123450
}
```

Responses:

- `200`: tracking enabled; updated account returned.
- `400`: invalid amount/account shape.
- `404`: account not owned by user.
- `409`: tracking already enabled.

### Transaction Writes

Add optional field:

```json
{
  "affectsBalance": true
}
```

Rules:

- Omitted on create: defaults to true.
- Existing migrated rows return false.
- PATCH false to true applies effect using current transaction shape.
- PATCH true to false reverses prior effect.
- Transfer applies only to sides whose accounts have tracking enabled.

### Account PATCH

When tracking is enabled:

- Reject direct `balance` changes for debit accounts with `409`.
- Reject direct `availableCredit` changes for credit accounts with `409`.
- Direct users to reconciliation endpoint.
- Credit-limit changes remain allowed and do not change available credit.

## Frontend Changes

### Account Setup

- Show "Activar saldo automático" on untracked accounts.
- Explain that imported history will not be replayed.
- Ask for current debit balance or current available credit.
- Show a final confirmation before activation.

### Account Detail

- Show tracking status and activation timestamp.
- Add "Conciliar saldo" action.
- Label credit value clearly as available credit, with debt still derived as
  `creditLimit - availableCredit`.

### Transaction Form

- New transactions default "Afectar saldo" to on.
- Put opt-out under advanced options for historical backfills.
- Transfers explain effects on source and destination.
- Avoid optimistic account-balance updates initially; invalidate account and
  transaction queries after successful mutation.

### Imported History

- Existing migrated transactions display normally with `affectsBalance: false`.
- Optional badge "Histórico" can explain why editing old rows does not affect
  balance until toggle is enabled.

## Rollout Plan

1. Add schema fields and ledger table.
2. Backfill every existing transaction with `affects_balance = false`.
3. Deploy backend reads with tracking disabled for all accounts.
4. Deploy atomic create/update/delete balance effects.
5. Deploy activation and reconciliation endpoints.
6. Deploy frontend activation/reconciliation UI.
7. Finish historical migration and manually verify account snapshots.
8. Enable tracking account by account.

No historical transaction should gain a ledger entry during rollout.

## Testing Requirements

### Store Integration

- Debit expense decreases balance.
- Debit income increases balance.
- Credit expense decreases available credit.
- Credit refund increases available credit.
- Debit-to-credit payment updates both sides.
- Credit-to-debit cash advance updates both sides.
- Transfer with one untracked side updates only tracked side.
- `affectsBalance: false` creates no ledger entries.
- Update reverses old amount/accounts/type before applying new shape.
- Delete reverses effects exactly once.
- Reconciliation creates correct delta.
- Existing historical rows remain effect-free after migration.
- Concurrent opposite transfers do not deadlock or lose updates.
- Store failure rolls back transaction, ledger, and account snapshot.
- RLS prevents cross-user account and ledger access.

### HTTP

- Create defaults `affectsBalance` to true.
- Invalid transfer shape remains `400`.
- Direct balance PATCH on tracked account returns `409`.
- Reconciliation and activation validate account ownership.
- Repeated activation returns `409` without a second opening entry.

### Frontend

- Activation uses correct label for debit versus credit.
- Successful mutations invalidate account and transaction queries.
- Failed mutations leave displayed balances unchanged after refetch.
- Historical toggle is sent correctly.
- Reconciliation shows resulting balance/debt correctly.

## Acceptance Criteria

- User can set each reconciled current balance once and enable tracking.
- Historical imported transactions do not change that baseline.
- Every subsequent balance-affecting transaction updates account cards after
  refetch.
- Editing or deleting a transaction leaves balances equal to applying the new
  ledger state exactly once.
- Transfers update source and destination atomically.
- Every automatic balance change is traceable to one ledger entry.
- User can reconcile drift without creating fake income or expenses.
- Rollback of any failed mutation leaves no partial transaction or balance
  change.

## Implementation Order

1. Migration and account/transaction model fields.
2. Balance-effect calculator as pure Go functions with table tests.
3. Repository transaction locking and ledger writes.
4. Activation and reconciliation repository methods.
5. HTTP contract and tests.
6. Frontend API/types/query invalidation.
7. Account activation and reconciliation UI.
8. Production migration, manual snapshot confirmation, staged activation.
