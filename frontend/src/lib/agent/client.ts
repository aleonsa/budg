import { authFetch, backendUrl } from '@/lib/api/backend'
import type {
  AgentCompletedData,
  AgentErrorData,
  AgentEventType,
  AgentMessage,
  AgentSSEEvent,
  ResponseDeltaData,
  ToolProgressData,
  ViewContext,
} from './types'

export interface AgentChatCallbacks {
  onStarted?: () => void
  onDelta?: (data: ResponseDeltaData) => void
  onToolStarted?: (data: ToolProgressData) => void
  onToolCompleted?: (data: ToolProgressData) => void
  onError?: (data: AgentErrorData) => void
  onCompleted?: (data: AgentCompletedData) => void
}

export interface AgentChatParams {
  messages: AgentMessage[]
  viewContext?: ViewContext
  confirmationToken?: string
  signal?: AbortSignal
}

/**
 * Sends a chat turn to POST /v1/agent/chat and streams the SSE response.
 *
 * The Go backend writes `data: {...}\n\n` frames. Unlike EventSource (which
 * only supports GET), this uses fetch + ReadableStream so we can POST the
 * authenticated body and still process frames incrementally.
 *
 * Returns a promise that resolves when the stream ends (response.completed or
 * error frame). Throws only on network failure or auth problems; server-side
 * agent errors arrive as onError callbacks and then resolve normally, so the
 * caller can clean up the "loading" state in a single finally block.
 */
export async function streamAgentChat(
  params: AgentChatParams,
  callbacks: AgentChatCallbacks,
): Promise<void> {
  const response = await authFetch('/v1/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: params.messages,
      viewContext: params.viewContext ?? null,
      confirmationToken: params.confirmationToken ?? null,
    }),
    signal: params.signal,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: { message: 'Error desconocido.' } }))
    callbacks.onError?.({
      code: 'http_error',
      message: body.error?.message ?? `Error ${response.status}.`,
    })
    return
  }

  if (!response.body) {
    callbacks.onError?.({ code: 'no_stream', message: 'No se recibió respuesta del servidor.' })
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let terminalReceived = false

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // SSE frames are separated by a blank line. Process complete frames.
      let separatorIndex: number
      while ((separatorIndex = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, separatorIndex)
        buffer = buffer.slice(separatorIndex + 2)
        terminalReceived = processSSEFrame(frame, callbacks) || terminalReceived
        if (terminalReceived) {
          await reader.cancel()
          return
        }
      }
    }

    // Flush any trailing partial frame.
    if (buffer.trim()) {
      terminalReceived = processSSEFrame(buffer, callbacks) || terminalReceived
    }
    if (!terminalReceived) throw new Error('La respuesta se interrumpió antes de completarse.')
  } finally {
    reader.releaseLock()
  }
}

function processSSEFrame(frame: string, callbacks: AgentChatCallbacks): boolean {
  let terminalReceived = false
  // Each frame is one or more lines like `data: {...}`. The backend sends
  // exactly one `data:` line per frame, but we handle multiple defensively.
  for (const line of frame.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data: ')) continue

    const jsonStr = trimmed.slice(6)
    let event: AgentSSEEvent
    try {
      event = JSON.parse(jsonStr) as AgentSSEEvent
    } catch {
      continue // Skip malformed lines rather than crashing the whole stream.
    }

    terminalReceived = dispatchEvent(event, callbacks) || terminalReceived
  }
  return terminalReceived
}

function dispatchEvent(event: AgentSSEEvent, callbacks: AgentChatCallbacks): boolean {
  const eventType = event.type as AgentEventType
  switch (eventType) {
    case 'response.started':
      callbacks.onStarted?.()
      return false
    case 'response.delta':
      callbacks.onDelta?.(event.data as ResponseDeltaData)
      return false
    case 'tool.started':
      callbacks.onToolStarted?.(event.data as ToolProgressData)
      return false
    case 'tool.completed':
      callbacks.onToolCompleted?.(event.data as ToolProgressData)
      return false
    case 'error':
      callbacks.onError?.(event.data as AgentErrorData)
      return true
    case 'response.completed':
      callbacks.onCompleted?.(event.data as AgentCompletedData)
      return true
    default:
      return false
  }
}

export { backendUrl }
