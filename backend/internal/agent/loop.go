package agent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Limits bounds a single run so the loop can never spin indefinitely or emit
// unbounded output. All values are hard stops enforced by the runner, not
// hints delegated to the model.
type Limits struct {
	MaxSteps        int
	MaxToolCalls    int
	MaxOutputTokens int
}

const maxSchemaRepairs = 2

func (l Limits) validate() error {
	if l.MaxSteps < 1 || l.MaxSteps > 12 {
		return errors.New("max steps must be between 1 and 12")
	}
	if l.MaxToolCalls < 1 || l.MaxToolCalls > 24 {
		return errors.New("max tool calls must be between 1 and 24")
	}
	if l.MaxOutputTokens < 64 || l.MaxOutputTokens > 8192 {
		return errors.New("max output tokens must be between 64 and 8192")
	}
	return nil
}

// Outcome is the terminal state of a run.
type Outcome string

const (
	OutcomeCompleted    Outcome = "completed"
	OutcomeLimitReached Outcome = "limit_reached"
	OutcomeFailed       Outcome = "failed"
)

// Result is the normalized output of a run. Response is only meaningful when
// Outcome is OutcomeCompleted. PendingConfirmation is set when a mutation
// tool proposed an action instead of executing it (see dispatchToolCalls);
// it is orthogonal to Outcome/Response, since the model's own FinalResponse
// still carries the human-readable "please confirm" message and status --
// PendingConfirmation only carries the machine-verifiable token the harness
// itself produced, which the model never sees or has to reproduce.
type Result struct {
	Outcome             Outcome
	Response            FinalResponse
	Steps               int
	ToolCalls           int
	Usage               Usage
	PendingConfirmation *PendingConfirmation
}

// Runner executes the bounded model/tool loop. It owns all control policy:
// step and tool budgets, duplicate-call detection, strict output validation,
// and tool dispatch. The provider only performs one model turn at a time.
type Runner struct {
	provider     Provider
	registry     *ToolRegistry
	instructions string
	limits       Limits
}

func NewRunner(provider Provider, registry *ToolRegistry, instructions string, limits Limits) (*Runner, error) {
	if provider == nil {
		return nil, errors.New("provider is required")
	}
	if registry == nil {
		return nil, errors.New("tool registry is required")
	}
	if strings.TrimSpace(instructions) == "" {
		return nil, errors.New("instructions are required")
	}
	if err := limits.validate(); err != nil {
		return nil, err
	}
	return &Runner{
		provider:     provider,
		registry:     registry,
		instructions: instructions,
		limits:       limits,
	}, nil
}

// Run drives the loop until a terminal outcome. Emit callbacks stream text
// deltas; pass nil to ignore streaming. Run revalidates every model output and
// stops deterministically on any limit, invalid output, or unknown tool.
func (r *Runner) Run(ctx context.Context, conversation []Message) (Result, error) {
	return r.RunStreaming(ctx, conversation, nil)
}

// RunStreaming is Run with a caller-supplied event sink for text deltas.
func (r *Runner) RunStreaming(ctx context.Context, conversation []Message, emit func(ModelEvent) error) (Result, error) {
	if len(conversation) == 0 {
		return Result{}, errors.New("conversation requires at least one message")
	}

	messages := append([]Message(nil), conversation...)
	seenToolCalls := make(map[string]struct{})
	result := Result{}
	repairs := 0

	for {
		if err := ctx.Err(); err != nil {
			return Result{}, err
		}
		if result.Steps >= r.limits.MaxSteps {
			result.Outcome = OutcomeLimitReached
			return result, nil
		}

		request := ModelRequest{
			Instructions:    r.instructions,
			Messages:        messages,
			Tools:           r.registry.Definitions(),
			OutputSchema:    finalResponseSchema,
			MaxOutputTokens: r.limits.MaxOutputTokens,
		}

		response, err := r.provider.Respond(ctx, request, emit)
		if err != nil {
			return Result{}, err
		}
		result.Steps++
		result.Usage.InputTokens += response.Usage.InputTokens
		result.Usage.OutputTokens += response.Usage.OutputTokens

		if response.FinishReason == FinishReasonToolCalls {
			outcome, appended, err := r.dispatchToolCalls(ctx, response.ToolCalls, seenToolCalls, &result, emit)
			if err != nil {
				return Result{}, err
			}
			if outcome != "" {
				result.Outcome = outcome
				return result, nil
			}
			messages = append(messages, appended...)
			continue
		}

		final, decodeErr := DecodeStrict[FinalResponse](response.Output)
		if decodeErr != nil {
			if repairs >= maxSchemaRepairs {
				result.Outcome = OutcomeFailed
				return result, nil
			}
			repairs++
			messages = append(messages, Message{
				Role:    RoleUser,
				Content: "La respuesta anterior no cumple el esquema requerido. Devuelve únicamente JSON válido acorde al contrato.",
			})
			continue
		}

		result.Outcome = OutcomeCompleted
		result.Response = final
		return result, nil
	}
}

