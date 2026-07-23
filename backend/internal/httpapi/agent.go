package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5/middleware"

	"github.com/aleonsa/budg/backend/internal/agent"
	"github.com/aleonsa/budg/backend/internal/auth"
)

// Agent is the subset of *agent.Service the HTTP layer depends on. Handlers
// depend on this narrow interface, not the concrete service, so tests can
// supply a fake without constructing a real provider or store.
type Agent interface {
	Chat(
		ctx context.Context,
		userID string,
		conversation []agent.Message,
		view *agent.ViewContext,
		confirmationToken string,
		emit func(agent.ModelEvent) error,
	) (agent.Result, error)
}

// maxAgentMessages and maxAgentMessageChars bound the request the client can
// send. There is no server-side conversation persistence in this phase (see
// docs/agentic/phase-2-backend-agent.md): the client resends the full
// conversation on every turn, so these limits protect the harness's own
// context/step budget from an oversized or runaway client payload.
const (
	maxAgentMessages     = 40
	maxAgentMessageChars = 4000
	// maxAgentImagesPerMessage caps how many image attachments a single turn
	// may carry. A user might photograph a couple of receipts at once, but
	// there is no legitimate reason to attach many; this bounds both the model
	// context cost and the request size before it reaches the harness.
	maxAgentImagesPerMessage = 4
)

// allowedAgentImageMimeTypes mirrors the agent contract's allow-list so the
// HTTP layer rejects an unsupported format with a clear 400 instead of
// surfacing it later as an opaque model error. agent.ContentImage.Validate
// enforces the same set defensively downstream.
var allowedAgentImageMimeTypes = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
	"image/webp": true,
	"image/heic": true,
}

// agentChatRequest is the wire shape of POST /v1/agent/chat. ConfirmationToken
// is the value the client received in a prior turn's response.completed frame
// (see agentCompletedFrame) when a mutation tool proposed an action; resend
// it verbatim, unmodified, on the turn where the user confirms. Send null (or
// omit setting it) on every other turn.
type agentChatRequest struct {
	Messages          []agent.Message    `json:"messages"`
	ViewContext       *agent.ViewContext `json:"viewContext"`
	ConfirmationToken *string            `json:"confirmationToken"`
}

func (r agentChatRequest) confirmationTokenValue() string {
	if r.ConfirmationToken == nil {
		return ""
	}
	return *r.ConfirmationToken
}

func validateAgentChatRequest(req agentChatRequest) string {
	if len(req.Messages) == 0 {
		return "messages must include at least one message"
	}
	if len(req.Messages) > maxAgentMessages {
		return fmt.Sprintf("messages must not exceed %d entries", maxAgentMessages)
	}
	for i, message := range req.Messages {
		switch message.Role {
		case agent.RoleUser, agent.RoleAssistant, agent.RoleTool:
		default:
			return fmt.Sprintf("messages[%d].role must be user, assistant, or tool", i)
		}
		// A turn is valid when it carries text, at least one image, or both.
		// An image-only turn ("here is my receipt") is a first-class Phase 4
		// use case, so empty content is allowed when images are present.
		if strings.TrimSpace(message.Content) == "" && len(message.Images) == 0 {
			return fmt.Sprintf("messages[%d] must include content or an image", i)
		}
		if len(message.Content) > maxAgentMessageChars {
			return fmt.Sprintf("messages[%d].content must not exceed %d characters", i, maxAgentMessageChars)
		}
		if len(message.Images) > maxAgentImagesPerMessage {
			return fmt.Sprintf("messages[%d].images must not exceed %d attachments", i, maxAgentImagesPerMessage)
		}
		for j, image := range message.Images {
			if !allowedAgentImageMimeTypes[strings.ToLower(strings.TrimSpace(image.MimeType))] {
				return fmt.Sprintf("messages[%d].images[%d].mimeType is not a supported image type", i, j)
			}
			if strings.TrimSpace(image.Data) == "" {
				return fmt.Sprintf("messages[%d].images[%d].data is required", i, j)
			}
		}
	}
	if req.Messages[len(req.Messages)-1].Role != agent.RoleUser {
		return "the last message must have role user"
	}
	return ""
}

type agentHandler struct {
	service Agent
}

