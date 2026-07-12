import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  ArrowLeftRight,
  CreditCard,
  Wallet,
  Target,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/** Items shown in the bottom bar (max 5 — Settings is in header on mobile) */
const BOTTOM_ITEMS = [
  { to: '/', label: 'Inicio', icon: LayoutDashboard },
  { to: '/transactions', label: 'Mov.', icon: ArrowLeftRight },
  { to: '/accounts', label: 'Cuentas', icon: CreditCard },
  { to: '/budgets', label: 'Presup.', icon: Wallet },
  { to: '/goals', label: 'Metas', icon: Target },
]

/** Mobile bottom navigation — visible only below sm. */
export function BottomNav() {
  const location = useLocation()

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex h-14 items-stretch border-t border-border bg-background sm:hidden">
      {BOTTOM_ITEMS.map((item) => {
        const isActive =
          item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className="flex flex-1 flex-col items-center justify-center gap-0.5"
          >
            <item.icon
              className={cn(
                'h-4 w-4 transition-colors',
                isActive ? 'text-foreground' : 'text-muted-foreground',
              )}
            />
            <span
              className={cn(
                'text-[10px] leading-none transition-colors',
                isActive ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {item.label}
            </span>
          </NavLink>
        )
      })}
    </nav>
  )
}
