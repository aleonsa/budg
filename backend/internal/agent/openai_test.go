package agent

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
)

// newTestProvider wires an OpenAIProvider against a stub Responses endpoint so
// the adapter is exercised without contacting the real API.
func newTestProvider(t *testing.T, handler http.HandlerFunc) *OpenAIProvider {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	client := openai.NewClient(
		option.WithAPIKey("test-key"),
		option.WithBaseURL(server.URL),
	)
	return NewOpenAIProvider(&client, "small-tool-model")
}

func sseResponse(t *testing.T, w http.ResponseWriter, events []string) {
	t.Helper()
	w.Header().Set("Content-Type", "text/event-stream")
	flusher, ok := w.(http.Flusher)
	if !ok {
		t.Fatal("response writer is not a flusher")
	}
	for _, event := range events {
		if _, err := w.Write([]byte(event)); err != nil {
			t.Fatalf("write sse event: %v", err)
		}
		flusher.Flush()
	}
}

func completedEvent(output string) string {
	response := map[string]any{
		"id":                  "resp_test",
		"object":              "response",
		"created_at":          0,
		"status":              "completed",
		"model":               "small-tool-model",
		"output":              []any{},
		"parallel_tool_calls": false,
		"tool_choice":         "auto",
		"tools":               []any{},
		"instructions":        "",
		"error":               nil,
		"incomplete_details":  nil,
		"metadata":            map[string]any{},
		"temperature":         1,
		"top_p":               1,
		"usage": map[string]any{
			"input_tokens":          11,
			"output_tokens":         7,
			"total_tokens":          18,
			"input_tokens_details":  map[string]any{"cached_tokens": 0},
			"output_tokens_details": map[string]any{"reasoning_tokens": 0},
		},
	}
	if output != "" {
		response["output"] = []any{
			map[string]any{
				"id":     "msg_1",
				"type":   "message",
				"role":   "assistant",
				"status": "completed",
				"content": []any{
					map[string]any{"type": "output_text", "text": output, "annotations": []any{}},
				},
			},
		}
	}
	payload, _ := json.Marshal(map[string]any{"type": "response.completed", "sequence_number": 1, "response": response})
	return "event: response.completed\ndata: " + string(payload) + "\n\n"
}

func toolCallCompletedEvent(callID, name, arguments string) string {
	response := map[string]any{
		"id":                  "resp_tool",
		"object":              "response",
		"created_at":          0,
		"status":              "completed",
		"model":               "small-tool-model",
		"parallel_tool_calls": false,
		"tool_choice":         "auto",
		"tools":               []any{},
		"instructions":        "",
		"error":               nil,
		"incomplete_details":  nil,
		"metadata":            map[string]any{},
		"temperature":         1,
		"top_p":               1,
		"output": []any{
			map[string]any{
				"id":        "fc_1",
				"type":      "function_call",
				"call_id":   callID,
				"name":      name,
				"arguments": arguments,
				"status":    "completed",
			},
		},
		"usage": map[string]any{
			"input_tokens":          5,
			"output_tokens":         3,
			"total_tokens":          8,
			"input_tokens_details":  map[string]any{"cached_tokens": 0},
			"output_tokens_details": map[string]any{"reasoning_tokens": 0},
		},
	}
	payload, _ := json.Marshal(map[string]any{"type": "response.completed", "sequence_number": 1, "response": response})
	return "event: response.completed\ndata: " + string(payload) + "\n\n"
}