// chat streams one agent turn over SSE. Every event is a single `data:` frame
// carrying a JSON envelope with an explicit type, so the client does not need
// to rely on named SSE event types, matching the normalized protocol in
// docs/agentic/phase-2-backend-agent.md.
func (h *agentHandler) chat(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{
			Error: apiError{Code: "unauthorized", Message: "a valid access token is required"},
		})
		return
	}

	var req agentChatRequest
	if err := decodeJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "request body is not valid JSON"},
		})
		return
	}
	if msg := validateAgentChatRequest(req); msg != "" {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: msg},
		})
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeInternalError(w, r, errors.New("response writer does not support flushing"), "could not start streaming response")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	stream := &agentSSEWriter{w: w, flusher: flusher, runID: middleware.GetReqID(r.Context())}
	stream.writeStarted()

	result, err := h.service.Chat(r.Context(), user.ID, req.Messages, req.ViewContext, req.confirmationTokenValue(), stream.writeModelEvent)
	if err != nil {
		switch {
		case errors.Is(err, context.Canceled):
			// The client disconnected. There is no one left to write to and
			// nothing actionable beyond what RequestID/Logger already record.
			return
		case errors.Is(err, context.DeadlineExceeded):
			slog.WarnContext(r.Context(), "agent chat exceeded its deadline", "path", r.URL.Path)
			stream.writeErrorFrame("timeout", "El asistente tardó demasiado en responder. Intenta de nuevo.")
		default:
			slog.ErrorContext(r.Context(), "agent chat failed", "error", err, "path", r.URL.Path)
			stream.writeErrorFrame("internal_error", "No se pudo completar la solicitud. Intenta de nuevo.")
		}
		return
	}

	switch result.Outcome {
	case agent.OutcomeCompleted:
		slog.InfoContext(r.Context(), "agent chat completed",
			"outcome", result.Outcome,
			"steps", result.Steps,
			"toolCalls", result.ToolCalls,
			"inputTokens", result.Usage.InputTokens,
			"outputTokens", result.Usage.OutputTokens,
		)
		stream.writeCompleted(result)
	case agent.OutcomeLimitReached:
		slog.WarnContext(r.Context(), "agent chat stopped at a hard limit", "steps", result.Steps, "toolCalls", result.ToolCalls)
		stream.writeErrorFrame("limit_reached", "El asistente alcanzó su límite de pasos o llamadas a herramientas. Intenta con una solicitud más simple.")
	default: // agent.OutcomeFailed and any future outcome this handler does not yet know about.
		slog.WarnContext(r.Context(), "agent chat failed closed", "outcome", result.Outcome, "steps", result.Steps, "toolCalls", result.ToolCalls)
		stream.writeErrorFrame("agent_failed", "No se pudo completar la solicitud. Intenta de nuevo.")
	}
}

// agentSSEEvent is the normalized envelope for every streamed frame. RunID
// reuses chi's per-request ID (already assigned by middleware.RequestID at
// the router root) instead of minting a new identifier, so agent events
// correlate with the same ID already used by access logs.
type agentSSEEvent struct {
	Type     string `json:"type"`
	RunID    string `json:"runId"`
	Sequence int    `json:"sequence"`
	Data     any    `json:"data,omitempty"`
}

type agentSSEWriter struct {
	w        http.ResponseWriter
	flusher  http.Flusher
	runID    string
	sequence int
}

// write streams one frame immediately. It returns the error (rather than
// swallowing it) only where the caller needs to detect a dead connection and
// abort the run early; see writeModelEvent.
func (s *agentSSEWriter) write(eventType string, data any) error {
	s.sequence++
	payload, err := json.Marshal(agentSSEEvent{Type: eventType, RunID: s.runID, Sequence: s.sequence, Data: data})
	if err != nil {
		return fmt.Errorf("marshal agent sse event: %w", err)
	}
	if _, err := fmt.Fprintf(s.w, "data: %s\n\n", payload); err != nil {
		return err
	}
	s.flusher.Flush()
	return nil
}

func (s *agentSSEWriter) writeStarted() {
	_ = s.write("response.started", nil)
}

// writeModelEvent adapts agent.ModelEvent to the wire protocol. Its error
// return is load-bearing: Runner and Provider treat a non-nil error from this
// callback as "the client is gone" and abort the in-flight run, which is
// exactly what should happen when the underlying write fails.
//
// ModelEventTextDelta is intentionally not forwarded here. The model only
// ever produces the FinalResponse JSON contract (never freeform prose), so
// its "text" deltas are raw structured-JSON characters as they are generated
// (confirmed live: a real run streamed dozens of fragments ending in things
// like `"}"`). That is not useful to render progressively in a chat UI, so
// clients see only tool.started/tool.completed for progress and the final
// response.completed frame. The underlying event still exists in the agent
// package's contract in case a future need (e.g. a "thinking..." indicator
// keyed off delta activity rather than content) wants it.
func (s *agentSSEWriter) writeModelEvent(event agent.ModelEvent) error {
	switch event.Type {
	case agent.ModelEventToolStarted:
		return s.write("tool.started", map[string]string{"tool": event.ToolName, "callId": event.ToolCallID})
	case agent.ModelEventToolCompleted:
		return s.write("tool.completed", map[string]string{"tool": event.ToolName, "callId": event.ToolCallID})
	default:
		return nil
	}
}

// agentCompletedFrame is the wire shape of a response.completed frame's data.
// Embedding agent.FinalResponse flattens status/message/summary/artifacts to
// the top level (Go's encoding/json promotes anonymous struct fields), with
// the confirmation fields alongside them when a mutation is pending. The raw
// token travels here -- attached by the harness, never produced or echoed by
// the model itself (see loop.go's extractPendingConfirmation) -- so the
// client can resend it verbatim as confirmationToken on the next turn.
type agentCompletedFrame struct {
	agent.FinalResponse
	ConfirmationToken     string `json:"confirmationToken,omitempty"`
	ConfirmationExpiresAt string `json:"confirmationExpiresAt,omitempty"`
}

func (s *agentSSEWriter) writeCompleted(result agent.Result) {
	frame := agentCompletedFrame{FinalResponse: result.Response}
	if result.PendingConfirmation != nil {
		frame.ConfirmationToken = result.PendingConfirmation.Token
		if !result.PendingConfirmation.ExpiresAt.IsZero() {
			frame.ConfirmationExpiresAt = result.PendingConfirmation.ExpiresAt.UTC().Format(time.RFC3339)
		}
	}
	_ = s.write("response.completed", frame)
}

// writeErrorFrame is a best-effort final frame: by the time an error
// terminates the run, the connection may already be broken, so its write
// error is intentionally ignored here (there is nothing further to do).
func (s *agentSSEWriter) writeErrorFrame(code, message string) {
	_ = s.write("error", map[string]string{"code": code, "message": message})
}
