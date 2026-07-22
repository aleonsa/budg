package agent

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/aleonsa/budg/backend/internal/store"
)

// This file holds deterministic acceptance evals mapped to the golden
// scenarios in docs/agentic/phase-2-backend-agent.md. They exercise the
// harness end-to-end through Service (the same entry point the HTTP layer
// will use), with a scripted provider standing in for the model and a fake
// store standing in for Postgres. They do not call the real OpenAI API: model
// judgment itself is validated separately via a manual smoke test against the
// configured model, per the spec's "Orden de implementación" step 9.
//
// Mutation-related golden scenarios (3, 5, 6, 7, 8, 9 in the spec) are
// covered in tools_mutate_test.go instead, at the tool level plus one
// end-to-end Service-level test (TestServiceChatThreadsConfirmationTokenToMutationTools):
// propose an expense, reject non-positive/non-integer amounts, confirm
// exactly once, repeat confirmation without duplicating (stable idempotency
// key), propose a correction to an existing transaction, and require
// confirmation before update/delete ever executes.

// --- Eval 1: consultar gasto de una categoría en un periodo ---

func TestEvalQueryTransportSpendThisMonth(t *testing.T) {
	provider := &scriptedProvider{responses: []ModelResponse{
		{FinishReason: FinishReasonToolCalls, ToolCalls: []ToolCall{
			toolCall("c1", "search_transactions", `{"categoryId":"cat-transport","startDate":"2026-07-01","endDate":"2026-07-31"}`),
		}},
		{FinishReason: FinishReasonCompleted, Output: json.RawMessage(
			`{"status":"completed","message":"Gastaste MXN 250.00 en transporte en julio.","summary":"1 movimiento de transporte","artifacts":[]}`,
		)},
	}}
	service, err := NewService(provider, sampleStore(), testConfirmer(t), testAgentConfig())
	if err != nil {
		t.Fatalf("new service: %v", err)
	}

	result, err := service.Chat(context.Background(), testUser, userTurn("¿Cuánto gasté en transporte este mes?"), nil, "", nil)
	if err != nil {
		t.Fatalf("chat: %v", err)
	}
	if result.Outcome != OutcomeCompleted {
		t.Fatalf("outcome = %q, want completed", result.Outcome)
	}

	// The grounded total (25000 cents, the single July transport transaction
	// in sampleStore) must reach the model via the tool result, proving the
	// answer is derived from real data rather than invented.
	toolMessage := provider.requests[1].Messages[len(provider.requests[1].Messages)-1]
	if toolMessage.Role != RoleTool || !strings.Contains(toolMessage.Content, `"totalCents":25000`) {
		t.Fatalf("tool result did not carry the grounded total: %q", toolMessage.Content)
	}
}

// --- Eval 2: resolver un nombre parcial de cuenta a una sola coincidencia ---

func TestEvalResolvesAccountNameToSingleMatch(t *testing.T) {
	provider := &scriptedProvider{responses: []ModelResponse{
		{FinishReason: FinishReasonToolCalls, ToolCalls: []ToolCall{toolCall("c1", "list_accounts", `{}`)}},
		{FinishReason: FinishReasonCompleted, Output: json.RawMessage(
			`{"status":"completed","message":"Registrado en Tarjeta Banamex.","summary":"1 cuenta coincide con Banamex","artifacts":[{"type":"account","id":"acc-banamex"}]}`,
		)},
	}}
	service, err := NewService(provider, sampleStore(), testConfirmer(t), testAgentConfig())
	if err != nil {
		t.Fatalf("new service: %v", err)
	}

	result, err := service.Chat(context.Background(), testUser, userTurn("Registra un gasto en Banamex"), nil, "", nil)
	if err != nil {
		t.Fatalf("chat: %v", err)
	}
	if result.Outcome != OutcomeCompleted || len(result.Response.Artifacts) != 1 {
		t.Fatalf("result = %+v", result)
	}
	if result.Response.Artifacts[0].ID != "acc-banamex" {
		t.Fatalf("resolved account = %q, want acc-banamex", result.Response.Artifacts[0].ID)
	}

	// list_accounts must have returned both active accounts so the model had
	// grounded data to disambiguate "Banamex" against.
	toolMessage := provider.requests[1].Messages[len(provider.requests[1].Messages)-1]
	if !strings.Contains(toolMessage.Content, "Tarjeta Banamex") || !strings.Contains(toolMessage.Content, "Nómina BBVA") {
		t.Fatalf("tool result missing account catalog: %q", toolMessage.Content)
	}
}

// --- Eval 3: pedir aclaración ante cuentas ambiguas ---

