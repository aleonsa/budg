package agent

import (
	"context"
	"errors"

	"github.com/aleonsa/budg/backend/internal/config"
)

// Service builds and runs per-request agents. It captures shared dependencies
// (the model provider, read store, and bounded limits) once, then constructs a
// user-scoped runner for each request.
type Service struct {
	provider Provider
	data     ReadStore
	limits   Limits
}

// NewService wires the agent service from configuration. The provider is
// injected so tests and the HTTP layer can supply a real OpenAI adapter or a
// fake without changing this code.
func NewService(provider Provider, data ReadStore, cfg config.AgentConfig) (*Service, error) {
	if provider == nil {
		return nil, errors.New("provider is required")
	}
	if data == nil {
		return nil, errors.New("read store is required")
	}
	limits := Limits{
		MaxSteps:        cfg.MaxSteps,
		MaxToolCalls:    cfg.MaxToolCalls,
		MaxOutputTokens: cfg.MaxOutputTokens,
	}
	if err := limits.validate(); err != nil {
		return nil, err
	}
	return &Service{provider: provider, data: data, limits: limits}, nil
}

// Chat runs one agent turn for a user. The userID must come from the verified
// JWT; view is optional screen context. Emit streams text deltas; pass nil to
// ignore streaming.
func (s *Service) Chat(
	ctx context.Context,
	userID string,
	conversation []Message,
	view *ViewContext,
	emit func(ModelEvent) error,
) (Result, error) {
	if userID == "" {
		return Result{}, errors.New("user id is required")
	}
	registry, err := NewReadOnlyToolRegistry(s.data, userID)
	if err != nil {
		return Result{}, err
	}
	runner, err := NewRunner(s.provider, registry, BuildSystemPrompt(view), s.limits)
	if err != nil {
		return Result{}, err
	}
	return runner.RunStreaming(ctx, conversation, emit)
}
