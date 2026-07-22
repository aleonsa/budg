import { create } from 'zustand'
import type {
  AgentCompletedData,
  AgentMessage,
  PendingConfirmation,
  ViewContext,
} from '@/lib/agent/types'

export interface ChatTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  status?: 'sending' | 'done' | 'error'
  toolActivity?: string[]
}

interface AgentState {
  open: boolean
  turns: ChatTurn[]
  loading: boolean
  pendingConfirmation: PendingConfirmation | null
  error: string | null

  setOpen: (open: boolean) => void
  toggle: () => void
  send: (text: string, viewContext: ViewContext | null, confirmationToken?: string) => Promise<void>
  reset: () => void
}

/**
 * Agent chat store. Owns conversation state, the SSE-driven loading/error
 * lifecycle, and the pending-confirmation token the UI needs to resend on the
 * user's next "yes, confirm" message.
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
  pendingConfirmation: null,
  error: null,

  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
  reset: () => set({ turns: [], loading: false, pendingConfirmation: null, error: null }),

  send: async (text, viewContext, confirmationToken) => {
    const trimmed = text.trim()
    if (!trimmed || get().loading) return

    const userTurn: ChatTurn = {
      id: cryptoTurnId(),
      role: 'user',
      content: trimmed,
      status: 'done',
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
      .map((t) => ({ role: t.role, content: t.content }))

    // The last message in the array must be the new user message; remove the
    // placeholder assistant turn that was just appended.
    const lastUserIndex = messages.map((m) => m.role).lastIndexOf('user')
    const conversationMessages = messages.slice(0, lastUserIndex + 1)

    try {
      const { streamAgentChat } = await import('@/lib/agent/client')
      await streamAgentChat(
        {
          messages: conversationMessages,
          viewContext: viewContext ?? undefined,
          confirmationToken,
        },
        {
          onStarted: () => {
            updateTurn(set, assistantTurn.id, { status: 'sending', content: '' })
          },
          onToolStarted: (data) => {
            appendToolActivity(set, assistantTurn.id, data.tool)
          },
          onToolCompleted: () => {
            // Tool completed — no visual change needed beyond the activity log.
          },
          onError: (data) => {
            updateTurn(set, assistantTurn.id, {
              status: 'error',
              content: data.message,
            })
            set({ loading: false, error: data.message })
          },
          onCompleted: (data) => {
            updateTurn(set, assistantTurn.id, {
              status: 'done',
              content: data.message,
            })
            set({
              loading: false,
              pendingConfirmation: data.confirmationToken
                ? {
                    toolName: '',
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
      const message = err instanceof Error ? err.message : 'Error de conexión.'
      updateTurn(set, assistantTurn.id, { status: 'error', content: message })
      set({ loading: false, error: message })
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

function appendToolActivity(
  set: (fn: (s: AgentState) => Partial<AgentState>) => void,
  turnId: string,
  tool: string,
): void {
  set((state) => ({
    turns: state.turns.map((turn) =>
      turn.id === turnId ? { ...turn, toolActivity: [...(turn.toolActivity ?? []), tool] } : turn,
    ),
  }))
}

export type { AgentCompletedData }
