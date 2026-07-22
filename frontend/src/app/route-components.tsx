import { lazy, Suspense, type ReactNode } from 'react'

export const DashboardPage = lazy(() => import('@/routes/dashboard/DashboardPage'))
export const TransactionsPage = lazy(() => import('@/routes/transactions/TransactionsPage'))
export const AccountsPage = lazy(() => import('@/routes/accounts/AccountsPage'))
export const CreditCardDetailPage = lazy(() => import('@/routes/accounts/CreditCardDetailPage'))
export const BudgetsPage = lazy(() => import('@/routes/budgets/BudgetsPage'))
export const GoalsPage = lazy(() => import('@/routes/goals/GoalsPage'))
export const SettingsPage = lazy(() => import('@/routes/settings/SettingsPage'))
export const CategoriesPage = lazy(() => import('@/routes/categories/CategoriesPage'))
export const RulesPage = lazy(() => import('@/routes/rules/RulesPage'))
export const StatsPage = lazy(() => import('@/routes/stats/StatsPage'))
export const RecurringTransactionsPage = lazy(
  () => import('@/routes/recurring-transactions/RecurringTransactionsPage'),
)
export const LoginPage = lazy(() => import('@/routes/login/LoginPage'))

export function RouteSuspense({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex h-32 items-center justify-center">
          <span className="text-xs text-muted-foreground">Cargando…</span>
        </div>
      }
    >
      {children}
    </Suspense>
  )
}
