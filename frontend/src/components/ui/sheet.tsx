import * as React from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

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
export function Sheet({ open, onClose, title, description, children, className }: SheetProps) {
  const titleId = React.useId()
  const descriptionId = React.useId()
  const closeButtonRef = React.useRef<HTMLButtonElement>(null)

  // Lock body scroll while open
  React.useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  React.useEffect(() => {
    if (!open) return

    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeButtonRef.current?.focus()

    return () => {
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [open])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab') return

    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    )
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first || !last) return

    const active = document.activeElement
    if (event.shiftKey && (active === first || !event.currentTarget.contains(active))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (active === last || !event.currentTarget.contains(active))) {
      event.preventDefault()
      first.focus()
    }
  }

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center sm:items-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 animate-in fade-in" onClick={onClose} />
      {/* Content */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : 'Panel'}
        aria-describedby={description ? descriptionId : undefined}
        onKeyDown={handleKeyDown}
        className={cn(
          'relative z-10 w-full sm:max-w-md',
          'max-h-[90vh] overflow-y-auto',
          'rounded-b-[10px] border border-border bg-card p-3.5 shadow-[0_12px_40px_rgba(0,0,0,0.12)]',
          'mt-0 sm:mt-0',
          'sm:rounded-[10px] sm:border',
          'animate-in slide-in-from-top',
          className,
        )}
      >
        <div className="mb-3.5 flex items-start justify-between gap-2">
          <div>
            {title && (
              <h2 id={titleId} className="text-[13px] font-semibold tracking-tight">
                {title}
              </h2>
            )}
            {description && (
              <p id={descriptionId} className="mt-1 text-xs text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
