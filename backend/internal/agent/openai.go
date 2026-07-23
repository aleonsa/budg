package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/responses"
	"github.com/openai/openai-go/v3/shared"
)

// OpenAIProvider adapts the official OpenAI Responses API to the agent's
// normalized Provider contract. It owns only transport concerns: request
// mapping, stream translation, and response normalization. Loop control,
// validation policy, and tool dispatch live in the harness, not here.
type OpenAIProvider struct {
	client *openai.Client
	model  string
}

// NewOpenAIProvider builds a provider bound to a specific model. The model is
// configuration supplied by the caller, never hardcoded in the harness.
func NewOpenAIProvider(client *openai.Client, model string) *OpenAIProvider {
	return &OpenAIProvider{client: client, model: model}
}

const structuredOutputSchemaName = "budg_agent_response"

// Respond streams a single model turn, forwarding normalized text deltas
// through emit and returning the terminal model response. The caller supplies
// a validated request; Respond revalidates defensively before any network use.
func (p *OpenAIProvider) Respond(
	ctx context.Context,
	request ModelRequest,
	emit func(ModelEvent) error,
) (ModelResponse, error) {
	if err := request.Validate(); err != nil {
		return ModelResponse{}, fmt.Errorf("invalid model request: %w", err)
	}
	if p.client == nil {
		return ModelResponse{}, errors.New("openai client is not configured")
	}

	params, err := p.buildParams(request)
	if err != nil {
		return ModelResponse{}, err
	}

	stream := p.client.Responses.NewStreaming(ctx, params)
	defer stream.Close()

	var final responses.Response
	completed := false

	for stream.Next() {
		event := stream.Current()
		switch event.Type {
		case "response.output_text.delta":
			if emit != nil && event.Delta != "" {
				if err := emit(ModelEvent{Type: ModelEventTextDelta, Delta: event.Delta}); err != nil {
					return ModelResponse{}, err
				}
			}
		case "response.completed":
			final = event.AsResponseCompleted().Response
			completed = true
		case "response.failed":
			return ModelResponse{}, fmt.Errorf("openai response failed: %s", event.Message)
		case "error":
			return ModelResponse{}, fmt.Errorf("openai stream error: %s", event.Message)
		}
	}
	if err := stream.Err(); err != nil {
		return ModelResponse{}, fmt.Errorf("openai stream: %w", err)
	}
	if !completed {
		return ModelResponse{}, errors.New("openai stream ended without a completed response")
	}

	return normalizeResponse(final)
}

func (p *OpenAIProvider) buildParams(request ModelRequest) (responses.ResponseNewParams, error) {
	schema, err := decodeSchemaObject(request.OutputSchema)
	if err != nil {
		return responses.ResponseNewParams{}, fmt.Errorf("output schema: %w", err)
	}

	params := responses.ResponseNewParams{
		Model:           shared.ResponsesModel(p.model),
		Instructions:    openai.String(request.Instructions),
		MaxOutputTokens: openai.Int(int64(request.MaxOutputTokens)),
		Input: responses.ResponseNewParamsInputUnion{
			OfInputItemList: buildInputItems(request.Messages),
		},
		Text: responses.ResponseTextConfigParam{
			Format: responses.ResponseFormatTextConfigParamOfJSONSchema(structuredOutputSchemaName, schema),
		},
	}

	if len(request.Tools) > 0 {
		tools := make([]responses.ToolUnionParam, 0, len(request.Tools))
		for _, tool := range request.Tools {
			parameters, err := decodeSchemaObject(tool.InputSchema)
			if err != nil {
				return responses.ResponseNewParams{}, fmt.Errorf("tool %q schema: %w", tool.Name, err)
			}
			toolParam := responses.ToolParamOfFunction(tool.Name, parameters, true)
			toolParam.OfFunction.Description = openai.String(tool.Description)
			tools = append(tools, toolParam)
		}
		params.Tools = tools
	}

	return params, nil
}

func buildInputItems(messages []Message) responses.ResponseInputParam {
	items := make(responses.ResponseInputParam, 0, len(messages))
	for _, message := range messages {
		role := responses.EasyInputMessageRoleUser
		if message.Role == RoleAssistant {
			role = responses.EasyInputMessageRoleAssistant
		}
		// A turn without images maps to a plain text message; a turn with
		// images maps to a multimodal content list (text part first, then one
		// input_image per attachment) so the vision model receives both.
		if len(message.Images) == 0 {
			items = append(items, responses.ResponseInputItemParamOfMessage(message.Content, role))
			continue
		}
		items = append(items, responses.ResponseInputItemParamOfMessage(buildContentList(message), role))
	}
	return items
}

func buildContentList(message Message) responses.ResponseInputMessageContentListParam {
	content := make(responses.ResponseInputMessageContentListParam, 0, len(message.Images)+1)
	if strings.TrimSpace(message.Content) != "" {
		content = append(content, responses.ResponseInputContentParamOfInputText(message.Content))
	}
	for _, image := range message.Images {
		part := responses.ResponseInputContentParamOfInputImage(responses.ResponseInputImageDetailAuto)
		part.OfInputImage.ImageURL = openai.String(imageDataURL(image))
		content = append(content, part)
	}
	return content
}

// imageDataURL returns a base64 data URL the Responses API accepts. If the
// caller already supplied a full data URL it is used unchanged; otherwise the
// raw base64 payload is wrapped with the declared MIME type.
func imageDataURL(image ContentImage) string {
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(image.Data)), "data:") {
		return image.Data
	}
	return fmt.Sprintf("data:%s;base64,%s", image.MimeType, image.Data)
}

func normalizeResponse(response responses.Response) (ModelResponse, error) {
	result := ModelResponse{
		Usage: Usage{
			InputTokens:  response.Usage.InputTokens,
			OutputTokens: response.Usage.OutputTokens,
		},
	}

	var text string
	for _, item := range response.Output {
		switch item.Type {
		case "function_call":
			call := item.AsFunctionCall()
			arguments := json.RawMessage(call.Arguments)
			if len(arguments) == 0 {
				arguments = json.RawMessage(`{}`)
			}
			result.ToolCalls = append(result.ToolCalls, ToolCall{
				ID:        call.CallID,
				Name:      call.Name,
				Arguments: arguments,
			})
		case "message":
			text += item.AsMessage().Content[0].AsOutputText().Text
		}
	}

	if len(result.ToolCalls) > 0 {
		result.FinishReason = FinishReasonToolCalls
		return result, nil
	}

	result.Output = json.RawMessage(text)
	result.FinishReason = FinishReasonCompleted
	return result, nil
}

func decodeSchemaObject(raw json.RawMessage) (map[string]any, error) {
	var schema map[string]any
	if err := json.Unmarshal(raw, &schema); err != nil {
		return nil, fmt.Errorf("decode schema object: %w", err)
	}
	return schema, nil
}
