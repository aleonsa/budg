import { Link } from 'react-router-dom'
import { Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

interface HeaderProps {
  title: string
  subtitle?: string
  /** Right-side action (button, etc.) */
  action?: React.ReactNode
  /** Show settings link on mobile (hidden sm+ since sidebar has it) */
  showSettings?: boolean
}

/** Top header bar — shows on all breakpoints, adapts content. */
export function Header({ title, subtitle, action, showSettings = true }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex flex-1 flex-col">
        <h1 className="text-sm font-semibold tracking-tight">{title}</h1>
        {subtitle && (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>

      {action}

      {showSettings && (
        <Link
          to="/settings"
          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground sm:hidden"
          aria-label="Ajustes"
        >
          <Settings className="h-4 w-4" />
        </Link>
      )}
    </header>
  )
}

/** Compact page section wrapper for consistent spacing. */
export function PageSection({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return <div className={cn('space-y-3', className)}>{children}</div>
}

/** Section heading used inside pages. */
export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  )
}
