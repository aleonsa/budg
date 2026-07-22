package agent

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/aleonsa/budg/backend/internal/config"
)

func testAgentConfig() config.AgentConfig {
	return config.AgentConfig{
		Enabled:         true,
		Model:           "small-tool-model",
		MaxSteps:        6,
		MaxToolCalls:    8,
		MaxOutputTokens: 1200,
	}
}

func TestServiceChatCompletesReadOnlyFlow(t *testing.T) {
	provider := &scriptedProvider{responses: []ModelResponse{
		{FinishReason: FinishReasonToolCalls, ToolCalls: []ToolCall{toolCall("c1", "get_financial_summary", `{"startDate":"2026-07-01","endDate":"2026-07-31"}`)}},
		{FinishReason: FinishReasonCompleted, Output: json.RawMessage(`{"status":"completed","message":"Gastaste MXN 700.00","summary":"Julio","artifacts":[]}`)},
	}}
	service, err := NewService(provider, sampleStore(), testConfirmer(t), testAgentConfig())
	if err != nil {
		t.Fatalf("new service: %v", err)
	}

	result, err := service.Chat(context.Background(), testUser, userTurn("¿Cuánto gasté en julio?"), nil, "", nil)
	if err != nil {
		t.Fatalf("chat: %v", err)
	}
	if result.Outcome != OutcomeCompleted || result.Response.Message != "Gastaste MXN 700.00" {
		t.Fatalf("result = %+v", result)
	}
	if result.ToolCalls != 1 {
		t.Fatalf("tool calls = %d", result.ToolCalls)
	}

	// The financial-summary tool result must have been fed back to the model.
	if len(provider.requests) != 2 {
		t.Fatalf("provider calls = %d", len(provider.requests))
	}
	sawSummary := false
	for _, message := range provider.requests[1].Messages {
		if message.Role == RoleTool && strings.Contains(message.Content, "get_financial_summary") {
			sawSummary = true
		}
	}
	if !sawSummary {
		t.Fatal("summary tool result not appended to conversation")
	}
}

func TestServiceChatInjectsViewContext(t *testing.T) {
	provider := &scriptedProvider{responses: []ModelResponse{
		{FinishReason: FinishReasonCompleted, Output: json.RawMessage(`{"status":"completed","message":"ok","summary":"ok","artifacts":[]}`)},
	}}
	service, err := NewService(provider, sampleStore(), testConfirmer(t), testAgentConfig())
	if err != nil {
		t.Fatalf("new service: %v", err)
	}

	view := &ViewContext{Route: "/accounts/acc-banamex", EntityType: "account", EntityID: "acc-banamex"}
	if _, err := service.Chat(context.Background(), testUser, userTurn("¿Qué cuenta es esta?"), view, "", nil); err != nil {
		t.Fatalf("chat: %v", err)
	}
	if !strings.Contains(provider.requests[0].Instructions, "/accounts/acc-banamex") {
		t.Fatalf("instructions missing view context: %q", provider.requests[0].Instructions)
	}
}

func TestServiceChatRequiresUserID(t *testing.T) {
	provider := &scriptedProvider{}
	service, err := NewService(provider, sampleStore(), testConfirmer(t), testAgentConfig())
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	if _, err := service.Chat(context.Background(), "", userTurn("Hola"), nil, "", nil); err == nil {
		t.Fatal("chat accepted empty user id")
	}
}

func TestNewServiceValidatesLimits(t *testing.T) {
	cfg := testAgentConfig()
	cfg.MaxSteps = 0
	if _, err := NewService(&scriptedProvider{}, sampleStore(), testConfirmer(t), cfg); err == nil {
		t.Fatal("service accepted invalid limits")
	}
}
