import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
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
import { useAuth } from '@/stores/auth'

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
  const userMenuRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const user = useAuth((s) => s.user)
  const signOut = useAuth((s) => s.signOut)

  const displayName = user?.name ?? 'Invitado'
  const displayEmail = user?.email ?? 'sesión no iniciada'
  const initial = displayName.charAt(0).toUpperCase()

  useEffect(() => {
    if (!isUserMenuOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!userMenuRef.current?.contains(event.target as Node)) {
        setIsUserMenuOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsUserMenuOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isUserMenuOpen])

  const handleSignOut = () => {
    void signOut()
    setIsUserMenuOpen(false)
    navigate('/login', { replace: true })
  }

  return (
    <aside
      className="fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-border bg-[hsl(var(--sidebar-bg))] sm:flex"
      style={{ width: 'var(--sidebar-width)' }}
    >
      {/* Logo / Brand */}
      <div className="flex h-12 items-center border-b border-[hsl(var(--sidebar-border))] px-4">
        <span className="text-[15px] font-semibold tracking-[-0.045em] text-foreground">budg</span>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-0.5 px-2 py-2.5">
        {NAV_ITEMS.map((item, idx) => (
          <div key={item.to}>
            {item.secondary && idx === NAV_ITEMS.findIndex((i) => i.secondary) && (
              <div className="mx-2 my-2 border-t border-[hsl(var(--sidebar-border))]" />
            )}
            <NavLink
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex h-8 items-center gap-2.5 rounded-[7px] px-2.5 text-[13px] transition-colors',
                  isActive
                    ? 'bg-[hsl(var(--sidebar-accent))] font-medium text-[hsl(var(--sidebar-accent-foreground))]'
                    : 'text-[hsl(var(--sidebar-foreground))] opacity-65 hover:bg-[hsl(var(--sidebar-accent))] hover:opacity-100',
                )
              }
            >
              <item.icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
              {item.label}
            </NavLink>
          </div>
        ))}
      </nav>

      {/* User menu */}
      <div ref={userMenuRef} className="relative border-t border-[hsl(var(--sidebar-border))] p-2">
        {isUserMenuOpen && (
          <div className="absolute bottom-[3.75rem] left-2 right-2 rounded-[10px] border border-border bg-card p-3 text-card-foreground shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                {initial}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{displayName}</p>
                <p className="truncate text-xs text-muted-foreground">{displayEmail}</p>
              </div>
            </div>

            <div className="mt-3 rounded-md bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
              Sesión mock · Ambiente demo
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
                onClick={handleSignOut}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
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
          className="flex w-full items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-left hover:bg-[hsl(var(--sidebar-accent))]"
          aria-expanded={isUserMenuOpen}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-[hsl(var(--sidebar-foreground))]">
              {displayName}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">{displayEmail}</p>
          </div>
        </button>
      </div>
    </aside>
  )
}
