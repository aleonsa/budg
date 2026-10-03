# API Contract

## Scope

This document defines the initial HTTP contract between the React frontend and
the Go API. The first implementation covers authenticated reads of the base
resources. Writes listed below are reserved for the next phase.

The API uses JSON and is rooted at `/v1`. JSON property names use `camelCase`
to match `frontend/src/types/index.ts`; database columns use `snake_case`.

## Authentication And User Scope

Every `/v1` resource endpoint requires a Supabase access token:

```http
Authorization: Bearer <supabase-access-token>
Accept: application/json
```

The backend verifies the JWT, reads the user UUID from its `sub` claim, and
adds `WHERE user_id = $authenticatedUserID` to every query. Clients must never
send `userId` in a request body, query parameter, or path. A resource owned by
another user is treated as not found.

Postgres RLS is enabled with no direct-client policies, so access through the
Supabase Data API is deny-by-default. The Go API remains the only intended data
access path and must enforce backend user scoping on every query.

## Data Conventions

- IDs are UUID strings.
- Money is an integer number of minor units (cents). For example, `18450`
  represents MXN 184.50. Money is never encoded as a JSON float and must stay
  within JavaScript's safe integer range (`-9007199254740991` through
  `9007199254740991`; fields that cannot be negative have a lower bound of
  zero or one).
- Financial dates use `YYYY-MM-DD` and have no timezone. Examples include
  `date`, `startDate`, `targetDate`, and `nextInstallmentDate`.
- Technical timestamps use RFC 3339 UTC strings, for example
  `2026-07-12T18:30:00Z`.
- Properties typed as `T | null` are returned as `null` when empty. Properties
  marked optional with `?` are omitted when empty.
- Successful collection reads return an empty collection, not `null`.
- Unknown JSON fields in future write requests should be rejected.

`Transaction.createdAt` is a technical timestamp. The frontend currently
declares it as `ISODate`, which is also a string alias, but its type should be
clarified before runtime response validation is added.

## Error Format

The canonical error body has a stable machine-readable code and a safe message:

```json
{
  "error": {
    "code": "invalid_cursor",
    "message": "transaction cursor is invalid"
  }
}
```

Recommended status codes:

| Status | Meaning |
| --- | --- |
| `400` | Invalid query, cursor, or request body |
| `401` | Missing, invalid, or expired access token |
| `404` | Resource does not exist for the authenticated user |
| `409` | Write conflicts with current state or referenced data |
| `422` | Valid JSON that violates domain validation |
| `500` | Unexpected server error; no internal details are exposed |
| `503` | Readiness dependency is temporarily unavailable |

## Resources

### Category

Categories belong to a user. Default categories are copied into that user's
scope and marked `isSystem`; they are not global rows shared by users.

```json
{
  "id": "7d885a8e-2482-465f-af37-c87c92fd85c7",
  "name": "Food",
  "kind": "expense",
  "color": "orange",
  "icon": "utensils",
  "parentId": null,
  "isSystem": true,
  "order": 1
}
```

- `kind`: `expense | income`
- `color`: `blue | green | red | purple | yellow | orange | cyan | pink | gray`
- `parentId`: another category owned by the same user, or `null`

### Account

```json
{
  "id": "90405133-59ae-408a-9ebf-c56ac82f3437",
  "name": "Cred Platino",
  "type": "credit",
  "institution": "Santander",
  "last4": "1093",
  "currency": "MXN",
  "creditLimit": 8000000,
  "availableCredit": 5340000,
  "statementCutDay": 15,
  "paymentDueDay": 5,
  "isActive": true
}
```

- `type`: `debit | credit`
- `currency`: `MXN` in v1. The frontend type remains forward-compatible with
  `USD`, but multi-currency writes and cross-currency transfers are rejected
  until an explicit exchange-rate model exists.
- Debit accounts may include `balance` and omit credit-only properties.
- Credit accounts omit `balance`; their credit-specific properties are
  optional until supplied by the user.

### Transaction

Amounts are always positive. Direction is derived from `type`.

```json
{
  "id": "8ff40936-75b2-4ff1-9096-8f456e69b906",
  "accountId": "90405133-59ae-408a-9ebf-c56ac82f3437",
  "type": "expense",
  "amount": 216660,
  "categoryId": null,
  "date": "2026-07-11",
  "description": "Phone - installment 5/12",
  "merchant": "Example Store",
  "msiPurchaseId": "40562e4d-4c75-4949-a20a-8a13ecce3f74",
  "isReconciled": true,
  "createdAt": "2026-07-11T15:04:05Z"
}
```

