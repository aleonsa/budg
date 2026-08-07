import { create } from 'zustand'
import type {
  AgentCompletedData,
  AgentImage,
  AgentMessage,
  PendingConfirmation,
  ViewContext,
} from '@/lib/agent/types'

export interface ChatTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  status?: 'sending' | 'done' | 'error' | 'aborted'
  toolActivity?: ToolActivityStep[]
  // Image attachments the user sent with this turn, kept for redisplay and to
  // rebuild the messages array on subsequent turns. UI-only preview URLs are
  // not stored here; only the wire payload is.
  images?: AgentImage[]
}

export interface ToolActivityStep {
  id: string
  callId: string
  tool: string
  status: 'running' | 'done' | 'warning' | 'failed' | 'cancelled'
}

interface AgentState {
  open: boolean
  turns: ChatTurn[]
  loading: boolean
  confirmationInFlight: boolean
  pendingConfirmation: PendingConfirmation | null
  error: string | null

  setOpen: (open: boolean) => void
  toggle: () => void
  send: (
    text: string,
    viewContext: ViewContext | null,
    confirmationToken?: string,
    images?: AgentImage[],
  ) => Promise<void>
  stop: () => void
  reset: () => void
}

let activeController: AbortController | null = null

/**
 * Agent chat store. Owns conversation state, the SSE-driven loading/error
 * lifecycle, and the pending-confirmation token the UI needs to resend on the
 * explicit confirmation action.
 *
 * The store does NOT persist across reloads (no localStorage): the backend's
 * confirmation tokens are stateless and self-contained, but the conversation
 * history is only kept client-side in this phase, so a reload naturally
 * starts fresh. A future phase may add server-side persistence.
 */
export const useAgentStore = create<AgentState>((set, get) => ({
  open: false,
  turns: [],
  loading: false,
  confirmationInFlight: false,
  pendingConfirmation: null,
  error: null,

  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
  stop: () => {
    if (!get().confirmationInFlight) activeController?.abort()
  },
  reset: () => {
    if (get().confirmationInFlight) return
    activeController?.abort()
    activeController = null
    set({
      turns: [],
      loading: false,
      confirmationInFlight: false,
      pendingConfirmation: null,
      error: null,
    })
  },

  send: async (text, viewContext, confirmationToken, images) => {
    const trimmed = text.trim()
    const attachments = images ?? []
    // A turn is valid with text, at least one image, or both — an image-only
    // "here is my receipt" turn is allowed (matches the backend contract).
    if ((!trimmed && attachments.length === 0) || get().loading) return

    const userTurn: ChatTurn = {
      id: cryptoTurnId(),
      role: 'user',
      content: trimmed,
      status: 'done',
      images: attachments.length > 0 ? attachments : undefined,
    }
    const assistantTurn: ChatTurn = {
      id: cryptoTurnId(),
      role: 'assistant',
      content: '',
      status: 'sending',
      toolActivity: [],
    }

    set((state) => ({
      turns: [...state.turns, userTurn, assistantTurn],
      loading: true,
      confirmationInFlight: Boolean(confirmationToken),
      error: null,
      // Clear any previous pending confirmation when the user sends a new
      // message — if they confirm, the token is passed explicitly via the
      // confirmationToken parameter; if they send something else, the old
      // token is stale.
      pendingConfirmation: confirmationToken ? state.pendingConfirmation : null,
    }))

    // Build the messages array the backend expects: all prior turns + the
    // new user message. Tool messages from the backend are internal to the
    // harness and never appear in the client conversation.
    const messages: AgentMessage[] = get()
      .turns.filter((t) => t.status === 'done')
      .map((t) => ({
        role: t.role,
        content: t.content,
        ...(t.images && t.images.length > 0 ? { images: t.images } : {}),
      }))

    // The last message in the array must be the new user message; remove the
    // placeholder assistant turn that was just appended.
    const lastUserIndex = messages.map((m) => m.role).lastIndexOf('user')
    const conversationMessages = messages.slice(0, lastUserIndex + 1)

    const controller = new AbortController()
    activeController = controller
    const isCurrentRun = () => activeController === controller

    try {
      const { streamAgentChat } = await import('@/lib/agent/client')
      await streamAgentChat(
        {
          messages: conversationMessages,
          viewContext: viewContext ?? undefined,
          confirmationToken,
          signal: controller.signal,
        },
        {
          onStarted: () => {
            if (!isCurrentRun()) return
            updateTurn(set, assistantTurn.id, { status: 'sending', content: '' })
          },
          onDelta: (data) => {
            if (!isCurrentRun()) return
            appendTurnContent(set, assistantTurn.id, data.delta)
          },
          onToolStarted: (data) => {
            if (!isCurrentRun()) return
            startToolActivity(set, assistantTurn.id, data)
          },
          onToolCompleted: (data) => {
            if (!isCurrentRun()) return
            completeToolActivity(set, assistantTurn.id, data.callId, data.status)
          },
          onError: (data) => {
            if (!isCurrentRun()) return
            settleToolActivity(set, assistantTurn.id, 'failed')
            updateTurn(set, assistantTurn.id, {
              status: 'error',
              content: data.message,
            })
            set({ loading: false, confirmationInFlight: false, error: data.message })
          },
          onCompleted: (data) => {
            if (!isCurrentRun()) return
            updateTurn(set, assistantTurn.id, {
              status: 'done',
              content: data.message,
            })
            set({
              loading: false,
              confirmationInFlight: false,
              pendingConfirmation: data.confirmationToken
                ? {
                    toolName: data.confirmationTool ?? '',
                    token: data.confirmationToken,
                    expiresAt: data.confirmationExpiresAt
                      ? new Date(data.confirmationExpiresAt)
                      : null,
                  }
                : null,
            })
          },
        },
      )
    } catch (err) {
      if (!isCurrentRun()) return
      if (controller.signal.aborted) {
        settleToolActivity(set, assistantTurn.id, 'cancelled')
        updateTurn(set, assistantTurn.id, { status: 'aborted' })
        set({ loading: false, confirmationInFlight: false })
        return
      }
      const message = err instanceof Error ? err.message : 'Error de conexión.'
      settleToolActivity(set, assistantTurn.id, 'failed')
      updateTurn(set, assistantTurn.id, { status: 'error', content: message })
      set({ loading: false, confirmationInFlight: false, error: message })
    } finally {
      if (activeController === controller) activeController = null
    }
  },
}))

