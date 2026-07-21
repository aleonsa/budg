/**
 * Centralized React Query keys.
 * Each key is an array — stable references prevent duplicate requests.
 */
export const queryKeys = {
  categories: ['categories'] as const,
  accounts: ['accounts'] as const,
  transactions: ['transactions'] as const,
  msiPurchases: ['msi'] as const,
  savingsGoals: ['goals'] as const,
  budgets: ['budgets'] as const,
  rules: ['rules'] as const,

  // Dashboard composed query (uses the above, but cached separately)
  dashboard: ['dashboard'] as const,
} as const

export const authQueryKeys = {
  me: () => ['auth', 'me'] as const,
}
