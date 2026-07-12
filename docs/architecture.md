# Architecture

## Overview

`budg` is currently a frontend-only SPA. The application uses mock data through a typed API client so the UI can be built and validated before the backend exists.

```txt
Browser
  -> React/Vite SPA
  -> TanStack Query hooks
  -> src/lib/api/client.ts
  -> mock data today
  -> Go API later
  -> Supabase Postgres later
```

## Frontend Boundaries

The important boundary is `src/lib/api/client.ts`.

Current behavior:

- Returns mock data from `src/lib/api/mock`.
- Preserves typed return values from `src/types`.
- Simulates small network latency.

Future behavior:

- Replace internals with `fetch()` calls.
- Keep function names and return types stable where possible.
- Keep TanStack Query hooks in `src/hooks/useQueries.ts` stable so route components do not need rewrites.

## Data Flow

```txt
Route component
  -> useXQuery hook
  -> api.getX function
  -> typed domain object
  -> local derived calculations
  -> compact UI
```

Derived financial helpers currently live in `src/hooks/useQueries.ts` and page-local helper functions. This is acceptable for the mock stage. When the backend arrives, keep derived UI-only calculations in the frontend, but move canonical financial calculations that must be consistent across clients into the backend.

## Routing

Routes are lazy-loaded in `src/app/router.tsx`:

- `/` dashboard
- `/transactions`
- `/accounts`
- `/budgets`
- `/goals`
- `/categories`
- `/rules`
- `/stats`
- `/settings`

The desktop sidebar exposes all modules. The mobile bottom nav intentionally stays limited to five primary routes:

- Inicio
- Movimientos
- Cuentas
- Presupuestos
- Metas

Secondary routes are accessible from desktop navigation and settings-oriented flows.

## Layout

`AppShell` owns the persistent layout:

- Desktop: fixed sidebar and centered content column.
- Mobile: full-width content and fixed bottom nav.
- Header is route-level so each page can set the correct title and action.

The sidebar includes a mock user menu in the lower-left area. It is prepared for Supabase Auth but does not perform auth yet.

## State Management

- TanStack Query handles server/mock data fetching.
- Zustand is used for transaction filter state.
- Page-level UI state stays local unless reused.

## Design System

The UI uses local shadcn-style primitives in `src/components/ui` and domain-aware components in `src/components/common`.

Principles:

- Neutral surfaces.
- Compact cards and rows.
- Accent colors only for status, categories, and financial direction.
- No gradients.
- No decorative animations.
- Mobile readability over desktop density.

## Backend Integration Contract

The backend should initially match the frontend domain types:

- `Account`
- `Category`
- `Transaction`
- `Budget`
- `SavingsGoal`
- `MSIPurchase`

Before connecting the frontend, add runtime validation at the API boundary or normalize responses in the API client. The existing frontend assumes cents as integers and ISO date strings.
