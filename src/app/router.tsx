import { lazy, Suspense } from 'react'
import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'

// Lazy-loaded routes for code splitting
const DashboardPage = lazy(() => import('@/routes/dashboard/DashboardPage'))
const TransactionsPage = lazy(() => import('@/routes/transactions/TransactionsPage'))
const AccountsPage = lazy(() => import('@/routes/accounts/AccountsPage'))
const BudgetsPage = lazy(() => import('@/routes/budgets/BudgetsPage'))
const GoalsPage = lazy(() => import('@/routes/goals/GoalsPage'))
const CategoriesPage = lazy(() => import('@/routes/categories/CategoriesPage'))
const RulesPage = lazy(() => import('@/routes/rules/RulesPage'))
const StatsPage = lazy(() => import('@/routes/stats/StatsPage'))
const SettingsPage = lazy(() => import('@/routes/settings/SettingsPage'))

function RouteFallback() {
  return (
    <div className="flex h-32 items-center justify-center">
      <span className="text-xs text-muted-foreground">Cargando…</span>
    </div>
  )
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      {
        index: true,
        element: (
          <Suspense fallback={<RouteFallback />}>
            <DashboardPage />
          </Suspense>
        ),
      },
      {
        path: 'transactions',
        element: (
          <Suspense fallback={<RouteFallback />}>
            <TransactionsPage />
          </Suspense>
        ),
      },
      {
        path: 'accounts',
        element: (
          <Suspense fallback={<RouteFallback />}>
            <AccountsPage />
          </Suspense>
        ),
      },
      {
        path: 'budgets',
        element: (
          <Suspense fallback={<RouteFallback />}>
            <BudgetsPage />
          </Suspense>
        ),
      },
      {
        path: 'goals',
        element: (
          <Suspense fallback={<RouteFallback />}>
            <GoalsPage />
          </Suspense>
        ),
      },
      {
        path: 'settings',
        element: (
          <Suspense fallback={<RouteFallback />}>
            <SettingsPage />
          </Suspense>
        ),
      },
      {
        path: 'categories',
        element: (
          <Suspense fallback={<RouteFallback />}>
            <CategoriesPage />
          </Suspense>
        ),
      },
      {
        path: 'rules',
        element: (
          <Suspense fallback={<RouteFallback />}>
            <RulesPage />
          </Suspense>
        ),
      },
      {
        path: 'stats',
        element: (
          <Suspense fallback={<RouteFallback />}>
            <StatsPage />
          </Suspense>
        ),
      },
    ],
  },
])