function cryptoTurnId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `turn-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function updateTurn(
  set: (fn: (s: AgentState) => Partial<AgentState>) => void,
  turnId: string,
  patch: Partial<ChatTurn>,
): void {
  set((state) => ({
    turns: state.turns.map((turn) => (turn.id === turnId ? { ...turn, ...patch } : turn)),
  }))
}

function appendTurnContent(
  set: (fn: (s: AgentState) => Partial<AgentState>) => void,
  turnId: string,
  delta: string,
): void {
  if (!delta) return
  set((state) => ({
    turns: state.turns.map((turn) =>
      turn.id === turnId ? { ...turn, content: turn.content + delta } : turn,
    ),
  }))
}

function startToolActivity(
  set: (fn: (s: AgentState) => Partial<AgentState>) => void,
  turnId: string,
  data: { tool: string; callId: string },
): void {
  set((state) => ({
    turns: state.turns.map((turn) =>
      turn.id === turnId
        ? {
            ...turn,
            toolActivity: [
              ...(turn.toolActivity ?? []),
              {
                id: data.callId || `${data.tool}-${turn.toolActivity?.length ?? 0}`,
                callId: data.callId,
                tool: data.tool,
                status: 'running' as const,
              },
            ],
          }
        : turn,
    ),
  }))
}

function completeToolActivity(
  set: (fn: (s: AgentState) => Partial<AgentState>) => void,
  turnId: string,
  callId: string,
  status: 'success' | 'warning' | 'error' = 'success',
): void {
  const settledStatus = status === 'error' ? 'failed' : status === 'warning' ? 'warning' : 'done'
  set((state) => ({
    turns: state.turns.map((turn) =>
      turn.id === turnId
        ? {
            ...turn,
            toolActivity: turn.toolActivity?.map((step) =>
              step.callId === callId && step.status === 'running'
                ? { ...step, status: settledStatus }
                : step,
            ),
          }
        : turn,
    ),
  }))
}

function settleToolActivity(
  set: (fn: (s: AgentState) => Partial<AgentState>) => void,
  turnId: string,
  status: 'failed' | 'cancelled',
): void {
  set((state) => ({
    turns: state.turns.map((turn) =>
      turn.id === turnId
        ? {
            ...turn,
            toolActivity: turn.toolActivity?.map((step) =>
              step.status === 'running' ? { ...step, status } : step,
            ),
          }
        : turn,
    ),
  }))
}

export type { AgentCompletedData }
