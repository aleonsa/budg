// Agent types — mirror the backend contracts in internal/agent/contracts.go
// and the SSE wire protocol in internal/httpapi/agent.go.

export type AgentResponseStatus = 'completed' | 'needs_input' | 'confirmation_required' | 'refused'

export interface AgentArtifact {
  type: string
  id: string
}

export interface AgentFinalResponse {
  status: AgentResponseStatus
  message: string
  summary: string
  artifacts: AgentArtifact[]
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
}

export interface ViewContext {
  route: string
  entityType?: string
  entityId?: string
  periodStart?: string
  periodEnd?: string
}

// SSE event types matching the backend's normalized frames.
export type AgentEventType =
  | 'response.started'
  | 'response.delta'
  | 'tool.started'
  | 'tool.completed'
  | 'response.completed'
  | 'error'

export interface AgentSSEEvent {
  type: AgentEventType
  runId: string
  sequence: number
  data?: unknown
}

export interface AgentCompletedData extends AgentFinalResponse {
  confirmationToken?: string
  confirmationExpiresAt?: string
}

export interface AgentErrorData {
  code: string
  message: string
}

export interface ToolProgressData {
  tool: string
  callId: string
}

export interface PendingConfirmation {
  toolName: string
  token: string
  expiresAt: Date | null
}
