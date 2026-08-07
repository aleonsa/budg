import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { ArrowUp, MessageCircle, Paperclip, Square, SquarePen, X } from 'lucide-react'
import { ToolActivity } from '@/components/agent/ToolActivity'
import { useViewContext } from '@/hooks/useViewContext'
import {
  fileToAttachedImage,
  ImageValidationError,
  MAX_IMAGES_PER_MESSAGE,
  toAgentImage,
  type AttachedImage,
} from '@/lib/agent/images'
import { cn } from '@/lib/utils'
import { useAgentStore, type ChatTurn } from '@/stores/agent'

const SUGGESTIONS = [
  '¿En qué gasté más este mes?',
  'Dame un resumen de mis cuentas',
  'Busca mis últimos gastos',
  'Quiero registrar un movimiento',
]

const AgentMarkdown = lazy(() =>
  import('@/components/agent/AgentMarkdown').then((module) => ({ default: module.AgentMarkdown })),
)

export function FabChat() {
  const open = useAgentStore((state) => state.open)
  const toggle = useAgentStore((state) => state.toggle)
  const setOpen = useAgentStore((state) => state.setOpen)
  const launcherRef = useRef<HTMLButtonElement>(null)

  const close = () => {
    setOpen(false)
    window.setTimeout(() => launcherRef.current?.focus(), 0)
  }

  return (
    <>
      {open && <ChatPanel onClose={close} />}
      <button
        ref={launcherRef}
        type="button"
        onClick={toggle}
        aria-label={open ? 'Cerrar asistente budg' : 'Abrir asistente budg'}
        aria-controls="budg-agent-dialog"
        aria-expanded={open}
        className={cn(
          'fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-3 z-50',
          'h-12 w-12 items-center justify-center rounded-full bg-foreground text-background shadow-lg',
          'transition-transform hover:scale-105 active:scale-90 sm:bottom-6 sm:right-6 sm:h-14 sm:w-14',
          open ? 'hidden sm:flex' : 'flex',
        )}
      >
        {open ? (
          <X className="h-5 w-5 sm:h-6 sm:w-6" />
        ) : (
          <MessageCircle className="h-5 w-5 sm:h-6 sm:w-6" />
        )}
      </button>
    </>
  )
}

