package httpapi_test

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/aleonsa/budg/backend/internal/agent"
	"github.com/aleonsa/budg/backend/internal/httpapi"
)

// stubAgentService is a fake agent.Service replacement so handler tests never
// touch a real model provider or database.
type stubAgentService struct {
	result               agent.Result
	err                  error
	gotUserID            string
	gotMessages          []agent.Message
	gotView              *agent.ViewContext
	gotConfirmationToken string
	emitEvents           []agent.ModelEvent
	emitErrAfter         int // if > 0, the (emitErrAfter)-th emitted event returns an error
}

func (s *stubAgentService) Chat(
	_ context.Context,
	userID string,
	conversation []agent.Message,
	view *agent.ViewContext,
	confirmationToken string,
	emit func(agent.ModelEvent) error,
) (agent.Result, error) {
	s.gotUserID = userID
	s.gotMessages = conversation
	s.gotView = view
	s.gotConfirmationToken = confirmationToken
	for i, event := range s.emitEvents {
		if err := emit(event); err != nil {
			return agent.Result{}, err
		}
		if s.emitErrAfter > 0 && i+1 == s.emitErrAfter {
			return agent.Result{}, context.Canceled
		}
	}
	return s.result, s.err
}

func newAgentRouter(service httpapi.Agent) http.Handler {
	return httpapi.NewRouter(httpapi.Options{
		Database:          readyDatabase(),
		AuthMiddleware:    authenticatedMiddleware,
		Agent:             service,
		AgentRouteTimeout: time.Second,
	})
}

// sseFrames parses the recorder body into the JSON payload of each `data:`
// line, in order, mirroring how a real SSE client would read the stream.
func sseFrames(t *testing.T, body string) []map[string]any {
	t.Helper()
	var frames []map[string]any
	scanner := bufio.NewScanner(strings.NewReader(body))
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		var frame map[string]any
		if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &frame); err != nil {
			t.Fatalf("decode sse frame %q: %v", line, err)
		}
		frames = append(frames, frame)
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("scan sse body: %v", err)
	}
	return frames
}

func TestAgentChatRejectsUnauthenticatedRequests(t *testing.T) {
	t.Parallel()
	router := httpapi.NewRouter(httpapi.Options{
		Database: readyDatabase(),
		Agent:    &stubAgentService{},
		// No AuthMiddleware wired.
	})

	rec := doRequest(router, http.MethodPost, "/v1/agent/chat", `{"messages":[{"role":"user","content":"hola"}]}`)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestAgentChatRouteDoesNotExistWhenAgentDisabled(t *testing.T) {
	t.Parallel()
	router := httpapi.NewRouter(httpapi.Options{
		Database:       readyDatabase(),
		AuthMiddleware: authenticatedMiddleware,
		// Agent left nil, mirroring OPENAI_API_KEY absent.
	})

	rec := doRequest(router, http.MethodPost, "/v1/agent/chat", `{"messages":[{"role":"user","content":"hola"}]}`)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (route must not be mounted)", rec.Code)
	}
}

