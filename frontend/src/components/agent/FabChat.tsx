import { useState, useRef, useEffect, type FormEvent } from 'react'
import { MessageCircle, X, Send, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAgentStore } from '@/stores/agent'
import { useViewContext } from '@/hooks/useViewContext'
import { renderMarkdown } from '@/lib/agent/markdown'

/**
 * FabChat — floating chat bubble persistent across all authenticated views.
 *
 * On mobile: a fixed circular FAB above the bottom nav that opens a
 * full-height sheet-style panel.
 * On desktop (sm+): a fixed circular FAB bottom-right that opens a
 * fixed-position card panel.
 *
 * The panel is always rendered in the DOM (so animation states work) but
 * visually hidden when closed.
 */
export function FabChat() {
  const open = useAgentStore((s) => s.open)
  const toggle = useAgentStore((s) => s.toggle)

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={toggle}
          aria-label="Asistente budg"
          className={cn(
            'fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-3 z-50',
            'flex h-12 w-12 items-center justify-center',
            'rounded-full bg-foreground text-background shadow-lg',
            'transition-transform active:scale-90',
            'hover:scale-105',
          )}
        >
          <MessageCircle className="h-5 w-5" />
        </button>
      )}
      {open && <ChatPanel />}
    </>
  )
}

function ChatPanel() {
  const toggle = useAgentStore((s) => s.toggle)
  const turns = useAgentStore((s) => s.turns)
  const loading = useAgentStore((s) => s.loading)
  const pendingConfirmation = useAgentStore((s) => s.pendingConfirmation)
  const error = useAgentStore((s) => s.error)
  const send = useAgentStore((s) => s.send)
  const reset = useAgentStore((s) => s.reset)
  const viewContext = useViewContext()

  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new turns or tool activity arrive.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [turns, loading])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!input.trim() || loading) return

    // If there's a pending confirmation and the user's message looks like a
    // "yes", send the confirmation token along.
    const confirmationToken = pendingConfirmation?.token
    void send(input, viewContext, confirmationToken ?? undefined)
    setInput('')
  }

  const handleReset = () => {
    reset()
  }

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex flex-col bg-background sm:inset-auto',
        'sm:bottom-3 sm:right-3 sm:top-auto sm:h-[32rem] sm:w-96',
        'sm:rounded-2xl sm:border sm:border-border sm:shadow-2xl',
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Asistente budg</span>
        </div>
        <div className="flex items-center gap-1">
          {turns.length > 0 && (
            <button
              type="button"
              onClick={handleReset}
              className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
            >
              Limpiar
            </button>
          )}
          <button
            type="button"
            onClick={toggle}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {turns.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <MessageCircle className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">
              Pregúntame sobre tus gastos, ingresos o cuentas.
              <br />
              También puedo registrar movimientos por ti.
            </p>
          </div>
        )}

        {turns.map((turn) => (
          <div
            key={turn.id}
            className={cn(
              'flex flex-col gap-1',
              turn.role === 'user' ? 'items-end' : 'items-start',
            )}
          >
            <div
              className={cn(
                'max-w-[85%] rounded-2xl px-3 py-2 text-sm',
                turn.role === 'user'
                  ? 'bg-foreground text-background rounded-br-md'
                  : turn.status === 'error'
                    ? 'bg-destructive/10 text-destructive rounded-bl-md'
                    : 'bg-muted text-foreground rounded-bl-md',
              )}
            >
              {turn.status === 'sending' && !turn.content ? (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span className="text-xs">Pensando…</span>
                </span>
              ) : turn.role === 'assistant' ? (
                renderMarkdown(turn.content)
              ) : (
                turn.content
              )}
            </div>
            {turn.toolActivity && turn.toolActivity.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {turn.toolActivity.map((tool, i) => (
                  <span
                    key={`${tool}-${i}`}
                    className="rounded-full bg-muted/60 px-2 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {tool.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}

        {error && turns.length === 0 && (
          <div className="rounded-lg bg-destructive/10 p-3 text-xs text-destructive">{error}</div>
        )}
      </div>

      {/* Confirmation banner */}
      {pendingConfirmation && !loading && (
        <div className="border-t border-border bg-muted/30 px-3 py-2">
          <p className="text-[11px] text-muted-foreground">
            Confirma escribiendo "sí" o "confirmo" para ejecutar.
          </p>
        </div>
      )}

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t border-border p-2.5 pt-safe"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
          placeholder={pendingConfirmation ? 'Escribe "sí" para confirmar…' : 'Pregúntame algo…'}
          className="flex-1 rounded-full border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-40"
          aria-label="Enviar"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </form>
    </div>
  )
}
