package agent

import (
	"context"
	"errors"

	"github.com/aleonsa/budg/backend/internal/config"
)

// Service builds and runs per-request agents. It captures shared dependencies
// (the model provider, the read/write store, the confirmation engine, and
// bounded limits) once, then constructs a user-scoped runner for each
// request. Mutation tools are always registered alongside read tools
// whenever the agent itself is enabled -- there is no separate toggle for
// them, since every mutation still requires its own explicit confirmation
// round-trip regardless.
type Service struct {
	provider  Provider
	data      Store
	confirmer *Confirmer
	limits    Limits
}

// NewService wires the agent service from configuration. The provider is
// injected so tests and the HTTP layer can supply a real OpenAI adapter or a
// fake without changing this code.
func NewService(provider Provider, data Store, confirmer *Confirmer, cfg config.AgentConfig) (*Service, error) {
	if provider == nil {
		return nil, errors.New("provider is required")
	}
	if data == nil {
		return nil, errors.New("store is required")
	}
	if confirmer == nil {
		return nil, errors.New("confirmer is required")
	}
	limits := Limits{
		MaxSteps:        cfg.MaxSteps,
		MaxToolCalls:    cfg.MaxToolCalls,
		MaxOutputTokens: cfg.MaxOutputTokens,
	}
	if err := limits.validate(); err != nil {
		return nil, err
	}
	return &Service{provider: provider, data: data, confirmer: confirmer, limits: limits}, nil
}

// Chat runs one agent turn for a user. The userID must come from the verified
// JWT; view is optional screen context; confirmationToken is the value the
// client resent from a prior turn's PendingConfirmation, or "" if none.
// Emit streams text deltas; pass nil to ignore streaming.
func (s *Service) Chat(
	ctx context.Context,
	userID string,
	conversation []Message,
	view *ViewContext,
	confirmationToken string,
	emit func(ModelEvent) error,
) (Result, error) {
	if userID == "" {
		return Result{}, errors.New("user id is required")
	}
	registry := NewToolRegistry()
	if err := RegisterReadOnlyTools(registry, s.data, userID); err != nil {
		return Result{}, err
	}
	if err := RegisterMutationTools(registry, s.data, s.confirmer, userID); err != nil {
		return Result{}, err
	}
	runner, err := NewRunner(s.provider, registry, BuildSystemPrompt(view), s.limits)
	if err != nil {
		return Result{}, err
	}
	return runner.RunStreaming(WithConfirmationToken(ctx, confirmationToken), conversation, emit)
}