func baseRequest() ModelRequest {
	return ModelRequest{
		Instructions: "Responde en español y usa tools cuando aplique.",
		Messages:     []Message{{Role: RoleUser, Content: "¿Cuánto gasté?"}},
		Tools: []ToolDefinition{{
			Name:        "search_transactions",
			Description: "Busca movimientos",
			InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false}`),
		}},
		OutputSchema:    json.RawMessage(`{"type":"object","additionalProperties":false}`),
		MaxOutputTokens: 1200,
	}
}

func TestOpenAIProviderSendsMappedRequest(t *testing.T) {
	var body map[string]any
	provider := newTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/responses" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		sseResponse(t, w, []string{completedEvent(`{"status":"completed"}`)})
	})

	deltas := make([]string, 0)
	response, err := provider.Respond(context.Background(), baseRequest(), func(event ModelEvent) error {
		if event.Type == ModelEventTextDelta {
			deltas = append(deltas, event.Delta)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("respond: %v", err)
	}

	if body["model"] != "small-tool-model" {
		t.Fatalf("model = %v", body["model"])
	}
	if body["instructions"] != "Responde en español y usa tools cuando aplique." {
		t.Fatalf("instructions = %v", body["instructions"])
	}
	if body["max_output_tokens"].(float64) != 1200 {
		t.Fatalf("max_output_tokens = %v", body["max_output_tokens"])
	}
	tools, ok := body["tools"].([]any)
	if !ok || len(tools) != 1 {
		t.Fatalf("tools payload = %v", body["tools"])
	}
	tool := tools[0].(map[string]any)
	if tool["name"] != "search_transactions" || tool["strict"] != true {
		t.Fatalf("tool payload = %v", tool)
	}
	if response.FinishReason != FinishReasonCompleted {
		t.Fatalf("finish reason = %q", response.FinishReason)
	}
	if string(response.Output) != `{"status":"completed"}` {
		t.Fatalf("output = %s", response.Output)
	}
	if response.Usage.InputTokens != 11 || response.Usage.OutputTokens != 7 {
		t.Fatalf("usage = %+v", response.Usage)
	}
}

func TestOpenAIProviderParsesToolCalls(t *testing.T) {
	provider := newTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
		sseResponse(t, w, []string{
			toolCallCompletedEvent("call_1", "search_transactions", `{"period":"month"}`),
		})
	})

	response, err := provider.Respond(context.Background(), baseRequest(), func(ModelEvent) error { return nil })
	if err != nil {
		t.Fatalf("respond: %v", err)
	}
	if response.FinishReason != FinishReasonToolCalls {
		t.Fatalf("finish reason = %q", response.FinishReason)
	}
	if len(response.ToolCalls) != 1 {
		t.Fatalf("tool calls = %+v", response.ToolCalls)
	}
	call := response.ToolCalls[0]
	if call.ID != "call_1" || call.Name != "search_transactions" {
		t.Fatalf("tool call = %+v", call)
	}
	if string(call.Arguments) != `{"period":"month"}` {
		t.Fatalf("tool call arguments = %s", call.Arguments)
	}
}

func TestOpenAIProviderStreamsTextDeltas(t *testing.T) {
	provider := newTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
		delta := func(text string) string {
			payload, _ := json.Marshal(map[string]any{
				"type":            "response.output_text.delta",
				"sequence_number": 1,
				"item_id":         "msg_1",
				"output_index":    0,
				"content_index":   0,
				"delta":           text,
			})
			return "event: response.output_text.delta\ndata: " + string(payload) + "\n\n"
		}
		sseResponse(t, w, []string{
			delta("Hola"),
			delta(" mundo"),
			completedEvent(`{"status":"completed"}`),
		})
	})

	var builder strings.Builder
	_, err := provider.Respond(context.Background(), baseRequest(), func(event ModelEvent) error {
		if event.Type == ModelEventTextDelta {
			builder.WriteString(event.Delta)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("respond: %v", err)
	}
	if builder.String() != "Hola mundo" {
		t.Fatalf("streamed text = %q", builder.String())
	}
}

// TestOpenAIProviderSendsImageContent verifies the Phase 4 multimodal mapping:
// a user message carrying an image is sent as a content list with both an
// input_text and an input_image part, and the image is wired as a base64 data
// URL. Raw base64 (no data: prefix) is normalized into a data URL using the
// declared MIME type.
func TestOpenAIProviderSendsImageContent(t *testing.T) {
	var body map[string]any
	provider := newTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		sseResponse(t, w, []string{completedEvent(`{"status":"completed"}`)})
	})

	request := baseRequest()
	request.Messages = []Message{{
		Role:    RoleUser,
		Content: "Registra este ticket",
		Images: []ContentImage{
			{MimeType: "image/jpeg", Data: "iVBORw0KGgoAAAA="},
			{MimeType: "image/png", Data: "data:image/png;base64,ALREADYURL="},
		},
	}}

	if _, err := provider.Respond(context.Background(), request, func(ModelEvent) error { return nil }); err != nil {
		t.Fatalf("respond: %v", err)
	}

	input, ok := body["input"].([]any)
	if !ok || len(input) != 1 {
		t.Fatalf("input payload = %v", body["input"])
	}
	msg := input[0].(map[string]any)
	content, ok := msg["content"].([]any)
	if !ok {
		t.Fatalf("expected content list, got %v", msg["content"])
	}
	if len(content) != 3 {
		t.Fatalf("want 1 text + 2 image parts, got %d: %v", len(content), content)
	}

	text := content[0].(map[string]any)
	if text["type"] != "input_text" || text["text"] != "Registra este ticket" {
		t.Fatalf("text part = %v", text)
	}

	img1 := content[1].(map[string]any)
	if img1["type"] != "input_image" {
		t.Fatalf("image part 1 type = %v", img1["type"])
	}
	if img1["image_url"] != "data:image/jpeg;base64,iVBORw0KGgoAAAA=" {
		t.Fatalf("raw base64 not normalized to data URL: %v", img1["image_url"])
	}

	img2 := content[2].(map[string]any)
	if img2["image_url"] != "data:image/png;base64,ALREADYURL=" {
		t.Fatalf("existing data URL should pass through unchanged: %v", img2["image_url"])
	}
}

func TestOpenAIProviderValidatesRequest(t *testing.T) {
	provider := NewOpenAIProvider(nil, "small-tool-model")
	invalid := baseRequest()
	invalid.Messages = nil
	if _, err := provider.Respond(context.Background(), invalid, func(ModelEvent) error { return nil }); err == nil {
		t.Fatal("Respond accepted invalid request")
	}
}