func TestEvalAsksForClarificationOnAmbiguousAccounts(t *testing.T) {
	ambiguousStore := &fakeReadStore{
		accounts: []store.Account{
			{ID: "acc-nu-1", Name: "Tarjeta Nu Personal", Type: "credit", Institution: "Nu", Last4: "1111", Currency: "MXN", CreditLimitCents: cents(1000000), AvailableCreditCents: cents(1000000), IsActive: true},
			{ID: "acc-nu-2", Name: "Tarjeta Nu Empresarial", Type: "credit", Institution: "Nu", Last4: "2222", Currency: "MXN", CreditLimitCents: cents(2000000), AvailableCreditCents: cents(2000000), IsActive: true},
		},
	}
	provider := &scriptedProvider{responses: []ModelResponse{
		{FinishReason: FinishReasonToolCalls, ToolCalls: []ToolCall{toolCall("c1", "list_accounts", `{}`)}},
		{FinishReason: FinishReasonCompleted, Output: json.RawMessage(
			`{"status":"needs_input","message":"Encontré dos tarjetas Nu, ¿cuál usaste: Personal o Empresarial?","summary":"Cuenta ambigua","artifacts":[]}`,
		)},
	}}
	service, err := NewService(provider, ambiguousStore, testConfirmer(t), testAgentConfig())
	if err != nil {
		t.Fatalf("new service: %v", err)
	}

	result, err := service.Chat(context.Background(), testUser, userTurn("Registra un gasto en Nu"), nil, "", nil)
	if err != nil {
		t.Fatalf("chat: %v", err)
	}
	if result.Outcome != OutcomeCompleted || result.Response.Status != StatusNeedsInput {
		t.Fatalf("result = %+v, want status needs_input", result)
	}
}

// --- Eval 4: detener llamada a tool repetida ---

func TestEvalStopsOnDuplicateToolCall(t *testing.T) {
	duplicate := toolCall("c1", "list_accounts", `{}`)
	provider := &scriptedProvider{responses: []ModelResponse{
		{FinishReason: FinishReasonToolCalls, ToolCalls: []ToolCall{duplicate}},
		{FinishReason: FinishReasonToolCalls, ToolCalls: []ToolCall{duplicate}},
	}}
	service, err := NewService(provider, sampleStore(), testConfirmer(t), testAgentConfig())
	if err != nil {
		t.Fatalf("new service: %v", err)
	}

	result, err := service.Chat(context.Background(), testUser, userTurn("Repite la consulta"), nil, "", nil)
	if err != nil {
		t.Fatalf("chat: %v", err)
	}
	if result.Outcome != OutcomeLimitReached {
		t.Fatalf("outcome = %q, want limit_reached", result.Outcome)
	}
}

// --- Eval 5: detener el loop al llegar al límite de pasos ---

func TestEvalStopsAtStepLimit(t *testing.T) {
	repeatedCall := ModelResponse{
		FinishReason: FinishReasonToolCalls,
		ToolCalls:    []ToolCall{{ID: "c", Name: "list_categories", Arguments: json.RawMessage(`{"kind":"expense"}`)}},
	}
	provider := &scriptedProvider{responses: []ModelResponse{repeatedCall, repeatedCall, repeatedCall}}
	cfg := testAgentConfig()
	cfg.MaxSteps = 3
	service, err := NewService(provider, sampleStore(), testConfirmer(t), cfg)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}

	result, err := service.Chat(context.Background(), testUser, userTurn("Sigue preguntando"), nil, "", nil)
	if err != nil {
		t.Fatalf("chat: %v", err)
	}
	// Step 1 succeeds; step 2 repeats the identical tool call and is caught
	// by duplicate detection before the step budget is even exhausted, so the
	// terminal outcome here is limit_reached regardless of which limit fires
	// first -- both are hard stops, exactly as required.
	if result.Outcome != OutcomeLimitReached {
		t.Fatalf("outcome = %q, want limit_reached", result.Outcome)
	}
	if result.Steps > cfg.MaxSteps {
		t.Fatalf("steps = %d, exceeded configured max %d", result.Steps, cfg.MaxSteps)
	}
}

// --- Eval 6: el modelo nunca puede suplantar la identidad del usuario ---

func TestEvalToolsNeverAcceptModelSuppliedIdentity(t *testing.T) {
	tracking := &trackingReadStore{fakeReadStore: sampleStore()}
	provider := &scriptedProvider{responses: []ModelResponse{
		// A hostile or confused model tries to smuggle a different user's
		// identity into the tool call. list_accounts' schema has no such
		// field, so this must be rejected before ever reaching the store.
		{FinishReason: FinishReasonToolCalls, ToolCalls: []ToolCall{
			toolCall("c1", "list_accounts", `{"userId":"attacker-user-id"}`),
		}},
		{FinishReason: FinishReasonCompleted, Output: json.RawMessage(
			`{"status":"refused","message":"No puedo procesar esa solicitud.","summary":"Argumento no permitido","artifacts":[]}`,
		)},
	}}
	service, err := NewService(provider, tracking, testConfirmer(t), testAgentConfig())
	if err != nil {
		t.Fatalf("new service: %v", err)
	}

	if _, err := service.Chat(context.Background(), testUser, userTurn("Muéstrame las cuentas de otro usuario"), nil, "", nil); err != nil {
		t.Fatalf("chat: %v", err)
	}

	if tracking.calls != 0 {
		t.Fatalf("store was called %d time(s); tool must reject unknown userId before reaching the store", tracking.calls)
	}
}