function ChatPanel({ onClose }: { onClose: () => void }) {
  const turns = useAgentStore((state) => state.turns)
  const loading = useAgentStore((state) => state.loading)
  const confirmationInFlight = useAgentStore((state) => state.confirmationInFlight)
  const pendingConfirmation = useAgentStore((state) => state.pendingConfirmation)
  const error = useAgentStore((state) => state.error)
  const send = useAgentStore((state) => state.send)
  const stop = useAgentStore((state) => state.stop)
  const reset = useAgentStore((state) => state.reset)
  const viewContext = useViewContext()

  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<AttachedImage[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  const [mobileModal, setMobileModal] = useState(() => window.innerWidth < 640)
  const panelRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const attachmentsRef = useRef<AttachedImage[]>([])
  const attachmentGenerationRef = useRef(0)

  attachmentsRef.current = attachments

  const lastTurn = turns.at(-1)
  const lastContentSize = lastTurn?.content.length ?? 0
  const lastToolCount = lastTurn?.toolActivity?.length ?? 0

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns.length, lastContentSize, lastToolCount, loading])

  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  useEffect(() => {
    const updateMode = () => setMobileModal(window.innerWidth < 640)
    window.addEventListener('resize', updateMode)
    return () => window.removeEventListener('resize', updateMode)
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !confirmationInFlight) {
        onClose()
        return
      }
      if (event.key !== 'Tab' || !mobileModal || !panelRef.current) return

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], textarea:not(:disabled), input:not([type="file"]):not(:disabled)',
        ),
      )
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === panelRef.current)
      ) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [confirmationInFlight, mobileModal, onClose])

  useEffect(
    () => () => {
      attachmentGenerationRef.current++
      attachmentsRef.current.forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl))
    },
    [],
  )

  const addFiles = async (files: FileList | File[]) => {
    setAttachError(null)
    const incoming = Array.from(files)
    if (incoming.length === 0) return

    const room = MAX_IMAGES_PER_MESSAGE - attachments.length
    if (room <= 0) {
      setAttachError(`Máximo ${MAX_IMAGES_PER_MESSAGE} imágenes por mensaje.`)
      return
    }

    const accepted: AttachedImage[] = []
    const generation = attachmentGenerationRef.current
    for (const file of incoming.slice(0, room)) {
      try {
        accepted.push(await fileToAttachedImage(file))
      } catch (err) {
        if (generation !== attachmentGenerationRef.current) {
          accepted.forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl))
          return
        }
        setAttachError(
          err instanceof ImageValidationError ? err.message : 'No se pudo adjuntar la imagen.',
        )
      }
    }
    if (generation !== attachmentGenerationRef.current) {
      accepted.forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl))
      return
    }
    if (accepted.length > 0) {
      setAttachments((current) => {
        const available = MAX_IMAGES_PER_MESSAGE - current.length
        const added = accepted.slice(0, available)
        accepted
          .slice(available)
          .forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl))
        return [...current, ...added]
      })
    }
  }

  const removeAttachment = (id: string) => {
    setAttachments((current) => {
      const target = current.find((attachment) => attachment.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return current.filter((attachment) => attachment.id !== id)
    })
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)
    if (imageFiles.length === 0) return
    event.preventDefault()
    void addFiles(imageFiles)
  }

  const sendMessage = (text: string, confirmationToken?: string) => {
    attachmentGenerationRef.current++
    const images = attachments.map(toAgentImage)
    void send(text, viewContext, confirmationToken, images.length > 0 ? images : undefined)
    attachments.forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl))
    setInput('')
    setAttachments([])
    setAttachError(null)
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if ((!input.trim() && attachments.length === 0) || loading) return
    sendMessage(input)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      if ((input.trim() || attachments.length > 0) && !loading) sendMessage(input)
    }
  }

  const handleReset = () => {
    attachmentGenerationRef.current++
    attachments.forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl))
    setAttachments([])
    setAttachError(null)
    setInput('')
    reset()
  }

  const canSend = (input.trim().length > 0 || attachments.length > 0) && !loading

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] animate-in fade-in sm:hidden"
        onClick={confirmationInFlight ? undefined : onClose}
        aria-hidden="true"
      />
      <div
        id="budg-agent-dialog"
        ref={panelRef}
        role="dialog"
        aria-modal={mobileModal || undefined}
        aria-labelledby="budg-agent-title"
        tabIndex={-1}
        className={cn(
          'fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl outline-none',
          'inset-x-3 bottom-[calc(6rem+env(safe-area-inset-bottom))] top-16',
          'sm:inset-auto sm:bottom-24 sm:right-6 sm:h-[42.5rem] sm:max-h-[calc(100dvh-7.5rem)] sm:w-[30rem]',
        )}
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4 pt-safe sm:pt-0">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span id="budg-agent-title" className="text-sm font-medium tracking-tight">
              Asistente budg
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleReset}
              disabled={turns.length === 0 || confirmationInFlight}
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
              aria-label="Nueva conversación"
              title="Nueva conversación"
            >
              <SquarePen className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={confirmationInFlight}
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:hidden"
              aria-label="Cerrar asistente budg"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div
          className="flex-1 overflow-y-auto px-4 py-6"
          role="log"
          aria-live="polite"
          aria-busy={loading}
        >
          {turns.length === 0 ? (
            <EmptyState
              disabled={loading}
              onSuggestion={(suggestion) => void send(suggestion, viewContext)}
            />
          ) : (
            <div className="flex flex-col gap-8">
              {turns.map((turn) => (
                <Message key={turn.id} turn={turn} />
              ))}
              <div ref={bottomRef} />
            </div>
          )}
          {error && turns.length === 0 && (
            <div className="rounded-lg bg-destructive/10 p-3 text-xs text-destructive">{error}</div>
          )}
        </div>

        {pendingConfirmation && !loading && (
          <div className="mx-4 mb-2 rounded-xl border border-border bg-muted/50 p-3">
            <p className="text-xs font-medium">¿Ejecuto esta acción?</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Revisa la propuesta del asistente antes de confirmar.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void send('Sí, confirmo.', viewContext, pendingConfirmation.token)}
                className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background"
              >
                Confirmar
              </button>
              <button
                type="button"
                onClick={() => void send('No, cancela esa acción.', viewContext)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        <div className="shrink-0 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-6">
          <form
            onSubmit={handleSubmit}
            className="rounded-2xl border border-input bg-muted/50 p-2 transition-colors focus-within:border-foreground/25"
          >
            {(attachments.length > 0 || attachError) && (
              <AttachmentPreview
                attachments={attachments}
                error={attachError}
                onRemove={removeAttachment}
              />
            )}
            <div className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic"
                multiple
                className="hidden"
                onChange={(event) => {
                  if (event.target.files) void addFiles(event.target.files)
                  event.target.value = ''
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading || attachments.length >= MAX_IMAGES_PER_MESSAGE}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent disabled:opacity-40"
                aria-label="Adjuntar imagen"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                disabled={loading}
                placeholder="Escribe un mensaje..."
                aria-label="Mensaje"
                rows={1}
                className="field-sizing-content max-h-44 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-5 outline-none placeholder:text-muted-foreground disabled:opacity-50"
              />
              {loading && !confirmationInFlight ? (
                <button
                  type="button"
                  onClick={stop}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground"
                  aria-label="Detener respuesta"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                </button>
              ) : loading ? (
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground"
                  aria-label="Confirmando acción"
                >
                  <span className="h-2 w-2 animate-pulse rounded-full bg-current" />
                </span>
              ) : (
                <button
                  type="submit"
                  disabled={!canSend}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-background disabled:opacity-40"
                  aria-label="Enviar mensaje"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </>
  )
}

function Message({ turn }: { turn: ChatTurn }) {
  if (turn.role === 'user') {
    return (
      <div className="flex w-full justify-end">
        <div className="flex max-w-[75%] flex-col items-end gap-2">
          {turn.images && turn.images.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2">
              {turn.images.map((image, index) => (
                <img
                  key={`${turn.id}-image-${index}`}
                  src={image.data}
                  alt={`Adjunto ${index + 1}`}
                  className="max-h-64 max-w-full rounded-2xl object-cover shadow-md ring-1 ring-border"
                />
              ))}
            </div>
          )}
          {turn.content ? (
            <div className="rounded-2xl bg-muted px-4 py-2.5 text-sm leading-6 break-words whitespace-pre-wrap shadow-sm ring-1 ring-border">
              {turn.content}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Imagen adjunta</span>
          )}
        </div>
      </div>
    )
  }

  const streaming = turn.status === 'sending'
  const hasTools = Boolean(turn.toolActivity?.length)

  return (
    <div className="w-full min-w-0">
      {streaming && !turn.content && !hasTools ? (
        <TypingDots />
      ) : (
        <>
          {hasTools && <ToolActivity steps={turn.toolActivity ?? []} streaming={streaming} />}
          {turn.content && turn.status !== 'error' && (
            <Suspense fallback={<p className="text-sm leading-6">{turn.content}</p>}>
              <AgentMarkdown>{turn.content}</AgentMarkdown>
            </Suspense>
          )}
          {streaming && <StreamingCursor />}
        </>
      )}
      {turn.status === 'error' && (
        <p className="mt-1 text-xs text-destructive">
          {turn.content || 'No se pudo completar la respuesta.'}
        </p>
      )}
      {turn.status === 'aborted' && !turn.content && !hasTools && (
        <p className="text-xs text-muted-foreground">Respuesta detenida.</p>
      )}
    </div>
  )
}

function TypingDots() {
  return (
    <span className="flex items-center gap-1 py-2" aria-label="El asistente está escribiendo">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground"
          style={{ animationDelay: `${delay}ms` }}
          aria-hidden="true"
        />
      ))}
    </span>
  )
}