- `type`: `expense | income | transfer`
- `categoryId` is nullable for uncategorized transactions.
- `merchant` and `msiPurchaseId` are optional.
- A transfer requires `transferToAccountId`, cannot transfer to the same
  account, and has `categoryId: null`.

### Budget

```json
{
  "id": "8bf3a3de-1e7b-4895-a3a3-d6bda1f82aa7",
  "categoryId": "7d885a8e-2482-465f-af37-c87c92fd85c7",
  "amount": 500000,
  "period": "monthly",
  "startDate": "2026-07-01"
}
```

- `period`: `weekly | monthly | yearly`
- `categoryId: null` represents a global budget.
- `startDate` activates the budget. Weekly cycles recur every seven days from
  that date; monthly budgets use calendar months; yearly cycles recur on the
  same month/day. Yearly leap-day anchors clamp to the last valid day. Cycle
  date boundaries are inclusive. Once a monthly budget activates, its first
  cycle includes earlier expenses from that same calendar month through the
  current `asOf` date.

### Savings Goal

```json
{
  "id": "d76c3afa-2d5a-476d-8d7e-03c71e554bda",
  "name": "Emergency fund",
  "targetAmount": 12000000,
  "currentAmount": 5230000,
  "targetDate": "2027-01-31",
  "accountId": "5a8825dd-e278-42d9-ab67-7bf5888a4122",
  "isCompleted": false,
  "order": 1
}
```

`targetDate` is optional. `accountId` is nullable.

### MSI Purchase

```json
{
  "id": "40562e4d-4c75-4949-a20a-8a13ecce3f74",
  "accountId": "90405133-59ae-408a-9ebf-c56ac82f3437",
  "description": "Phone",
  "merchant": "Example Store",
  "totalAmount": 2599900,
  "installmentAmount": 216660,
  "installmentCount": 12,
  "installmentsPaid": 5,
  "startDate": "2026-03-01",
  "nextInstallmentDate": "2026-08-01",
  "categoryId": null,
  "status": "active"
}
```

- `status`: `active | completed`
- `merchant` and `nextInstallmentDate` are optional.
- `categoryId` is nullable.
- The last installment may absorb division remainders.

### Rule

The API rule shape follows the frontend `Rule`. Category display data is
resolved from the categories collection and is not duplicated in this response
or in the `rules` table.

```json
{
  "id": "320ec9b0-0246-4f37-9d93-e3479be34e48",
  "field": "merchant",
  "operator": "contains",
  "value": "Uber",
  "categoryId": "7d885a8e-2482-465f-af37-c87c92fd85c7",
  "isActive": true,
  "priority": 1
}
```

- `field`: `merchant | description`
- `operator`: `contains | startsWith`
- Active/inactive state is represented by `isActive`, not a string enum.

## Initial Endpoints

### `POST /v1/onboarding`

This authenticated, idempotent operation provisions system categories for a
new user before the frontend replaces category mocks. It returns `204`. Stable
system keys and a per-user unique constraint prevent duplicates; repeated
calls never overwrite customized data.

### `GET /v1/categories`

Returns `Category[]`, sorted by `order ASC`, then `id ASC`.

### `GET /v1/accounts`

Returns `Account[]`. Active and inactive accounts are included initially so
historical relationships remain resolvable.

### `GET /v1/transactions`

Supported query parameters:

| Parameter | Type | Behavior |
| --- | --- | --- |
| `from` | `YYYY-MM-DD` | Include transactions on or after this date |
| `to` | `YYYY-MM-DD` | Include transactions on or before this date |
| `account_id` | UUID | Filter by source account |
| `category_id` | UUID | Filter by category |
| `type` | enum | `expense`, `income`, or `transfer` |
| `limit` | integer | Page size; default `50`, minimum `1`, maximum `100` |
| `cursor` | opaque string | Continue after the previous page |

Results are ordered by `date DESC, id DESC`. The cursor encodes the last
item's `(date, id)` tuple and must be treated as opaque by clients. Filters
must remain unchanged while following a cursor.

```json
{
  "items": [
    {
      "id": "8ff40936-75b2-4ff1-9096-8f456e69b906",
      "accountId": "90405133-59ae-408a-9ebf-c56ac82f3437",
      "type": "expense",
      "amount": 216660,
      "categoryId": null,
      "date": "2026-07-11",
      "description": "Phone - installment 5/12",
      "merchant": "Example Store",
      "isReconciled": true,
      "createdAt": "2026-07-11T15:04:05Z"
    }
  ],
  "nextCursor": "opaque-or-null"
}
```

