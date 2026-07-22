package agent

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
)

func TestDecodeStrict(t *testing.T) {
	t.Run("validates and decodes known fields", func(t *testing.T) {
		got, err := DecodeStrict[FinalResponse]([]byte(`{
			"status":"completed",
			"message":"Listo",
			"summary":"Sin cambios",
			"artifacts":[]
		}`))
		if err != nil {
			t.Fatalf("decode strict: %v", err)
		}
		if got.Status != StatusCompleted || got.Message != "Listo" {
			t.Fatalf("decoded response = %+v", got)
		}
	})

	for _, tc := range []struct {
		name string
		raw  string
	}{
		{name: "unknown field", raw: `{"status":"completed","message":"ok","summary":"ok","artifacts":[],"extra":true}`},
		{name: "trailing JSON", raw: `{"status":"completed","message":"ok","summary":"ok","artifacts":[]} {}`},
		{name: "invalid status", raw: `{"status":"invented","message":"ok","summary":"ok","artifacts":[]}`},
		{name: "blank message", raw: `{"status":"completed","message":"","summary":"ok","artifacts":[]}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := DecodeStrict[FinalResponse]([]byte(tc.raw)); err == nil {
				t.Fatal("DecodeStrict accepted invalid response")
			}
		})
	}
}

func TestToolResultValidation(t *testing.T) {
	valid := ToolResult{
		Status:      ToolStatusSuccess,
		Summary:     "1 movimiento encontrado",
		Data:        json.RawMessage(`{"count":1}`),
		Retryable:   false,
		NextActions: []string{},
	}
	if err := valid.Validate(); err != nil {
		t.Fatalf("valid tool result rejected: %v", err)
	}

	invalid := valid
	invalid.Status = "unknown"
	if err := invalid.Validate(); err == nil {
		t.Fatal("invalid tool status accepted")
	}
}

func TestModelRequestValidation(t *testing.T) {
	request := ModelRequest{
		Instructions:    "Use tools when needed.",
		Messages:        []Message{{Role: RoleUser, Content: "¿Cuánto gasté?"}},
		Tools:           []ToolDefinition{{Name: "search_transactions", Description: "Busca movimientos", InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false}`)}},
		OutputSchema:    json.RawMessage(`{"type":"object","additionalProperties":false}`),
		MaxOutputTokens: 1200,
	}
	if err := request.Validate(); err != nil {
		t.Fatalf("valid model request rejected: %v", err)
	}

	request.Tools[0].InputSchema = json.RawMessage(`{"type":"object"}`)
	if err := request.Validate(); err == nil {
		t.Fatal("tool schema without additionalProperties=false accepted")
	}
}

type fakeProvider struct {
	response ModelResponse
	events   []ModelEvent
	err      error
}

func (f *fakeProvider) Respond(ctx context.Context, request ModelRequest, emit func(ModelEvent) error) (ModelResponse, error) {
	if err := ctx.Err(); err != nil {
		return ModelResponse{}, err
	}
	if err := request.Validate(); err != nil {
		return ModelResponse{}, err
	}
	for _, event := range f.events {
		if err := emit(event); err != nil {
			return ModelResponse{}, err
		}
	}
	return f.response, f.err
}

var _ Provider = (*fakeProvider)(nil)

func TestProviderContractStreamsNormalizedEvents(t *testing.T) {
	wantResponse := ModelResponse{FinishReason: FinishReasonCompleted, Output: json.RawMessage(`{"status":"completed"}`)}
	wantEvents := []ModelEvent{{Type: ModelEventTextDelta, Delta: "Hola"}}
	provider := &fakeProvider{response: wantResponse, events: wantEvents}
	request := ModelRequest{
		Instructions:    "Answer concisely.",
		Messages:        []Message{{Role: RoleUser, Content: "Hola"}},
		OutputSchema:    json.RawMessage(`{"type":"object","additionalProperties":false}`),
		MaxOutputTokens: 1200,
	}

	var gotEvents []ModelEvent
	gotResponse, err := provider.Respond(context.Background(), request, func(event ModelEvent) error {
		gotEvents = append(gotEvents, event)
		return nil
	})
	if err != nil {
		t.Fatalf("respond: %v", err)
	}
	if !reflect.DeepEqual(gotResponse, wantResponse) || !reflect.DeepEqual(gotEvents, wantEvents) {
		t.Fatalf("response/events = %+v/%+v", gotResponse, gotEvents)
	}
}

func TestProviderStopsWhenEmitterFails(t *testing.T) {
	wantErr := errors.New("client disconnected")
	provider := &fakeProvider{events: []ModelEvent{{Type: ModelEventTextDelta, Delta: "Hola"}}}
	request := ModelRequest{
		Instructions:    "Answer concisely.",
		Messages:        []Message{{Role: RoleUser, Content: "Hola"}},
		OutputSchema:    json.RawMessage(`{"type":"object","additionalProperties":false}`),
		MaxOutputTokens: 1200,
	}

	_, err := provider.Respond(context.Background(), request, func(ModelEvent) error { return wantErr })
	if !errors.Is(err, wantErr) {
		t.Fatalf("respond error = %v, want %v", err, wantErr)
	}
}
