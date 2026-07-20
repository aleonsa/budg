import { cn } from '@/lib/utils'
import { MobileUserMenu } from './MobileUserMenu'

interface HeaderProps {
  title: string
  subtitle?: string
  /** Right-side action (button, etc.) */
  action?: React.ReactNode
  /** Show user menu on mobile (hidden sm+ since sidebar has the equivalent) */
  showSettings?: boolean
}

/** Top header bar — shows on all breakpoints, adapts content. */
export function Header({ title, subtitle, action, showSettings = true }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-border bg-background/95 px-1 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="flex flex-1 flex-col">
        <h1 className="text-[13px] font-semibold tracking-[-0.01em]">{title}</h1>
        {subtitle && <p className="text-[11px] leading-tight text-muted-foreground">{subtitle}</p>}
      </div>

      {action}

      {showSettings && <MobileUserMenu />}
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
  return <div className={cn('space-y-2.5', className)}>{children}</div>
}

/** Section heading used inside pages. */
export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-0.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </h2>
  )
}
