import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LogOut, Settings } from 'lucide-react'
import { Sheet } from '@/components/ui/sheet'
import { useAuth } from '@/stores/auth'

/**
 * Mobile user menu trigger + sheet.
 *
 * Mirrors the desktop sidebar's bottom-left user popover: shows the signed-in
 * user, a link to settings, and a sign-out action. Visible only below sm.
 */
export function MobileUserMenu() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const user = useAuth((s) => s.user)
  const signOut = useAuth((s) => s.signOut)

  const displayName = user?.name ?? 'Invitado'
  const displayEmail = user?.email ?? 'sesión no iniciada'
  const initial = displayName.charAt(0).toUpperCase()

  const handleSignOut = () => {
    setOpen(false)
    signOut()
    navigate('/login', { replace: true })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground sm:hidden"
        aria-label="Cuenta"
      >
        {initial}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Cuenta">
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{displayName}</p>
              <p className="truncate text-xs text-muted-foreground">{displayEmail}</p>
            </div>
          </div>

          <div className="rounded-md bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
            Sesión mock · Ambiente demo
          </div>

          <div className="space-y-1">
            <Link
              to="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Settings className="h-4 w-4" />
              Ajustes
            </Link>
            <button
              type="button"
              onClick={handleSignOut}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
              Cerrar sesión
            </button>
          </div>
        </div>
      </Sheet>
    </>
  )
}
