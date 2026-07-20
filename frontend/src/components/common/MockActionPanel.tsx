import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Button, Card } from '@/components/ui'

interface MockActionPanelProps {
  open: boolean
  title: string
  description: string
  submitLabel?: string
  onClose: () => void
  onSubmit?: () => void
  submitting?: boolean
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
  children,
}: MockActionPanelProps) {
  // Lock body scroll while open
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

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
        className="max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto bg-[hsl(var(--card))] p-3.5 shadow-[0_16px_48px_rgba(0,0,0,0.14)]"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold">{title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cerrar
          </Button>
        </div>

        <div className="mt-3.5 space-y-3">{children}</div>

        <div className="mt-3.5 rounded-[7px] bg-muted p-2 text-[11px] text-muted-foreground">
          Ambiente demo: los cambios se guardan en memoria y se reinician al recargar.
        </div>

        {onSubmit && (
          <div className="mt-3.5 flex justify-end gap-1.5">
            <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
              Cancelar
            </Button>
            <Button size="sm" onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Guardando…' : submitLabel}
            </Button>
          </div>
        )}
      </Card>
    </div>,
    document.body,
  )
}