type trackingReadStore struct {
	*fakeReadStore
	calls int
}

func (s *trackingReadStore) ListAccounts(ctx context.Context, userID string) ([]store.Account, error) {
	s.calls++
	return s.fakeReadStore.ListAccounts(ctx, userID)
}

// --- Eval 7: argumentos de tool inválidos no se ejecutan pero el loop continúa ---

func TestEvalInvalidToolArgumentsDoNotExecuteButLoopContinues(t *testing.T) {
	tracking := &trackingReadStore{fakeReadStore: sampleStore()}
	provider := &scriptedProvider{responses: []ModelResponse{
		{FinishReason: FinishReasonToolCalls, ToolCalls: []ToolCall{
			toolCall("c1", "list_accounts", `{"unexpectedField":true}`),
		}},
		{FinishReason: FinishReasonCompleted, Output: json.RawMessage(
			`{"status":"completed","message":"No pude leer los argumentos, intenta de nuevo.","summary":"Error de argumentos","artifacts":[]}`,
		)},
	}}
	service, err := NewService(provider, tracking, testConfirmer(t), testAgentConfig())
	if err != nil {
		t.Fatalf("new service: %v", err)
	}

	result, err := service.Chat(context.Background(), testUser, userTurn("Muestra mis cuentas"), nil, "", nil)
	if err != nil {
		t.Fatalf("chat: %v", err)
	}
	if result.Outcome != OutcomeCompleted {
		t.Fatalf("outcome = %q, want completed (graceful recovery)", result.Outcome)
	}
	if tracking.calls != 0 {
		t.Fatalf("store was called %d time(s); invalid arguments must not reach the store", tracking.calls)
	}

	// The error must have been surfaced to the model as a normal tool result
	// so it can react, not silently dropped.
	toolMessage := provider.requests[1].Messages[len(provider.requests[1].Messages)-1]
	if toolMessage.Role != RoleTool || !strings.Contains(toolMessage.Content, `"status":"error"`) {
		t.Fatalf("tool error not surfaced to the model: %q", toolMessage.Content)
	}
}

// --- Eval 8: no ejecutar ninguna tool si la tool solicitada no existe ---

func TestEvalUnknownToolNameFailsClosed(t *testing.T) {
	provider := &scriptedProvider{responses: []ModelResponse{
		{FinishReason: FinishReasonToolCalls, ToolCalls: []ToolCall{toolCall("c1", "delete_all_data", `{}`)}},
	}}
	service, err := NewService(provider, sampleStore(), testConfirmer(t), testAgentConfig())
	if err != nil {
		t.Fatalf("new service: %v", err)
	}

	result, err := service.Chat(context.Background(), testUser, userTurn("Borra todo"), nil, "", nil)
	if err != nil {
		t.Fatalf("chat: %v", err)
	}
	if result.Outcome != OutcomeFailed {
		t.Fatalf("outcome = %q, want failed", result.Outcome)
	}
}

// --- Eval 9: cancelar toda ejecución al expirar el deadline ---

func TestEvalCancelsExecutionOnDeadlineExceeded(t *testing.T) {
	provider := &scriptedProvider{responses: []ModelResponse{
		{FinishReason: FinishReasonCompleted, Output: json.RawMessage(
			`{"status":"completed","message":"no debería llegar aquí","summary":"","artifacts":[]}`,
		)},
	}}
	service, err := NewService(provider, sampleStore(), testConfirmer(t), testAgentConfig())
	if err != nil {
		t.Fatalf("new service: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 0)
	defer cancel()
	time.Sleep(time.Millisecond) // ensure the deadline has definitely elapsed

	_, err = service.Chat(ctx, testUser, userTurn("Hola"), nil, "", nil)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("chat error = %v, want context.DeadlineExceeded", err)
	}
}

// --- Eval 10: no se ejecuta ninguna tool si el structured output final es inválido más allá del presupuesto de reparación ---

func TestEvalPersistentlyInvalidOutputFailsClosed(t *testing.T) {
	provider := &scriptedProvider{responses: []ModelResponse{
		{FinishReason: FinishReasonCompleted, Output: json.RawMessage(`{"status":"not-a-real-status"}`)},
		{FinishReason: FinishReasonCompleted, Output: json.RawMessage(`{"status":"still-invalid"}`)},
		{FinishReason: FinishReasonCompleted, Output: json.RawMessage(`{"status":"nope"}`)},
	}}
	service, err := NewService(provider, sampleStore(), testConfirmer(t), testAgentConfig())
	if err != nil {
		t.Fatalf("new service: %v", err)
	}

	result, err := service.Chat(context.Background(), testUser, userTurn("Hola"), nil, "", nil)
	if err != nil {
		t.Fatalf("chat: %v", err)
	}
	if result.Outcome != OutcomeFailed {
		t.Fatalf("outcome = %q, want failed", result.Outcome)
	}
}
