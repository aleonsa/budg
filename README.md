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

## Repository Layout

```txt
frontend/   React/Vite SPA (frontend of record)
backend/    Go API workspace (current experiment ignored by new plan)
docs/       Architecture, frontend guide, backend plan, API contract, product scope
```

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

Required runtimes are pinned in `.node-version` and `frontend/package.json`.
After your version manager activates Node 24.18.0, bootstrap pinned npm once:

```bash
npm install --global npm@12.0.1
node --version
npm --version
```

All frontend commands then run from `frontend/`:

```bash
cd frontend
npm ci
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

Repository-wide quality gates run from root:

```bash
make check
```

This runs formatting, lint, strict typecheck, tests with coverage, build, backend
Phase 0 freeze, secret scanning, and full npm dependency audit.

## Frontend Layout

```txt
frontend/
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
- [Development Rules](docs/development-rules.md)
- [CI/CD Plan](docs/ci-cd.md)
- [Toolchain Versions](docs/toolchain-versions.md)
- [Backend Plan](docs/backend-plan.md)
- [Backend Environment](docs/backend/00-environment.md)
- [Backend Foundation](docs/backend/01-foundation.md)
- [Database Model](docs/backend/02-database.md)
- [API Roadmap](docs/backend/03-api-roadmap.md)
- [Backend Operations](docs/backend/04-operations.md)
- [API Contract](docs/api-contract.md)

## Backend Direction

The frontend is intentionally isolated behind `frontend/src/lib/api/client.ts`. When the Go backend is ready, the mock functions should be replaced by typed `fetch()` calls while preserving the hook and component contracts.

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
