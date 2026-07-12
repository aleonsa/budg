# Backend Plan

## Recommended Infrastructure

Initial low-cost production target:

- Frontend: Cloudflare Pages for SPA hosting, or Vercel if the project later moves to SSR.
- Backend: Go API in Docker deployed to Google Cloud Run.
- Database: Supabase Postgres.
- Auth: Supabase Auth, with JWT verification in the Go API.

This keeps operational cost low, avoids managing a VPS, and allows Cloud Run to scale to zero.

## Backend Responsibilities

The backend should own:

- Persistence.
- Authorization checks.
- Tenant/user scoping.
- Input validation.
- Canonical financial calculations that must be consistent.
- Transactional writes.
- Import processing.

The frontend can continue owning:

- Presentation-specific derived summaries.
- Local filters.
- Formatting.
- Lightweight rankings when based on already-fetched data.

## Authentication Model

Use Supabase Auth for identity.

Frontend:

- User signs in with Supabase client.
- Frontend receives access token.
- API client sends `Authorization: Bearer <token>` to Go API.

Backend:

- Verify Supabase JWT.
- Extract user ID from `sub`.
- Scope every query by `user_id`.
- Never trust user IDs from request bodies.

## Initial Data Model

Start close to the current frontend types:

- `categories`
- `accounts`
- `transactions`
- `budgets`
- `savings_goals`
- `msi_purchases`
- `rules`

Common columns:

- `id uuid primary key`
- `user_id uuid not null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

Money columns should be integer cents, not decimal floats.

## Initial API Surface

Read endpoints first:

```txt
GET /v1/me
GET /v1/categories
GET /v1/accounts
GET /v1/transactions
GET /v1/budgets
GET /v1/savings-goals
GET /v1/msi-purchases
GET /v1/rules
```

Then writes:

```txt
POST /v1/transactions
PATCH /v1/transactions/{id}
DELETE /v1/transactions/{id}

POST /v1/accounts
PATCH /v1/accounts/{id}
DELETE /v1/accounts/{id}

POST /v1/budgets
PATCH /v1/budgets/{id}
DELETE /v1/budgets/{id}

POST /v1/savings-goals
PATCH /v1/savings-goals/{id}
DELETE /v1/savings-goals/{id}

POST /v1/rules
PATCH /v1/rules/{id}
DELETE /v1/rules/{id}
```

Dashboard-specific endpoints can wait. The current frontend can compute dashboard summaries from base resources while the dataset is small.

## Query And Pagination

Transactions should be the first paginated resource.

Recommended query parameters:

```txt
GET /v1/transactions?from=2026-07-01&to=2026-07-31&account_id=...&category_id=...&type=expense&limit=50&cursor=...
```

Use cursor pagination for transaction history. Budgets, accounts, categories, goals, and rules can initially return full lists per user.

## Database Notes

- Use versioned SQL migrations.
- Add indexes on `user_id`, transaction date, account/category foreign keys, and rule lookup fields.
- Keep system categories either seeded per user or represented as immutable templates copied into user scope.
- Use connection pooling carefully with Cloud Run and Supabase's pooler.

## Go Service Shape

Recommended minimal structure:

```txt
cmd/api/
internal/http/
internal/auth/
internal/db/
internal/domain/
internal/service/
internal/repository/
migrations/
```

Keep the first version boring:

- `net/http` or a small router.
- `pgxpool` for Postgres.
- Explicit request/response structs.
- Context-aware DB calls.
- Table-driven tests for services and handlers.

## Implementation Order

1. Decide schema and write migrations.
2. Build auth middleware for Supabase JWT verification.
3. Implement read endpoints matching current mock client.
4. Replace frontend mock client internals with real HTTP reads.
5. Add transaction writes.
6. Add account/budget/goal/category/rule writes.
7. Add import and rule application flows.

## Main Risks

- Connection exhaustion from serverless instances if pooling is not constrained.
- Leaking cross-user data if `user_id` scoping is not enforced centrally.
- Divergence between frontend mock types and backend response types.
- Overbuilding analytics endpoints before CRUD and auth are stable.
