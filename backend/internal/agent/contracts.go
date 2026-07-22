package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

type ResponseStatus string

const (
	StatusCompleted            ResponseStatus = "completed"
	StatusNeedsInput           ResponseStatus = "needs_input"
	StatusConfirmationRequired ResponseStatus = "confirmation_required"
	StatusRefused              ResponseStatus = "refused"
)

type Artifact struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

type FinalResponse struct {
	Status    ResponseStatus `json:"status"`
	Message   string         `json:"message"`
	Summary   string         `json:"summary"`
	Artifacts []Artifact     `json:"artifacts"`
}

func (r FinalResponse) Validate() error {
	switch r.Status {
	case StatusCompleted, StatusNeedsInput, StatusConfirmationRequired, StatusRefused:
	default:
		return fmt.Errorf("invalid response status %q", r.Status)
	}
	if strings.TrimSpace(r.Message) == "" {
		return errors.New("response message is required")
	}
	if strings.TrimSpace(r.Summary) == "" {
		return errors.New("response summary is required")
	}
	for i, artifact := range r.Artifacts {
		if strings.TrimSpace(artifact.Type) == "" || strings.TrimSpace(artifact.ID) == "" {
			return fmt.Errorf("artifact %d requires type and id", i)
		}
	}
	return nil
}

type ToolStatus string

const (
	ToolStatusSuccess ToolStatus = "success"
	ToolStatusWarning ToolStatus = "warning"
	ToolStatusError   ToolStatus = "error"
)

type ToolResult struct {
	Status      ToolStatus      `json:"status"`
	Summary     string          `json:"summary"`
	Data        json.RawMessage `json:"data"`
	Retryable   bool            `json:"retryable"`
	NextActions []string        `json:"nextActions"`
}

func (r ToolResult) Validate() error {
	switch r.Status {
	case ToolStatusSuccess, ToolStatusWarning, ToolStatusError:
	default:
		return fmt.Errorf("invalid tool status %q", r.Status)
	}
	if strings.TrimSpace(r.Summary) == "" {
		return errors.New("tool result summary is required")
	}
	if len(r.Data) > 0 && !json.Valid(r.Data) {
		return errors.New("tool result data must be valid JSON")
	}
	for i, action := range r.NextActions {
		if strings.TrimSpace(action) == "" {
			return fmt.Errorf("next action %d is blank", i)
		}
	}
	return nil
}

type Role string

const (
	RoleUser      Role = "user"
	RoleAssistant Role = "assistant"
	RoleTool      Role = "tool"
)

type Message struct {
	Role    Role   `json:"role"`
	Content string `json:"content"`
}

type ToolDefinition struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"inputSchema"`
}

type ModelRequest struct {
	Instructions    string
	Messages        []Message
	Tools           []ToolDefinition
	OutputSchema    json.RawMessage
	MaxOutputTokens int
}

func (r ModelRequest) Validate() error {
	if strings.TrimSpace(r.Instructions) == "" {
		return errors.New("model instructions are required")
	}
	if len(r.Messages) == 0 {
		return errors.New("at least one model message is required")
	}
	for i, message := range r.Messages {
		switch message.Role {
		case RoleUser, RoleAssistant, RoleTool:
		default:
			return fmt.Errorf("message %d has invalid role %q", i, message.Role)
		}
		if strings.TrimSpace(message.Content) == "" {
			return fmt.Errorf("message %d content is required", i)
		}
	}
	if r.MaxOutputTokens < 64 || r.MaxOutputTokens > 8192 {
		return errors.New("max output tokens must be between 64 and 8192")
	}
	if err := validateStrictObjectSchema(r.OutputSchema); err != nil {
		return fmt.Errorf("output schema: %w", err)
	}
	seen := make(map[string]struct{}, len(r.Tools))
	for i, tool := range r.Tools {
		if strings.TrimSpace(tool.Name) == "" || strings.TrimSpace(tool.Description) == "" {
			return fmt.Errorf("tool %d requires name and description", i)
		}
		if _, exists := seen[tool.Name]; exists {
			return fmt.Errorf("duplicate tool name %q", tool.Name)
		}
		seen[tool.Name] = struct{}{}
		if err := validateStrictObjectSchema(tool.InputSchema); err != nil {
			return fmt.Errorf("tool %q input schema: %w", tool.Name, err)
		}
	}
	return nil
}

type ToolCall struct {
	ID        string
	Name      string
	Arguments json.RawMessage
}

type Usage struct {
	InputTokens  int64
	OutputTokens int64
}

type FinishReason string

const (
	FinishReasonCompleted FinishReason = "completed"
	FinishReasonToolCalls FinishReason = "tool_calls"
	FinishReasonRefused   FinishReason = "refused"
	FinishReasonLimited   FinishReason = "limited"
)

type ModelResponse struct {
	FinishReason FinishReason
	Output       json.RawMessage
	ToolCalls    []ToolCall
	Usage        Usage
}

type ModelEventType string

const (
	// ModelEventTextDelta carries an incremental chunk of streamed text from
	// the provider itself, emitted only by Provider.Respond.
	ModelEventTextDelta ModelEventType = "text_delta"
	// ModelEventToolStarted and ModelEventToolCompleted are emitted by the
	// Runner (not the provider) around each tool dispatch, so a caller
	// streaming this to a client can show progress ("checking your
	// accounts...") while a tool call is in flight.
	ModelEventToolStarted   ModelEventType = "tool_started"
	ModelEventToolCompleted ModelEventType = "tool_completed"
)

type ModelEvent struct {
	Type ModelEventType
	// Delta is set only for ModelEventTextDelta.
	Delta string
	// ToolName and ToolCallID are set only for the tool_started/tool_completed events.
	ToolName   string
	ToolCallID string
}

type Provider interface {
	Respond(context.Context, ModelRequest, func(ModelEvent) error) (ModelResponse, error)
}

func DecodeStrict[T any](raw []byte) (T, error) {
	var value T
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return value, fmt.Errorf("decode structured output: %w", err)
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return value, err
	}
	if validatable, ok := any(&value).(interface{ Validate() error }); ok {
		if err := validatable.Validate(); err != nil {
			return value, fmt.Errorf("validate structured output: %w", err)
		}
	}
	return value, nil
}

func ensureJSONEOF(decoder *json.Decoder) error {
	var extra any
	err := decoder.Decode(&extra)
	if errors.Is(err, io.EOF) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("decode trailing structured output: %w", err)
	}
	return errors.New("structured output contains multiple JSON values")
}

func validateStrictObjectSchema(raw json.RawMessage) error {
	if len(raw) == 0 {
		return errors.New("schema is required")
	}
	var schema map[string]any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&schema); err != nil {
		return fmt.Errorf("decode schema: %w", err)
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return err
	}
	if schema["type"] != "object" {
		return errors.New("schema type must be object")
	}
	additional, exists := schema["additionalProperties"]
	if !exists || additional != false {
		return errors.New("schema must set additionalProperties to false")
	}
	return nil
}
