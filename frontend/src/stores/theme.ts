import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeChoice = 'system' | 'light' | 'dark'

interface ThemeState {
  theme: ThemeChoice
  setTheme: (theme: ThemeChoice) => void
}

function applyTheme(theme: ThemeChoice) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const prefersDark =
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  const isDark = theme === 'dark' || (theme === 'system' && prefersDark)
  root.classList.toggle('dark', isDark)
}

export const useTheme = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'system',
      setTheme: (theme) => {
        applyTheme(theme)
        set({ theme })
      },
    }),
    {
      name: 'budg.mock.theme',
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme)
      },
    },
  ),
)