// dispatchToolCalls executes each requested tool call in order. A non-empty
// Outcome means the loop must terminate immediately (limit or failure). The
// returned messages are the tool results to feed back into the conversation.
// emit, if non-nil, receives a tool_started event before each dispatch and a
// tool_completed event only after that dispatch finishes successfully, so a
// streaming client can render progress without waiting for the whole turn.
func (r *Runner) dispatchToolCalls(
	ctx context.Context,
	calls []ToolCall,
	seen map[string]struct{},
	result *Result,
	emit func(ModelEvent) error,
) (Outcome, []Message, error) {
	appended := make([]Message, 0, len(calls))

	for _, call := range calls {
		if result.ToolCalls >= r.limits.MaxToolCalls {
			return OutcomeLimitReached, nil, nil
		}

		fingerprint := toolCallFingerprint(call)
		if _, duplicate := seen[fingerprint]; duplicate {
			return OutcomeLimitReached, nil, nil
		}
		seen[fingerprint] = struct{}{}

		tool, ok := r.registry.lookup(call.Name)
		if !ok {
			return OutcomeFailed, nil, nil
		}
		if len(call.Arguments) > 0 && !json.Valid(call.Arguments) {
			return OutcomeFailed, nil, nil
		}

		if emit != nil {
			if err := emit(ModelEvent{Type: ModelEventToolStarted, ToolName: call.Name, ToolCallID: call.ID}); err != nil {
				return "", nil, err
			}
		}

		toolResult, err := tool.Handler(ctx, call.Arguments)
		if err != nil {
			if ctxErr := ctx.Err(); ctxErr != nil {
				return "", nil, ctxErr
			}
			return OutcomeFailed, nil, nil
		}
		if err := toolResult.Validate(); err != nil {
			return OutcomeFailed, nil, nil
		}

		result.ToolCalls++
		payload, err := json.Marshal(toolResult)
		if err != nil {
			return OutcomeFailed, nil, nil
		}
		appended = append(appended, Message{
			Role:    RoleTool,
			Content: fmt.Sprintf("%s: %s", call.Name, payload),
		})

		if pending := extractPendingConfirmation(call.Name, toolResult.Data); pending != nil {
			// Last one wins if a single response somehow proposes more than
			// one mutation in the same batch; a well-behaved model should
			// never do that, and both step/tool-call limits still bound the
			// harness safely either way.
			result.PendingConfirmation = pending
		}

		if emit != nil {
			if err := emit(ModelEvent{Type: ModelEventToolCompleted, ToolName: call.Name, ToolCallID: call.ID}); err != nil {
				return "", nil, err
			}
		}
	}

	return "", appended, nil
}

func toolCallFingerprint(call ToolCall) string {
	sum := sha256.Sum256([]byte(call.Name + "\x00" + string(call.Arguments)))
	return hex.EncodeToString(sum[:])
}

// extractPendingConfirmation probes a tool's result data for the two
// well-known optional keys any mutation tool includes when it proposes an
// action instead of executing it: confirmationToken and
// confirmationExpiresAt (RFC 3339). This is a generic, convention-based
// mechanism rather than a "is this tool a mutation tool" special case, so
// the loop stays uniform for every tool. Read-only tools simply never
// include these keys, so this is a no-op for them. A malformed or missing
// expiry does not fail the run: the token itself is still usable (Confirmer
// enforces the real, signed expiry independently), so the harness only
// loses the cosmetic expiresAt hint, never correctness.
func extractPendingConfirmation(toolName string, data json.RawMessage) *PendingConfirmation {
	if len(data) == 0 {
		return nil
	}
	var probe struct {
		ConfirmationToken     string `json:"confirmationToken"`
		ConfirmationExpiresAt string `json:"confirmationExpiresAt"`
	}
	if err := json.Unmarshal(data, &probe); err != nil || probe.ConfirmationToken == "" {
		return nil
	}
	expiresAt, _ := time.Parse(time.RFC3339, probe.ConfirmationExpiresAt)
	return &PendingConfirmation{ToolName: toolName, Token: probe.ConfirmationToken, ExpiresAt: expiresAt}
}

// finalResponseSchema is the strict JSON schema every completed response must
// satisfy. It mirrors FinalResponse and forbids unknown fields.
var finalResponseSchema = json.RawMessage(`{
	"type": "object",
	"additionalProperties": false,
	"required": ["status", "message", "summary", "artifacts"],
	"properties": {
		"status": {"type": "string", "enum": ["completed", "needs_input", "confirmation_required", "refused"]},
		"message": {"type": "string"},
		"summary": {"type": "string"},
		"artifacts": {
			"type": "array",
			"items": {
				"type": "object",
				"additionalProperties": false,
				"required": ["type", "id"],
				"properties": {
					"type": {"type": "string"},
					"id": {"type": "string"}
				}
			}
		}
	}
}`)
