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

// maxImageBytes bounds the size of a single attached image's encoded payload
// (base64 string or data URL). ~5 MiB keeps a receipt photo well within the
// model's context budget while still allowing a phone camera shot; anything
// larger is almost certainly not a receipt and would risk a provider error.
const maxImageBytes = 5 << 20 // 5 MiB

// allowedImageMimeTypes is the allow-list of image formats the vision model
// accepts for OCR. HEIC is included because iPhones default to it.
var allowedImageMimeTypes = map[string]struct{}{
	"image/jpeg": {},
	"image/png":  {},
	"image/webp": {},
	"image/heic": {},
}

// ContentImage is an image attached to a user turn (e.g. a photo of a receipt
// or transfer voucher) for OCR/vision extraction.
type ContentImage struct {
	MimeType string `json:"mimeType"` // e.g. image/jpeg, image/png
	Data     string `json:"data"`     // base64 or data URL
}

func (c ContentImage) Validate() error {
	if _, ok := allowedImageMimeTypes[strings.ToLower(strings.TrimSpace(c.MimeType))]; !ok {
		return fmt.Errorf("unsupported image MIME type %q", c.MimeType)
	}
	if strings.TrimSpace(c.Data) == "" {
		return errors.New("image data is required")
	}
	if len(c.Data) > maxImageBytes {
		return fmt.Errorf("image data exceeds %d byte limit", maxImageBytes)
	}
	return nil
}

type Message struct {
	Role    Role           `json:"role"`
	Content string         `json:"content"`
	Images  []ContentImage `json:"images,omitempty"`
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
		// A turn must carry either text or at least one image. An image-only
		// user turn ("here is my receipt") is legitimate for OCR, so we no
		// longer require non-empty content when images are present.
		if strings.TrimSpace(message.Content) == "" && len(message.Images) == 0 {
			return fmt.Errorf("message %d requires content or an image", i)
		}
		for j, image := range message.Images {
			if err := image.Validate(); err != nil {
				return fmt.Errorf("message %d image %d: %w", i, j, err)
			}
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

	properties, _ := schema["properties"].(map[string]any)
	if len(properties) == 0 {
		return nil
	}

	// OpenAI's strict function-calling mode (the only mode this harness
	// uses, see openai.go's ToolParamOfFunction(..., strict=true) call) does
	// not support properties omitted from "required": every property key
	// must be listed there. A field meant to be optional from the caller's
	// perspective expresses that by allowing null in its own "type" instead
	// (see tools_read.go for the pattern); Go's json.Unmarshal already
	// treats an explicit JSON null on a non-pointer field as "leave the zero
	// value", so no decode-side change is needed for that half of the
	// contract. This was missed during a prior review and only surfaced live
	// as an OpenAI 400 ("'required' is required to be supplied and to be an
	// array including every key in properties") -- enforcing it here catches
	// the same class of bug at tool-registration time instead.
	requiredRaw, requiredExists := schema["required"]
	if !requiredExists {
		return errors.New("schema with properties must set required listing every property key")
	}
	requiredList, ok := requiredRaw.([]any)
	if !ok {
		return errors.New("schema required must be an array")
	}
	required := make(map[string]struct{}, len(requiredList))
	for _, item := range requiredList {
		name, ok := item.(string)
		if !ok {
			return errors.New("schema required entries must be strings")
		}
		required[name] = struct{}{}
	}
	for key := range properties {
		if _, ok := required[key]; !ok {
			return fmt.Errorf("schema property %q is missing from required; OpenAI strict mode requires every property to be listed there (use a nullable type for optional fields)", key)
		}
	}
	return nil
}
