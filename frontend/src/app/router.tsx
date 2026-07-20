import { lazy, Suspense } from 'react'
import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { RequireAuth } from '@/app/RequireAuth'

// Lazy-loaded routes for code splitting
const DashboardPage = lazy(() => import('@/routes/dashboard/DashboardPage'))
const TransactionsPage = lazy(() => import('@/routes/transactions/TransactionsPage'))
const AccountsPage = lazy(() => import('@/routes/accounts/AccountsPage'))
const BudgetsPage = lazy(() => import('@/routes/budgets/BudgetsPage'))
const GoalsPage = lazy(() => import('@/routes/goals/GoalsPage'))
const SettingsPage = lazy(() => import('@/routes/settings/SettingsPage'))
const CategoriesPage = lazy(() => import('@/routes/categories/CategoriesPage'))
const RulesPage = lazy(() => import('@/routes/rules/RulesPage'))
const StatsPage = lazy(() => import('@/routes/stats/StatsPage'))
const LoginPage = lazy(() => import('@/routes/login/LoginPage'))

function RouteFallback() {
  return (
    <div className="flex h-32 items-center justify-center">
      <span className="text-xs text-muted-foreground">Cargando…</span>
    </div>
  )
}

function withSuspense(node: React.ReactNode) {
  return <Suspense fallback={<RouteFallback />}>{node}</Suspense>
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
