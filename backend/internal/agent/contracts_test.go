package agent

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
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

// TestStrictSchemaRequiresEveryPropertyListed guards against a live 400 from
// OpenAI's strict function-calling mode: unlike plain JSON Schema, it treats
// "required" as mandatory and requires every key in "properties" to appear
// there. A property meant to be optional must instead allow null in its own
// type (see tools_read.go). This was previously only caught by a live OpenAI
// call; it must fail here, at tool-registration time, instead.
func TestStrictSchemaRequiresEveryPropertyListed(t *testing.T) {
	missingRequired := json.RawMessage(`{
		"type": "object",
		"additionalProperties": false,
		"properties": {
			"includeInactive": {"type": "boolean"}
		}
	}`)
	if err := validateStrictObjectSchema(missingRequired); err == nil {
		t.Fatal("schema with a property missing from required was accepted")
	}

	requiredNotArray := json.RawMessage(`{
		"type": "object",
		"additionalProperties": false,
		"required": "includeInactive",
		"properties": {
			"includeInactive": {"type": "boolean"}
		}
	}`)
	if err := validateStrictObjectSchema(requiredNotArray); err == nil {
		t.Fatal("schema with non-array required was accepted")
	}

	nullablePattern := json.RawMessage(`{
		"type": "object",
		"additionalProperties": false,
		"required": ["includeInactive"],
		"properties": {
			"includeInactive": {"type": ["boolean", "null"], "description": "null si no aplica"}
		}
	}`)
	if err := validateStrictObjectSchema(nullablePattern); err != nil {
		t.Fatalf("valid nullable-optional schema rejected: %v", err)
	}

	noProperties := json.RawMessage(`{"type": "object", "additionalProperties": false}`)
	if err := validateStrictObjectSchema(noProperties); err != nil {
		t.Fatalf("schema with no properties should not need required: %v", err)
	}
}

// TestModelRequestValidatesImages guards the Phase 4 multimodal contract:
// a user message may carry attached images, but each attachment must declare
// an allow-listed MIME type and stay within the size bound so we never blow up
// the model context with an oversized payload. A message that only carries an
// image (no text) is valid, since an OCR-only "here is my receipt" turn is a
// legitimate use case.
func TestModelRequestValidatesImages(t *testing.T) {
	base := func() ModelRequest {
		return ModelRequest{
			Instructions:    "Extract receipt data.",
			Messages:        []Message{{Role: RoleUser, Content: "Registra este ticket", Images: []ContentImage{{MimeType: "image/jpeg", Data: "iVBORw0KGgo="}}}},
			OutputSchema:    json.RawMessage(`{"type":"object","additionalProperties":false}`),
			MaxOutputTokens: 1200,
		}
	}

	if err := base().Validate(); err != nil {
		t.Fatalf("valid request with image attachment rejected: %v", err)
	}

	imageOnly := base()
	imageOnly.Messages[0].Content = ""
	if err := imageOnly.Validate(); err != nil {
		t.Fatalf("image-only user message rejected: %v", err)
	}

	badMime := base()
	badMime.Messages[0].Images[0].MimeType = "application/pdf"
	if err := badMime.Validate(); err == nil {
		t.Fatal("image with disallowed MIME type accepted")
	}

	emptyData := base()
	emptyData.Messages[0].Images[0].Data = "   "
	if err := emptyData.Validate(); err == nil {
		t.Fatal("image with blank data accepted")
	}

	oversized := base()
	oversized.Messages[0].Images[0].Data = strings.Repeat("A", maxImageBytes+1)
	if err := oversized.Validate(); err == nil {
		t.Fatal("image exceeding size bound accepted")
	}

	emptyTurn := base()
	emptyTurn.Messages[0].Content = ""
	emptyTurn.Messages[0].Images = nil
	if err := emptyTurn.Validate(); err == nil {
		t.Fatal("message with neither content nor images accepted")
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
