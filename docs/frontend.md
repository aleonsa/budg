# Frontend Guide

## Commands

All commands run from `frontend/`:

```bash
npm run dev
npm run build
npm run lint
npm run preview
```

## Routing Conventions

Page routes live under `frontend/src/routes/<module>/<ModulePage>.tsx` and are registered in `frontend/src/app/router.tsx` with lazy imports.

Keep route components responsible for:

- Data loading through hooks.
- Page-level derived data.
- Page composition.

Avoid moving page-specific helpers into shared modules unless there is a second real consumer.

## Data Conventions

Money is represented as integer cents through the `Cents` type. Use formatters from `frontend/src/lib/format.ts` for display.

Dates are ISO date strings (`YYYY-MM-DD`) unless a backend endpoint explicitly returns timestamps later.

Domain types live in `frontend/src/types/index.ts`. Do not add backend-only fields to frontend types until the API contract is known.

## API Client

All data comes through `frontend/src/lib/api/client.ts`.

When replacing mocks with real HTTP calls:

- Keep exported function names stable where possible.
- Return the existing domain types.
- Throw explicit errors for non-2xx responses.
- Add auth headers from Supabase session tokens once auth is integrated.
- Do not call `fetch()` directly from route components.

## UI Conventions

Use existing primitives from `frontend/src/components/ui`:

- `Card`
- `Badge`
- `Button`
- `Input`
- `Label`
- `Progress`
- `Separator`
- `Sheet`

Use common components for domain display:

- `Amount`
- `CategoryIcon`
- `EmptyState`

Style direction:

- Compact spacing.
- Small but readable typography.
- Clear hierarchy through section headers and concise metadata.
- Prefer rankings, rows, and bars over chart libraries.
- Keep mobile layouts single-column unless a small grid is clearly readable.

## Navigation

Desktop sidebar includes primary and secondary modules. Mobile bottom navigation is intentionally limited to five items to avoid cramped navigation.

If adding a new secondary module, add it to the sidebar and expose it from settings or contextual links rather than forcing it into the bottom nav.

## Loading And Empty States

Use static loading states. Avoid new animations. Empty states should explain the next user action or the future feature state.

## Testing Status

Vitest and Testing Library cover business logic and observable behavior across:

- Money/date helpers and derived financial calculations.
- Zustand stores, API mock contracts, and TanStack Query hooks.
- Shared UI, authenticated navigation, and transaction workflows.
- Dashboard, account, budget, goal, category, rule, statistics, and settings pages.

CI enforces at least 80% globally for statements, branches, functions, and lines.
Tests assert user-visible behavior and business outcomes; avoid snapshots, styling
details, and calls added only to increase coverage.
