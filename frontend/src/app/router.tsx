import type { ReactNode } from 'react'
import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { RequireAuth } from '@/app/RequireAuth'
import {
  AccountsPage,
  BudgetsPage,
  CategoriesPage,
  DashboardPage,
  GoalsPage,
  LoginPage,
  RouteSuspense,
  RulesPage,
  SettingsPage,
  StatsPage,
  TransactionsPage,
} from './route-components'

function withSuspense(node: ReactNode) {
  return <RouteSuspense>{node}</RouteSuspense>
}

export const router = createBrowserRouter([
  {
    path: '/login',
    element: withSuspense(<LoginPage />),
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: withSuspense(<DashboardPage />) },
      { path: 'transactions', element: withSuspense(<TransactionsPage />) },
      { path: 'accounts', element: withSuspense(<AccountsPage />) },
      { path: 'budgets', element: withSuspense(<BudgetsPage />) },
      { path: 'goals', element: withSuspense(<GoalsPage />) },
      { path: 'settings', element: withSuspense(<SettingsPage />) },
      { path: 'categories', element: withSuspense(<CategoriesPage />) },
      { path: 'rules', element: withSuspense(<RulesPage />) },
      { path: 'stats', element: withSuspense(<StatsPage />) },
    ],
  },
])
