package agent

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

// scriptedProvider returns a queued response per model call so loop behavior is
// deterministic and independent of any real model.
type scriptedProvider struct {
	responses []ModelResponse
	calls     int
	requests  []ModelRequest
}

func (p *scriptedProvider) Respond(ctx context.Context, request ModelRequest, emit func(ModelEvent) error) (ModelResponse, error) {
	if err := ctx.Err(); err != nil {
		return ModelResponse{}, err
	}
	if err := request.Validate(); err != nil {
		return ModelResponse{}, err
	}
	p.requests = append(p.requests, request)
	if p.calls >= len(p.responses) {
		return ModelResponse{}, errors.New("scriptedProvider: no response queued")
	}
	response := p.responses[p.calls]
	p.calls++
	return response, nil
}

func staticTool(name string, result ToolResult) Tool {
	return Tool{
		Definition: ToolDefinition{
			Name:        name,
			Description: "test tool " + name,
			InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false}`),
		},
		Handler: func(context.Context, json.RawMessage) (ToolResult, error) {
			return result, nil
		},
	}
}

func newTestRunner(t *testing.T, provider Provider, limits Limits, tools ...Tool) *Runner {
	t.Helper()
	registry := NewToolRegistry()
	for _, tool := range tools {
		if err := registry.Register(tool); err != nil {
			t.Fatalf("register tool %q: %v", tool.Definition.Name, err)
		}
	}
	runner, err := NewRunner(provider, registry, "Eres el asistente financiero de budg.", limits)
	if err != nil {
		t.Fatalf("new runner: %v", err)
	}
	return runner
}

func defaultLimits() Limits {
	return Limits{MaxSteps: 6, MaxToolCalls: 8, MaxOutputTokens: 1200}
}

func userTurn(text string) []Message {
	return []Message{{Role: RoleUser, Content: text}}
}

func toolCall(id, name, arguments string) ToolCall {
	return ToolCall{ID: id, Name: name, Arguments: json.RawMessage(arguments)}
}

func TestRunnerReturnsFinalResponse(t *testing.T) {
	provider := &scriptedProvider{responses: []ModelResponse{{
		FinishReason: FinishReasonCompleted,
		Output:       json.RawMessage(`{"status":"completed","message":"Listo","summary":"Sin cambios","artifacts":[]}`),
	}}}
	runner := newTestRunner(t, provider, defaultLimits())

	result, err := runner.Run(context.Background(), userTurn("Hola"))
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if result.Outcome != OutcomeCompleted {
		t.Fatalf("outcome = %q", result.Outcome)
	}
	if result.Response.Status != StatusCompleted || result.Response.Message != "Listo" {
		t.Fatalf("response = %+v", result.Response)
	}
	if result.Steps != 1 {
		t.Fatalf("steps = %d", result.Steps)
	}
}

func TestRunnerExecutesToolThenCompletes(t *testing.T) {
	provider := &scriptedProvider{responses: []ModelResponse{
		{FinishReason: FinishReasonToolCalls, ToolCalls: []ToolCall{toolCall("c1", "search_transactions", `{"period":"month"}`)}},
		{FinishReason: FinishReasonCompleted, Output: json.RawMessage(`{"status":"completed","message":"Gastaste 100","summary":"1 movimiento","artifacts":[]}`)},
	}}
	tool := staticTool("search_transactions", ToolResult{
		Status:      ToolStatusSuccess,
		Summary:     "1 movimiento encontrado",
		Data:        json.RawMessage(`{"count":1}`),
		NextActions: []string{},
	})
	runner := newTestRunner(t, provider, defaultLimits(), tool)

	result, err := runner.Run(context.Background(), userTurn("¿Cuánto gasté?"))
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if result.Outcome != OutcomeCompleted {
		t.Fatalf("outcome = %q", result.Outcome)
	}
	if result.ToolCalls != 1 || result.Steps != 2 {
		t.Fatalf("tool calls = %d, steps = %d", result.ToolCalls, result.Steps)
	}
	// The tool result must be fed back to the model on the second call.
	if len(provider.requests) != 2 {
		t.Fatalf("provider called %d times", len(provider.requests))
	}
	last := provider.requests[1].Messages
	found := false
	for _, message := range last {
		if message.Role == RoleTool && strings.Contains(message.Content, "1 movimiento encontrado") {
			found = true
		}
	}
	if !found {
		t.Fatal("tool result was not appended to conversation")
	}
}

func TestRunnerStopsOnDuplicateToolCall(t *testing.T) {
	duplicate := toolCall("c1", "search_transactions", `{"period":"month"}`)
	provider := &scriptedProvider{responses: []ModelResponse{
		{FinishReason: FinishReasonToolCalls, ToolCalls: []ToolCall{duplicate}},
		{FinishReason: FinishReasonToolCalls, ToolCalls: []ToolCall{duplicate}},
	}}
	tool := staticTool("search_transactions", ToolResult{Status: ToolStatusSuccess, Summary: "ok", NextActions: []string{}})
	runner := newTestRunner(t, provider, defaultLimits(), tool)

	result, err := runner.Run(context.Background(), userTurn("Repite"))
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if result.Outcome != OutcomeLimitReached {
		t.Fatalf("outcome = %q, want limit_reached", result.Outcome)
	}
}

func TestRunnerStopsAtMaxSteps(t *testing.T) {
	call := toolCall("c1", "search_transactions", `{}`)
	distinct := func(i int) ModelResponse {
		return ModelResponse{FinishReason: FinishReasonToolCalls, ToolCalls: []ToolCall{{ID: call.ID, Name: call.Name, Arguments: json.RawMessage(`{"n":` + string(rune('0'+i)) + `}`)}}}
	}
	provider := &scriptedProvider{responses: []ModelResponse{distinct(1), distinct(2), distinct(3), distinct(4), distinct(5), distinct(6)}}
	tool := staticTool("search_transactions", ToolResult{Status: ToolStatusSuccess, Summary: "ok", NextActions: []string{}})
	runner := newTestRunner(t, provider, Limits{MaxSteps: 3, MaxToolCalls: 8, MaxOutputTokens: 1200}, tool)

	result, err := runner.Run(context.Background(), userTurn("Sigue"))
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if result.Outcome != OutcomeLimitReached || result.Steps != 3 {
		t.Fatalf("outcome = %q, steps = %d", result.Outcome, result.Steps)
	}
}

func TestRunnerRejectsUnknownTool(t *testing.T) {
	provider := &scriptedProvider{responses: []ModelResponse{
		{FinishReason: FinishReasonToolCalls, ToolCalls: []ToolCall{toolCall("c1", "delete_everything", `{}`)}},
	}}
	runner := newTestRunner(t, provider, defaultLimits())

	result, err := runner.Run(context.Background(), userTurn("Borra todo"))
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if result.Outcome != OutcomeFailed {
		t.Fatalf("outcome = %q, want failed", result.Outcome)
	}
}

func TestRunnerRejectsInvalidFinalOutput(t *testing.T) {
	provider := &scriptedProvider{responses: []ModelResponse{
		{FinishReason: FinishReasonCompleted, Output: json.RawMessage(`{"status":"invented"}`)},
		{FinishReason: FinishReasonCompleted, Output: json.RawMessage(`{"status":"still-bad"}`)},
		{FinishReason: FinishReasonCompleted, Output: json.RawMessage(`{"status":"nope"}`)},
	}}
	runner := newTestRunner(t, provider, defaultLimits())

	result, err := runner.Run(context.Background(), userTurn("Hola"))
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if result.Outcome != OutcomeFailed {
		t.Fatalf("outcome = %q, want failed", result.Outcome)
	}
}

func TestRunnerRepairsInvalidOutputWithinBudget(t *testing.T) {
	provider := &scriptedProvider{responses: []ModelResponse{
		{FinishReason: FinishReasonCompleted, Output: json.RawMessage(`{"status":"invented"}`)},
		{FinishReason: FinishReasonCompleted, Output: json.RawMessage(`{"status":"completed","message":"Corregido","summary":"ok","artifacts":[]}`)},
	}}
	runner := newTestRunner(t, provider, defaultLimits())

	result, err := runner.Run(context.Background(), userTurn("Hola"))
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if result.Outcome != OutcomeCompleted || result.Response.Message != "Corregido" {
		t.Fatalf("outcome = %q, response = %+v", result.Outcome, result.Response)
	}
}

func TestRunnerHonorsContextCancellation(t *testing.T) {
	provider := &scriptedProvider{responses: []ModelResponse{{
		FinishReason: FinishReasonCompleted,
		Output:       json.RawMessage(`{"status":"completed","message":"Listo","summary":"ok","artifacts":[]}`),
	}}}
	runner := newTestRunner(t, provider, defaultLimits())

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := runner.Run(ctx, userTurn("Hola")); !errors.Is(err, context.Canceled) {
		t.Fatalf("run error = %v, want context.Canceled", err)
	}
}

func TestRunnerEmitsToolLifecycleEvents(t *testing.T) {
	provider := &scriptedProvider{responses: []ModelResponse{
		{FinishReason: FinishReasonToolCalls, ToolCalls: []ToolCall{toolCall("c1", "search_transactions", `{}`)}},
		{FinishReason: FinishReasonCompleted, Output: json.RawMessage(`{"status":"completed","message":"ok","summary":"ok","artifacts":[]}`)},
	}}
	tool := staticTool("search_transactions", ToolResult{Status: ToolStatusSuccess, Summary: "ok", NextActions: []string{}})
	runner := newTestRunner(t, provider, defaultLimits(), tool)

	var events []ModelEvent
	result, err := runner.RunStreaming(context.Background(), userTurn("Hola"), func(event ModelEvent) error {
		events = append(events, event)
		return nil
	})
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if result.Outcome != OutcomeCompleted {
		t.Fatalf("outcome = %q", result.Outcome)
	}

	var sawStarted, sawCompleted bool
	for _, event := range events {
		switch event.Type {
		case ModelEventToolStarted:
			if event.ToolName != "search_transactions" || event.ToolCallID != "c1" {
				t.Fatalf("tool_started event = %+v", event)
			}
			sawStarted = true
		case ModelEventToolCompleted:
			if sawStarted != true {
				t.Fatal("tool_completed emitted before tool_started")
			}
			if event.ToolName != "search_transactions" || event.ToolCallID != "c1" {
				t.Fatalf("tool_completed event = %+v", event)
			}
			sawCompleted = true
		}
	}
	if !sawStarted || !sawCompleted {
		t.Fatalf("missing tool lifecycle events: %+v", events)
	}
}

func TestRunnerDoesNotEmitToolCompletedOnDuplicateStop(t *testing.T) {
	duplicate := toolCall("c1", "search_transactions", `{}`)
	provider := &scriptedProvider{responses: []ModelResponse{
		{FinishReason: FinishReasonToolCalls, ToolCalls: []ToolCall{duplicate}},
		{FinishReason: FinishReasonToolCalls, ToolCalls: []ToolCall{duplicate}},
	}}
	tool := staticTool("search_transactions", ToolResult{Status: ToolStatusSuccess, Summary: "ok", NextActions: []string{}})
	runner := newTestRunner(t, provider, defaultLimits(), tool)

	var toolStartedCount, toolCompletedCount int
	result, err := runner.RunStreaming(context.Background(), userTurn("Repite"), func(event ModelEvent) error {
		switch event.Type {
		case ModelEventToolStarted:
			toolStartedCount++
		case ModelEventToolCompleted:
			toolCompletedCount++
		}
		return nil
	})
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if result.Outcome != OutcomeLimitReached {
		t.Fatalf("outcome = %q, want limit_reached", result.Outcome)
	}
	// The first call completes normally; the duplicate is caught before
	// dispatch even starts, so it must not emit either lifecycle event.
	if toolStartedCount != 1 || toolCompletedCount != 1 {
		t.Fatalf("tool_started=%d tool_completed=%d, want 1/1", toolStartedCount, toolCompletedCount)
	}
}

func TestRunnerRejectsEmptyConversation(t *testing.T) {
	provider := &scriptedProvider{}
	runner := newTestRunner(t, provider, defaultLimits())
	if _, err := runner.Run(context.Background(), nil); err == nil {
		t.Fatal("run accepted empty conversation")
	}
}
