import type { SavingsGoal } from '@/types'

export const mockSavingsGoals: SavingsGoal[] = [
  {
    id: 'goal-emergency',
    name: 'Fondo de emergencia',
    targetAmount: 1500000, // $15,000.00
    currentAmount: 980000, // $9,800.00
    targetDate: '2025-12-31',
    accountId: 'acc-ahorro',
    isCompleted: false,
    order: 0,
  },
  {
    id: 'goal-travel',
    name: 'Viaje a Japón',
    targetAmount: 800000, // $8,000.00
    currentAmount: 340000, // $3,400.00
    targetDate: '2026-04-01',
    accountId: 'acc-ahorro',
    isCompleted: false,
    order: 1,
  },
  {
    id: 'goal-laptop',
    name: 'Nueva laptop',
    targetAmount: 350000, // $3,500.00
    currentAmount: 350000,
    accountId: 'acc-ahorro',
    isCompleted: true,
    order: 2,
  },
]
