# Product Scope

## Product Goal

`budg` should help a user understand their financial position quickly on mobile, while still providing enough depth for budgeting, account review, rule setup, and lightweight analytics.

The product should feel lighter than MyFinBudget while approaching its functional coverage over time.

## Current MVP Modules

### Dashboard

The dashboard is the control center. It summarizes:

- Current period.
- Operating funds.
- Monthly spending.
- Debt.
- Net worth.
- Monthly income, expenses, savings, and savings rate.
- Critical budgets.
- Expense and income distribution.
- MSI/debt burden.
- Goals.
- Recent transactions.

### Transactions

The transaction module supports filtering, grouped history, and transaction detail review. Future backend work should add create/edit/delete and import flows.

### Accounts

The accounts module shows debit balances, credit debt, available credit, utilization, statement/payment day metadata, and active MSI purchases.

### Budgets

The budgets module shows period budget health, critical categories, category ranking, and unbudgeted spending.

### Goals

The goals module tracks savings goals, progress, target dates, linked accounts, and completed goals.

### Categories

The categories module shows system categories, expense/income split, monthly usage, and budget associations.

### Rules

The rules module is currently mock/read-only. It establishes the UX for automatic categorization rules.

### Stats

The stats module provides lightweight analytics without heavy chart dependencies.

### Settings

Settings groups profile/session state, preferences, data management, security, and technical status.

## Explicitly Out Of Scope For Current Frontend

- Real authentication.
- Real backend writes.
- Bank connections.
- Investments.
- Multi-entity accounting.
- Tags as a standalone module.
- Advanced recurring rules.
- CSV import/export implementation.
- Notification system.

## Near-Term Product Priorities

1. Connect Supabase Auth and replace mock session UI.
2. Connect Go API read endpoints.
3. Add writes for transactions, accounts, budgets, goals, categories, and rules.
4. Add validation and optimistic UI where safe.
5. Add import flow for transactions.
6. Add tests around financial calculations.

## UX Principles

- The dashboard should answer “Am I okay this month?” within seconds.
- Mobile should be the primary experience, not an afterthought.
- Every metric needs period context.
- Important risk states should be visible without loud visual noise.
- Advanced functionality should be reachable but not dominate daily use.
