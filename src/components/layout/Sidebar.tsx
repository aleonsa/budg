import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  ArrowLeftRight,
  CreditCard,
  Wallet,
  Target,
  Tags,
  Zap,
  BarChart3,
  Settings,
  LogOut,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface NavItem {
  to: string
  label: string
  icon: typeof LayoutDashboard
  secondary?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Inicio', icon: LayoutDashboard },
  { to: '/transactions', label: 'Movimientos', icon: ArrowLeftRight },
  { to: '/accounts', label: 'Cuentas', icon: CreditCard },
  { to: '/budgets', label: 'Presupuestos', icon: Wallet },
  { to: '/goals', label: 'Metas', icon: Target },
  { to: '/categories', label: 'Categorías', icon: Tags, secondary: true },
  { to: '/rules', label: 'Reglas', icon: Zap, secondary: true },
  { to: '/stats', label: 'Estadísticas', icon: BarChart3, secondary: true },
  { to: '/settings', label: 'Ajustes', icon: Settings, secondary: true },
]

/** Desktop sidebar — hidden on mobile, visible sm+. */
export function Sidebar() {
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)

  return (
    <aside
      className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border bg-[hsl(var(--sidebar-bg))] sm:flex"
      style={{ width: 'var(--sidebar-width)' }}
    >
      {/* Logo / Brand */}
      <div className="flex h-14 items-center px-5">
        <span className="text-base font-semibold tracking-tight">budg</span>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-0.5 px-3 py-2">
        {NAV_ITEMS.map((item, idx) => (
          <div key={item.to}>
            {item.secondary && idx === NAV_ITEMS.findIndex((i) => i.secondary) && (
              <div className="mx-3 my-2 border-t border-[hsl(var(--sidebar-border))]" />
            )}
            <NavLink
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-[hsl(var(--sidebar-accent))] text-[hsl(var(--sidebar-accent-foreground))]'
                    : 'text-[hsl(var(--sidebar-foreground))] opacity-70 hover:bg-[hsl(var(--sidebar-accent))] hover:opacity-100',
                )
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </NavLink>
          </div>
        ))}
      </nav>

      {/* User menu */}
      <div className="relative border-t border-[hsl(var(--sidebar-border))] p-3">
        {isUserMenuOpen && (
          <div className="absolute bottom-[4.25rem] left-3 right-3 rounded-lg border border-border bg-card p-3 text-card-foreground shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                A
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">Alejandro</p>
                <p className="truncate text-xs text-muted-foreground">alejandro@budg.local</p>
              </div>
            </div>

            <div className="mt-3 rounded-md bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
              Mock session · Supabase Auth próximamente
            </div>

            <div className="mt-2 space-y-1">
              <Link
                to="/settings"
                onClick={() => setIsUserMenuOpen(false)}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Settings className="h-3.5 w-3.5" />
                Ajustes
              </Link>
              <button
                type="button"
                disabled
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground opacity-60"
              >
                <LogOut className="h-3.5 w-3.5" />
                Cerrar sesión
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setIsUserMenuOpen((open) => !open)}
          className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-[hsl(var(--sidebar-accent))]"
          aria-expanded={isUserMenuOpen}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
            A
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-[hsl(var(--sidebar-foreground))]">
              Alejandro
            </p>
            <p className="truncate text-[11px] text-muted-foreground">Mock session</p>
          </div>
        </button>
      </div>
    </aside>
  )
}