`nextCursor` is `null` when no more results exist. While current dashboard
calculations consume a complete `Transaction[]`, the frontend API client must
follow every cursor until it reaches null. It must not silently unwrap
only the first page. History pagination and dashboard summaries should become
separate queries before data volume makes full retrieval expensive.

### `GET /v1/budgets`

Returns `Budget[]`, sorted by `startDate DESC, id ASC`.

### `GET /v1/savings-goals`

Returns `SavingsGoal[]`, sorted by `order ASC`, then `id ASC`.

### Savings allocation operations

`GET /v1/savings-goals/overview` returns real balances for linked debit
accounts, amounts allocated to goals, unallocated balances, and recent
allocation activity.

`POST /v1/savings-goals/{id}/savings` creates a real account transfer and its
goal allocation atomically. `POST /allocations` assigns or releases existing
account balance with a signed amount. `POST /reallocations` moves an allocation
between goals without creating a bank transaction. All three write operations
require `Idempotency-Key`; transfers created by the savings endpoint cannot be
edited or deleted independently from their allocation.
Replays never repeat side effects; responses contain current goal state rather
than a historical snapshot. Savings allocations for one user must share one
currency, so aggregate totals never combine unlike monetary units.

### `GET /v1/msi-purchases`

Returns `MSIPurchase[]`, sorted with active purchases first, then by
`nextInstallmentDate ASC NULLS LAST`, then `id ASC`.

### `POST /v1/msi-purchases`

Creates an MSI master purchase and its full monthly expense schedule. If
balance tracking is enabled on the selected credit card, the full principal is
deducted from available credit once at creation; generated installments use
`affectsBalance: false` so they do not charge the card again.
The credit card must have balance tracking enabled. Clients send a stable
`Idempotency-Key` for retries; reusing it with different purchase data returns
`409`.

### `PUT /v1/msi-purchases/:id`

Replaces editable purchase fields and regenerates the installment schedule. A
tracked principal charge is reversed and reapplied atomically for the updated
account and amount. Purchases created before tracking remain historical.

### `DELETE /v1/msi-purchases/:id`

Deletes the master purchase and generated installments. Any tracked principal
charge is reversed atomically. Returns `204`.

### `POST /v1/accounts/:id/statement-reconciliations`

Compares a credit card statement PDF with the movements recorded for the
credit account. The request is `multipart/form-data` with a single `file`
field (PDF, at most 4 MiB). The PDF is parsed in memory by the Go backend with
a bank-specific parser (Banamex credit cards for now); it is never stored,
logged, or sent to an external service. The endpoint is read-only.

Response `200`:

```json
{
  "statement": {
    "issuer": "banamex",
    "product": "JOY BANAMEX",
    "cardLast4": "4321",
    "periodStart": "2026-06-08",
    "periodEnd": "2026-07-08",
    "paymentDueDate": "2026-08-03",
    "paymentToAvoidInterest": 125050,
    "minimumPayment": 15000,
    "totalCharges": 125050,
    "totalCredits": 90000,
    "warnings": []
  },
  "movements": [
    {
      "line": 1,
      "operationDate": "2026-06-15",
      "postingDate": "2026-06-16",
      "description": "CAFE DEMO",
      "amount": 8550,
      "direction": "charge",
      "status": "matched",
      "transactionId": "uuid"
    }
  ],
  "onlyInBudg": [],
  "summary": {
    "matched": 1,
    "missing": 0,
    "installmentsMatched": 0,
    "installmentsUnmatched": 0,
    "onlyInBudg": 0,
    "missingCharges": 0,
    "missingCredits": 0
  }
}
```

Movement `status` is `matched`, `missing`, `installment_matched`, or
`installment_unmatched`. Regular movements match an unused transaction with the
same amount and direction (card expense or transfer out for charges; card
income or transfer into the card for credits) within three days of the
operation/posting dates. Installment lines (`002 de 006`) only match scheduled
MSI installments within twenty days and are never proposed as new expenses.
`warnings` can contain `charges_total_mismatch`, `credits_total_mismatch`,
`missing_totals`, or `card_last4_mismatch`.

Errors: `400 invalid_request` (not multipart, missing file, non-credit
account), `400 invalid_file`, `404 not_found`, `413 payload_too_large`,
`422 unreadable_statement` (no text layer), `422 unsupported_statement`,
`429 parser_busy` (all parse workers busy), `503 statement_timeout`.