func TestAgentChatRejectsEmptyMessages(t *testing.T) {
	t.Parallel()
	router := newAgentRouter(&stubAgentService{})

	rec := doRequest(router, http.MethodPost, "/v1/agent/chat", `{"messages":[]}`)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestAgentChatRejectsLastMessageNotFromUser(t *testing.T) {
	t.Parallel()
	router := newAgentRouter(&stubAgentService{})

	rec := doRequest(router, http.MethodPost, "/v1/agent/chat",
		`{"messages":[{"role":"assistant","content":"hola"}]}`)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestAgentChatRejectsTooManyMessages(t *testing.T) {
	t.Parallel()
	messages := make([]map[string]string, 0, 41)
	for range 41 {
		messages = append(messages, map[string]string{"role": "user", "content": "hola"})
	}
	body, err := json.Marshal(map[string]any{"messages": messages})
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}
	router := newAgentRouter(&stubAgentService{})

	rec := doRequest(router, http.MethodPost, "/v1/agent/chat", string(body))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestAgentChatRejectsUnknownFields(t *testing.T) {
	t.Parallel()
	router := newAgentRouter(&stubAgentService{})

	rec := doRequest(router, http.MethodPost, "/v1/agent/chat",
		`{"messages":[{"role":"user","content":"hola"}],"bogus":true}`)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestAgentChatStreamsCompletedResponse(t *testing.T) {
	t.Parallel()
	stub := &stubAgentService{
		emitEvents: []agent.ModelEvent{
			{Type: agent.ModelEventToolStarted, ToolName: "search_transactions", ToolCallID: "c1"},
			{Type: agent.ModelEventToolCompleted, ToolName: "search_transactions", ToolCallID: "c1"},
			{Type: agent.ModelEventTextDelta, Delta: "Hola"},
			{Type: agent.ModelEventTextDelta, Delta: " mundo"},
		},
		result: agent.Result{
			Outcome: agent.OutcomeCompleted,
			Response: agent.FinalResponse{
				Status:    agent.StatusCompleted,
				Message:   "Gastaste MXN 250.00 en transporte.",
				Summary:   "1 movimiento",
				Artifacts: []agent.Artifact{},
			},
			Steps:     2,
			ToolCalls: 1,
		},
	}
	router := newAgentRouter(stub)
	view := map[string]string{"route": "/accounts/acc-1", "entityType": "account", "entityId": "acc-1"}
	body, _ := json.Marshal(map[string]any{
		"messages":    []map[string]string{{"role": "user", "content": "¿Cuánto gasté en transporte?"}},
		"viewContext": view,
	})

	rec := doRequest(router, http.MethodPost, "/v1/agent/chat", string(body))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("content-type = %q, want text/event-stream", ct)
	}

	if stub.gotUserID != "421d22c6-1f2f-465f-aaf8-27ffcbfcb920" {
		t.Fatalf("userID = %q, want the authenticated user's id", stub.gotUserID)
	}
	if stub.gotView == nil || stub.gotView.Route != "/accounts/acc-1" {
		t.Fatalf("view context not forwarded: %+v", stub.gotView)
	}
	if len(stub.gotMessages) != 1 || stub.gotMessages[0].Content != "¿Cuánto gasté en transporte?" {
		t.Fatalf("messages not forwarded: %+v", stub.gotMessages)
	}

	frames := sseFrames(t, rec.Body.String())
	// text_delta events must not be forwarded: the model only ever produces
	// the FinalResponse JSON contract, so its "text" deltas are raw
	// structured-JSON characters, not human-readable progressive text (see
	// writeModelEvent). Only started + tool.started + tool.completed +
	// completed should reach the wire, exactly 4 frames.
	if len(frames) != 4 {
		t.Fatalf("expected exactly 4 frames (started + tool.started + tool.completed + completed), got %d: %+v", len(frames), frames)
	}
	if frames[0]["type"] != "response.started" {
		t.Fatalf("first frame type = %v, want response.started", frames[0]["type"])
	}
	for _, frame := range frames {
		if frame["type"] == "response.delta" {
			t.Fatalf("response.delta must not be forwarded to the client: %+v", frame)
		}
	}
	last := frames[len(frames)-1]
	if last["type"] != "response.completed" {
		t.Fatalf("last frame type = %v, want response.completed", last["type"])
	}
	data, ok := last["data"].(map[string]any)
	if !ok || data["message"] != "Gastaste MXN 250.00 en transporte." {
		t.Fatalf("completed frame data = %+v", last["data"])
	}

	// Sequence numbers must be strictly increasing and share one runId.
	runID := frames[0]["runId"]
	for i, frame := range frames {
		if frame["runId"] != runID {
			t.Fatalf("frame %d runId = %v, want %v", i, frame["runId"], runID)
		}
		if int(frame["sequence"].(float64)) != i+1 {
			t.Fatalf("frame %d sequence = %v, want %d", i, frame["sequence"], i+1)
		}
	}
}

func TestAgentChatSurfacesLimitReachedAsSafeError(t *testing.T) {
	t.Parallel()
	stub := &stubAgentService{result: agent.Result{Outcome: agent.OutcomeLimitReached}}
	router := newAgentRouter(stub)

	rec := doRequest(router, http.MethodPost, "/v1/agent/chat",
		`{"messages":[{"role":"user","content":"sigue"}]}`)

	frames := sseFrames(t, rec.Body.String())
	last := frames[len(frames)-1]
	if last["type"] != "error" {
		t.Fatalf("last frame type = %v, want error", last["type"])
	}
	data := last["data"].(map[string]any)
	if data["code"] != "limit_reached" {
		t.Fatalf("error code = %v, want limit_reached", data["code"])
	}
}

func TestAgentChatSurfacesFailedOutcomeAsSafeError(t *testing.T) {
	t.Parallel()
	stub := &stubAgentService{result: agent.Result{Outcome: agent.OutcomeFailed}}
	router := newAgentRouter(stub)

	rec := doRequest(router, http.MethodPost, "/v1/agent/chat",
		`{"messages":[{"role":"user","content":"hola"}]}`)

	frames := sseFrames(t, rec.Body.String())
	last := frames[len(frames)-1]
	if last["type"] != "error" {
		t.Fatalf("last frame type = %v, want error", last["type"])
	}
	if data := last["data"].(map[string]any); data["code"] != "agent_failed" {
		t.Fatalf("error code = %v, want agent_failed", data["code"])
	}
}

func TestAgentChatSurfacesUnexpectedErrorSafely(t *testing.T) {
	t.Parallel()
	stub := &stubAgentService{err: fmt.Errorf("dial tcp 10.0.0.1:443: connection refused (secret=abc123)")}
	router := newAgentRouter(stub)

	rec := doRequest(router, http.MethodPost, "/v1/agent/chat",
		`{"messages":[{"role":"user","content":"hola"}]}`)

	frames := sseFrames(t, rec.Body.String())
	last := frames[len(frames)-1]
	if last["type"] != "error" {
		t.Fatalf("last frame type = %v, want error", last["type"])
	}
	data := last["data"].(map[string]any)
	if data["code"] != "internal_error" {
		t.Fatalf("error code = %v, want internal_error", data["code"])
	}
	if strings.Contains(fmt.Sprint(data["message"]), "secret") || strings.Contains(fmt.Sprint(data["message"]), "10.0.0.1") {
		t.Fatalf("internal error details leaked to client: %+v", data)
	}
}

func TestAgentChatForwardsConfirmationTokenToService(t *testing.T) {
	t.Parallel()
	stub := &stubAgentService{result: agent.Result{
		Outcome:  agent.OutcomeCompleted,
		Response: agent.FinalResponse{Status: agent.StatusCompleted, Message: "ok", Summary: "ok", Artifacts: []agent.Artifact{}},
	}}
	router := newAgentRouter(stub)

	rec := doRequest(router, http.MethodPost, "/v1/agent/chat",
		`{"messages":[{"role":"user","content":"sí, confirmo"}],"confirmationToken":"tok-abc123"}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if stub.gotConfirmationToken != "tok-abc123" {
		t.Fatalf("confirmation token forwarded = %q, want tok-abc123", stub.gotConfirmationToken)
	}
}

func TestAgentChatIncludesPendingConfirmationInCompletedFrame(t *testing.T) {
	t.Parallel()
	expiresAt := time.Date(2026, 7, 22, 16, 0, 0, 0, time.UTC)
	stub := &stubAgentService{result: agent.Result{
		Outcome: agent.OutcomeCompleted,
		Response: agent.FinalResponse{
			Status: agent.StatusConfirmationRequired, Message: "¿Confirmas el gasto?", Summary: "Propuesta", Artifacts: []agent.Artifact{},
		},
		PendingConfirmation: &agent.PendingConfirmation{ToolName: "create_transaction", Token: "tok-xyz789", ExpiresAt: expiresAt},
	}}
	router := newAgentRouter(stub)

	rec := doRequest(router, http.MethodPost, "/v1/agent/chat",
		`{"messages":[{"role":"user","content":"Registra un gasto"}]}`)

	frames := sseFrames(t, rec.Body.String())
	last := frames[len(frames)-1]
	if last["type"] != "response.completed" {
		t.Fatalf("last frame type = %v, want response.completed", last["type"])
	}
	data := last["data"].(map[string]any)
	if data["status"] != "confirmation_required" {
		t.Fatalf("status = %v, want confirmation_required", data["status"])
	}
	if data["confirmationToken"] != "tok-xyz789" {
		t.Fatalf("confirmationToken = %v, want tok-xyz789", data["confirmationToken"])
	}
	if data["confirmationExpiresAt"] != "2026-07-22T16:00:00Z" {
		t.Fatalf("confirmationExpiresAt = %v, want 2026-07-22T16:00:00Z", data["confirmationExpiresAt"])
	}
}

func TestAgentChatOmitsConfirmationFieldsWhenNoneIsPending(t *testing.T) {
	t.Parallel()
	stub := &stubAgentService{result: agent.Result{
		Outcome:  agent.OutcomeCompleted,
		Response: agent.FinalResponse{Status: agent.StatusCompleted, Message: "ok", Summary: "ok", Artifacts: []agent.Artifact{}},
	}}
	router := newAgentRouter(stub)

	rec := doRequest(router, http.MethodPost, "/v1/agent/chat",
		`{"messages":[{"role":"user","content":"hola"}]}`)

	frames := sseFrames(t, rec.Body.String())
	last := frames[len(frames)-1]
	data := last["data"].(map[string]any)
	if _, exists := data["confirmationToken"]; exists {
		t.Fatalf("confirmationToken should be omitted when there is no pending confirmation: %+v", data)
	}
}

func TestAgentChatWritesNothingFurtherAfterClientDisconnect(t *testing.T) {
	t.Parallel()
	// context.Canceled models a client that disconnected mid-stream. The
	// handler must not attempt to write a final frame in that case.
	stub := &stubAgentService{err: context.Canceled}
	router := newAgentRouter(stub)

	rec := doRequest(router, http.MethodPost, "/v1/agent/chat",
		`{"messages":[{"role":"user","content":"hola"}]}`)

	frames := sseFrames(t, rec.Body.String())
	// Only the initial response.started frame should exist; no error frame.
	for _, frame := range frames {
		if frame["type"] == "error" {
			t.Fatalf("wrote an error frame after client disconnect: %+v", frame)
		}
	}
}
