import { create } from 'zustand'

export type QuickActionType = 'movement' | 'expense' | 'income' | 'transfer' | 'account' | null

interface QuickActionStore {
  isOpen: boolean
  action: QuickActionType
  defaultDate?: string
  openQuickAction: (action?: QuickActionType, date?: string) => void
  closeQuickAction: () => void
}

export const useQuickActionStore = create<QuickActionStore>((set) => ({
  isOpen: false,
  action: null,
  defaultDate: undefined,
  openQuickAction: (action = 'movement', date) =>
    set({ isOpen: true, action: action ?? 'movement', defaultDate: date }),
  closeQuickAction: () => set({ isOpen: false, action: null, defaultDate: undefined }),
}))