Parsing is bounded: at most two concurrent parses, 40 pages, 100k text
fragments, and an 8-second extraction budget.

The client applies the result with existing endpoints: `POST /v1/transactions`
with an `Idempotency-Key` derived from a per-upload session nonce, statement
cut, line, and amount, and `POST /v1/accounts/:id/credit-card-statements` to
save the cut. Card-payment credits are unchecked by default and saving or
registering is blocked on `card_last4_mismatch` until the user confirms.

### Savings yields

Debit accounts accept either an optional flat `annualYieldBps` (0–10000;
`1200` = 12% a year, ideally net of withheld tax) or `annualYieldTiers` on
create and `PATCH`. A tier ladder has 1–8 bands, positive increasing
`upToCents` caps, rates from 0–10000 bps, and an uncapped (`null`) final band:

```json
[
  { "upToCents": 2500000, "annualYieldBps": 1500 },
  { "upToCents": null, "annualYieldBps": 700 }
]
```

Tiers take precedence over the flat rate. Each balance portion compounds daily
at its band rate; without tiers, the flat estimate remains
`balance × ((1 + rate/365)^days − 1)`. Accounts also expose
`yieldReconciledOn`, the date of the latest reconciliation. Estimates accrue
from that date or, before the first reconciliation, the balance-tracking start
date. Send `annualYieldTiers: null` to clear tiers.

#### `POST /v1/accounts/:id/yield-reconciliations`

Requires a debit account with balance tracking. Body:

```json
{ "currentBalance": 101500, "yieldAmount": 1000, "categoryId": "uuid|null", "date": "2026-10-02" }
```

The difference `currentBalance − balance` is split atomically:

- `yieldAmount` (0 ≤ yield ≤ positive difference; must be 0 when the balance
  dropped) becomes an `income` transaction "Rendimientos" in the optional
  income `categoryId`.
- The remainder is a plain `reconciliation` ledger adjustment (not income).
- The yield is distributed to the account's goals in proportion to the funds
  each goal has allocated there (denominator: the larger of the balance and
  total allocated), recorded as `yield` allocations; leftover cents stay
  unallocated.

`date` cannot precede the previous reconciliation. Optional `Idempotency-Key`.
Returns `201 { reconciliation, account }`. Errors: `400 invalid_request`,
`404 not_found`, `409 balance_tracking_conflict`, `409 idempotency_conflict`,
`409 idempotency_resource_deleted`.

The yield transaction is managed: editing or deleting it directly returns
`409 yield_transaction_managed`.

#### `DELETE /v1/accounts/:id/yield-reconciliations/:reconciliationId`

Undoes the latest reconciliation of the account: removes goal shares, the yield
transaction, and reverses the adjustment. Older ones return
`409 yield_reconciliation_not_latest`; a goal that no longer holds its share
returns `409 goal_allocation_conflict`. Returns the updated account.

#### `GET /v1/yield-reconciliations`

Returns `{ data: YieldReconciliation[] }` newest first, each with `date`,
`periodStart`, `balanceBefore`, `balanceAfter`, `yield`, `adjustment`,
`estimatedYield`, the configured `annualYieldBps`/`annualYieldTiers` snapshot,
and goal `allocations`. Used for realized annual rates:
`Σ yield / Σ(balanceBefore × days) × 365`.

### `GET /v1/rules`

Returns `Rule[]`, sorted by `priority ASC`, then `id ASC`.

### `GET /v1/me`

The infrastructure endpoint returns verified identity metadata. It is not a
financial resource and must not be used to choose the scope of other requests.

```json
{
  "userId": "421d22c6-1f2f-465f-aaf8-27ffcbfcb920",
  "email": "user@example.com",
  "authenticated": true
}
```

## Future Write Endpoints

