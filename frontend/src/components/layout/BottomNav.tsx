import { useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  ArrowLeftRight,
  CreditCard,
  Wallet,
  Target,
  Menu,
  Tags,
  ListFilter,
  BarChart3,
  Settings,
  Repeat2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Sheet } from '@/components/ui/sheet'

/** Items shown in the bottom bar (max 5 primary + 1 "Más"). */
const BOTTOM_ITEMS = [
  { to: '/', label: 'Inicio', icon: LayoutDashboard },
  { to: '/transactions', label: 'Mov.', icon: ArrowLeftRight },
  { to: '/accounts', label: 'Cuentas', icon: CreditCard },
  { to: '/budgets', label: 'Presup.', icon: Wallet },
  { to: '/goals', label: 'Metas', icon: Target },
]

/** Secondary routes reachable from the "Más" sheet. */
const SECONDARY_ITEMS = [
  { to: '/categories', label: 'Categorías', icon: Tags },
  { to: '/rules', label: 'Reglas', icon: ListFilter },
  { to: '/subscriptions', label: 'Suscripciones', icon: Repeat2 },
  { to: '/stats', label: 'Estadísticas', icon: BarChart3 },
  { to: '/settings', label: 'Configuración', icon: Settings },
]

/** Mobile bottom navigation — visible only below sm. */
export function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const [moreOpen, setMoreOpen] = useState(false)

  const isActive = (to: string) =>
    to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)

  const isSecondaryActive = SECONDARY_ITEMS.some((i) => isActive(i.to))

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 flex min-h-[3.75rem] items-center border-t border-border bg-background/95 pb-safe backdrop-blur supports-[backdrop-filter]:bg-background/90 sm:hidden">
        {BOTTOM_ITEMS.map((item) => {
          const active = isActive(item.to)
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className="flex flex-1 flex-col items-center justify-center py-1.5 px-0.5 active:scale-95 transition-transform"
            >
              <div
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 transition-colors',
                  active ? 'font-semibold text-foreground' : 'text-muted-foreground',
                )}
              >
                <item.icon className="h-5 w-5" strokeWidth={active ? 2.2 : 1.7} />
                <span
                  className={cn(
                    'text-[11px] leading-tight tracking-tight',
                    active ? 'font-semibold' : 'font-normal',
                  )}
                >
                  {item.label}
                </span>
              </div>
            </NavLink>
          )
        })}

        {/* "Más" button — opens a sheet with secondary routes */}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className="flex flex-1 flex-col items-center justify-center py-1.5 px-0.5 active:scale-95 transition-transform"
          aria-label="Más"
        >
          <div
            className={cn(
              'flex flex-col items-center justify-center gap-0.5 transition-colors',
              isSecondaryActive ? 'font-semibold text-foreground' : 'text-muted-foreground',
            )}
          >
            <Menu className="h-5 w-5" strokeWidth={isSecondaryActive ? 2.2 : 1.7} />
            <span
              className={cn(
                'text-[11px] leading-tight tracking-tight',
                isSecondaryActive ? 'font-semibold' : 'font-normal',
              )}
            >
              Más
            </span>
          </div>
        </button>
      </nav>

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="Más">
        <div className="grid grid-cols-2 gap-2">
          {SECONDARY_ITEMS.map((item) => {
            const active = isActive(item.to)
            return (
              <button
                key={item.to}
                type="button"
                onClick={() => {
                  setMoreOpen(false)
                  navigate(item.to)
                }}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-[10px] border p-3 text-center transition-colors',
                  active
                    ? 'border-border bg-accent font-medium text-foreground'
                    : 'border-border text-muted-foreground hover:bg-accent',
                )}
              >
                <item.icon className="h-5 w-5" />
                <span className="text-xs">{item.label}</span>
              </button>
            )
          })}
        </div>
      </Sheet>
    </>
  )
}
