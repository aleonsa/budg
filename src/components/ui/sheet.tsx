import * as React from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SheetProps {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  children: React.ReactNode
  className?: string
}

/**
 * Bottom sheet for mobile / modal for desktop.
 * Lightweight (no Radix dependency).
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: SheetProps) {
  // Lock body scroll while open
  React.useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  // Close on Escape
  React.useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 animate-in fade-in"
        onClick={onClose}
      />
      {/* Content */}
      <div
        className={cn(
          'relative z-10 w-full sm:max-w-md',
          'max-h-[90vh] overflow-y-auto',
          'rounded-t-lg border border-border bg-card p-4 shadow-lg',
          'sm:rounded-lg sm:border',
          'animate-in slide-in-from-bottom',
          className,
        )}
      >
        {(title || description) && (
          <div className="mb-4 flex items-start justify-between gap-2">
            <div>
              {title && (
                <h2 className="text-sm font-medium tracking-tight">{title}</h2>
              )}
              {description && (
                <p className="mt-1 text-xs text-muted-foreground">{description}</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-muted-foreground hover:bg-accent"
              aria-label="Cerrar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