function StreamingCursor() {
  return (
    <span
      className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse rounded-sm bg-muted-foreground align-baseline"
      aria-hidden="true"
    />
  )
}

function EmptyState({
  disabled,
  onSuggestion,
}: {
  disabled: boolean
  onSuggestion: (text: string) => void
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
      <div className="space-y-2">
        <h2 className="text-xl font-medium tracking-tight">¿En qué te ayudo?</h2>
        <p className="text-sm text-muted-foreground">
          Consulta tus finanzas o registra movimientos con ayuda del asistente.
        </p>
      </div>
      <div className="flex max-w-md flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            disabled={disabled}
            onClick={() => onSuggestion(suggestion)}
            className="rounded-full border border-border px-3.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  )
}

function AttachmentPreview({
  attachments,
  error,
  onRemove,
}: {
  attachments: AttachedImage[]
  error: string | null
  onRemove: (id: string) => void
}) {
  return (
    <div className="px-1 pb-2 pt-1">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((image) => (
            <div key={image.id} className="group relative">
              <img
                src={image.previewUrl}
                alt={image.name}
                className="h-14 w-14 rounded-lg object-cover ring-1 ring-border"
              />
              <button
                type="button"
                onClick={() => onRemove(image.id)}
                aria-label={`Quitar ${image.name}`}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background opacity-100 shadow ring-1 ring-border transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
    </div>
  )
}
