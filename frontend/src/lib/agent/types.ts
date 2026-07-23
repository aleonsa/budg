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

// AgentImage is an image attached to a user turn (e.g. a receipt photo) for
// OCR/vision extraction. `data` is a base64 payload or a full data URL; the
// backend normalizes it to a data URL before sending it to the model.
export interface AgentImage {
  mimeType: string
  data: string
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  images?: AgentImage[]
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
