# budg

`budg` is a personal finance frontend focused on compact, mobile-first money management. The current app is a React/Vite SPA backed by mock data, designed to be connected next to a Go API, PostgreSQL, and Supabase Auth.

The product direction is inspired by MyFinBudget's functional depth, but not its visual style. The goal is a lighter, faster, clearer experience with dense financial information that remains usable on mobile.

## Current Scope

Implemented frontend modules:

- Dashboard with period overview, key financial metrics, spending/income rankings, budget alerts, MSI summary, goals, and recent transactions.
- Transactions with filters, grouped history, and transaction detail sheet.
- Accounts with debit, credit, available credit, debt, and MSI summaries.
- Budgets with period totals, critical categories, category ranking, and unbudgeted spending.
- Goals with aggregate progress, next objective, active goals, and completed goals.
- Categories with category usage and budget context.
- Rules with mock automatic categorization rules and merchant suggestions.
- Stats with lightweight analytics, category distributions, monthly trend, and insights.
- Settings with mock profile/session, preferences, data, security, and technical status.

## Stack

- React 19
- TypeScript
- Vite
- React Router
- TanStack Query
- Zustand
- Tailwind CSS 4
- shadcn-style local UI primitives
- Oxlint

## Local Development

Install dependencies:

```bash
npm install
```

Run the dev server:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Lint:

```bash
npm run lint
```

Preview the production build:

```bash
npm run preview
```

## Project Layout

```txt
src/
  app/                 Router and providers
  components/common/   Domain-aware reusable UI
  components/layout/   App shell, sidebar, bottom nav, header
  components/ui/       Local shadcn-style primitives
  features/            Feature-specific components
  hooks/               Query hooks and derived financial helpers
  lib/                 API client, formatting, colors, date utilities
  routes/              Page-level route modules
  stores/              Local UI state stores
  types/               Domain types
```

## Documentation

- [Architecture](docs/architecture.md)
- [Frontend Guide](docs/frontend.md)
- [Product Scope](docs/product-scope.md)
- [Backend Plan](docs/backend-plan.md)

## Backend Direction

The frontend is intentionally isolated behind `src/lib/api/client.ts`. When the Go backend is ready, the mock functions should be replaced by typed `fetch()` calls while preserving the hook and component contracts.

Target infrastructure:

- Frontend: Cloudflare Pages or Vercel
- Backend: Go service in Docker on Cloud Run
- Database: Supabase Postgres
- Auth: Supabase Auth with JWT verification in the Go API

## Product Principles

- Mobile-first, not desktop-shrunk.
- Compact financial decisions over decorative dashboards.
- Lists and rankings before heavy charts.
- Clear period context for every metric.
- Mock/read-only frontend now, API-backed flows later.
- No auth, backend, or schema assumptions hidden in the UI.
