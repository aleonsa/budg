import { useEffect, useId, useRef, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Button, Card } from '@/components/ui'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

interface MockActionPanelProps {
  open: boolean
  title: string
  description: string
  submitLabel?: string
  onClose: () => void
  onSubmit?: () => void
  submitting?: boolean
  submitVariant?: 'default' | 'destructive'
  children: React.ReactNode
}

export function MockActionPanel({
  open,
  title,
  description,
  submitLabel = 'Guardar',
  onClose,
  onSubmit,
  submitting = false,
  submitVariant = 'default',
  children,
}: MockActionPanelProps) {
  const titleId = useId()
  const descriptionId = useId()
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open) return

    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeButtonRef.current?.focus()

    return () => {
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [open])

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
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

  const handleSubmit = () => {
    if (submitting || !onSubmit) return
    onSubmit()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 p-3 backdrop-blur-[1px] sm:items-center"
      onClick={onClose}
    >
      <Card
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={handleKeyDown}
        className="max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto bg-[hsl(var(--card))] p-3.5 shadow-[0_16px_48px_rgba(0,0,0,0.14)]"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="text-[13px] font-semibold">
              {title}
            </h2>
            <p id={descriptionId} className="mt-1 text-xs text-muted-foreground">
              {description}
            </p>
          </div>
          <Button ref={closeButtonRef} type="button" variant="ghost" size="sm" onClick={onClose}>
            Cerrar
          </Button>
        </div>

        <div className="mt-3.5 space-y-3">{children}</div>

        {onSubmit && (
          <div className="mt-3.5 flex justify-end gap-1.5">
            <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
              Cancelar
            </Button>
            <Button variant={submitVariant} size="sm" onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Guardando…' : submitLabel}
            </Button>
          </div>
        )}
      </Card>
    </div>,
    document.body,
  )
}
