import type { Budget } from '@/types'

export const mockBudgets: Budget[] = [
  {
    id: 'bud-food',
    categoryId: 'cat-food',
    amount: 800000, // $8,000.00/mes
    period: 'monthly',
    startDate: '2025-07-01',
  },
  {
    id: 'bud-groceries',
    categoryId: 'cat-groceries',
    amount: 600000, // $6,000.00/mes
    period: 'monthly',
    startDate: '2025-07-01',
  },
  {
    id: 'bud-transport',
    categoryId: 'cat-transport',
    amount: 300000, // $3,000.00/mes
    period: 'monthly',
    startDate: '2025-07-01',
  },
  {
    id: 'bud-entertainment',
    categoryId: 'cat-entertainment',
    amount: 200000, // $2,000.00/mes
    period: 'monthly',
    startDate: '2025-07-01',
  },
]