| Method and path | Success | Notes |
| --- | --- | --- |
| `POST /v1/transactions` | `201` + `Transaction` | Server assigns ID, user, and timestamps |
| `PATCH /v1/transactions/{id}` | `200` + `Transaction` | Partial update of mutable domain fields |
| `DELETE /v1/transactions/{id}` | `204` | Transactional recalculation may be required |
| `POST /v1/accounts` | `201` + `Account` | Type-specific validation applies |
| `PATCH /v1/accounts/{id}` | `200` + `Account` | Prefer `isActive: false` when history exists |
| `DELETE /v1/accounts/{id}` | `204` | Reject with `409` when referenced |
| `POST /v1/budgets` | `201` + `Budget` | Category may be `null` for global budget |
| `PATCH /v1/budgets/{id}` | `200` + `Budget` | Partial update |
| `DELETE /v1/budgets/{id}` | `204` | User-scoped delete |
| `POST /v1/savings-goals` | `201` + `SavingsGoal` | Account may be `null` |
| `PATCH /v1/savings-goals/{id}` | `200` + `SavingsGoal` | Partial update |
| `DELETE /v1/savings-goals/{id}` | `204` | User-scoped delete |
| `POST /v1/categories` | `201` + `Category` | Server assigns order and `isSystem: false` |
| `PATCH /v1/categories/{id}` | `200` + `Category` | System categories are immutable |
| `DELETE /v1/categories/{id}` | `204` | Reject system or referenced category |
| `POST /v1/rules` | `201` + `Rule` | Server assigns priority when omitted |
| `PATCH /v1/rules/{id}` | `200` + `Rule` | Partial update |
| `DELETE /v1/rules/{id}` | `204` | User-scoped delete |

### Write DTOs

Write requests use dedicated DTOs, not `Partial<Resource>`. Every `PATCH` must
contain at least one allowed field. IDs, ownership, timestamps, `isSystem`, and
other server-derived fields are rejected.

| Resource | Create fields | Mutable PATCH fields |
| --- | --- | --- |
| Transaction | `accountId`, `type`, `amount`, `categoryId`, `date`, `description`, optional `merchant`, `msiPurchaseId`, `transferToAccountId` | Same domain fields plus `isReconciled` |
| Account | `name`, `type`, `institution`, `last4`, `currency` (`MXN`), type-specific balance/credit fields | `name`, `institution`, `last4`, type-specific balance/credit fields, `statementCutDay`, `paymentDueDay`, `isActive`; `type` is immutable |
| Budget | `categoryId`, `amount`, `period`, `startDate` | Same fields |
| Savings goal | `name`, `targetAmount`, optional `currentAmount`, `targetDate`, `accountId` | `name`, `targetAmount`, `targetDate`, `accountId`, `order`; completion is derived |
| Category | `name`, `kind`, `color`, `icon`, `parentId` | `name`, `color`, `icon`, `parentId`, `order`; `kind` is immutable |
| Rule | `field`, `operator`, `value`, `categoryId`, optional `isActive` | Same fields plus `priority` |

Contribution body is exactly:

```json
{
  "amount": 50000
}
```

Amount may be positive or negative, but resulting goal amount cannot be below
zero. Backend derives `isCompleted` after every create, patch, or contribution.
Resource IDs in bodies must resolve within authenticated user's scope.

Financial creation endpoints that can duplicate money on retry require an
`Idempotency-Key` UUID. The same key and request never repeats side effects;
resource responses may reflect current state when an endpoint documents that behavior.
reusing a key with a different request returns `409`.

Frontend creates an `operationId` when submission intent begins and reuses it
as header across automatic or manual retries of that same intent. HTTP helper
must not generate a new key per network attempt.

Category and MSI purchase writes follow essential transaction/account writes.
System categories are provisioned per user by `POST /v1/onboarding`, a separate
idempotent operation completed before categories replace frontend mocks.

## Persistence Notes

- Every financial resource table stores `id`, `user_id`, `created_at`, and
  `updated_at`. Supporting tables such as `profiles` and `idempotency_keys`
  document their own primary keys and timestamp columns.
- RLS has no direct-client policies. The Go API connection uses a dedicated,
  non-owner `budg_api` role with `BYPASSRLS` and only required DML grants.
  Repeatable bootstrap creates role without embedding password; each table
  migration grants required access. Queries still require explicit `user_id`.
- The API must set `updated_at = CURRENT_TIMESTAMP` explicitly on updates; the
  initial migration intentionally has no timestamp trigger.
- Every money column has database checks for its domain bounds and JavaScript's
  safe integer maximum, in addition to API validation.
- Composite foreign keys ensure referenced accounts, categories, MSI
  purchases, and parent categories belong to the same user.
- Category kind compatibility, such as expense transactions using expense
  categories, is validated by the backend because a simple foreign key cannot
  express it.
- Category writes must prevent parent cycles and must not modify or delete an
  `isSystem` category.
- MSI purchases must reference credit accounts; this is also backend
  validation.
- Account deletion is restrictive when financial history exists. Deactivation
  is the normal path for an account that has transactions.
