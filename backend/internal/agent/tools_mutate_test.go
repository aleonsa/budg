package agent

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/aleonsa/budg/backend/internal/store"
)

// fakeWriteStore extends fakeReadStore with the mutation methods WriteStore
// requires, capturing what was passed so tests can assert on it.
type fakeWriteStore struct {
	*fakeReadStore

	createCalls  int
	createInput  store.TransactionInput
	createResult store.Transaction
	createErr    error

	updateCalls  int
	updateID     string
	updatePatch  store.TransactionPatch
	updateResult store.Transaction
	updateErr    error

	deleteCalls int
	deleteID    string
	deleteErr   error
}

func (s *fakeWriteStore) CreateTransaction(_ context.Context, _ string, in store.TransactionInput) (store.Transaction, error) {
	s.createCalls++
	s.createInput = in
	if s.createErr != nil {
		return store.Transaction{}, s.createErr
	}
	result := s.createResult
	if result.ID == "" {
		result.ID = "new-tx-id"
	}
	return result, nil
}

func (s *fakeWriteStore) UpdateTransaction(_ context.Context, _, id string, patch store.TransactionPatch) (store.Transaction, error) {
	s.updateCalls++
	s.updateID = id
	s.updatePatch = patch
	if s.updateErr != nil {
		return store.Transaction{}, s.updateErr
	}
	return s.updateResult, nil
}

func (s *fakeWriteStore) DeleteTransaction(_ context.Context, _, id string) error {
	s.deleteCalls++
	s.deleteID = id
	return s.deleteErr
}

func sampleWriteStore() *fakeWriteStore {
	return &fakeWriteStore{fakeReadStore: sampleStore()}
}

func mustMutationRegistry(t *testing.T, data Store, confirmer *Confirmer) *ToolRegistry {
	t.Helper()
	registry := NewToolRegistry()
	if err := RegisterReadOnlyTools(registry, data, testUser); err != nil {
		t.Fatalf("register read-only tools: %v", err)
	}
	if err := RegisterMutationTools(registry, data, confirmer, testUser); err != nil {
		t.Fatalf("register mutation tools: %v", err)
	}
	return registry
}

type proposalData struct {
	Proposal              json.RawMessage `json:"proposal"`
	ConfirmationToken     string          `json:"confirmationToken"`
	ConfirmationExpiresAt string          `json:"confirmationExpiresAt"`
	RequiresConfirmation  bool            `json:"requiresConfirmation"`
}

func decodeProposal(t *testing.T, result ToolResult) proposalData {
	t.Helper()
	var proposal proposalData
	if err := json.Unmarshal(result.Data, &proposal); err != nil {
		t.Fatalf("decode proposal data: %v (raw: %s)", err, result.Data)
	}
	if proposal.ConfirmationToken == "" {
		t.Fatalf("result did not include a confirmationToken: %+v", result)
	}
	return proposal
}

// --- create_transaction ---

func TestCreateTransactionProposesWithoutExecuting(t *testing.T) {
	writeStore := sampleWriteStore()
	confirmer := testConfirmer(t)
	registry := mustMutationRegistry(t, writeStore, confirmer)
	tool, ok := registry.lookup("create_transaction")
	if !ok {
		t.Fatal("create_transaction tool not registered")
	}

	args := json.RawMessage(`{"type":"expense","amountCents":10000,"accountId":"acc-banamex","categoryId":"cat-food","date":"2026-07-20","description":"Restaurante","merchant":"La Buena","transferToAccountId":null}`)
	result, err := tool.Handler(context.Background(), args)
	if err != nil {
		t.Fatalf("handler: %v", err)
	}
	if result.Status != ToolStatusSuccess {
		t.Fatalf("status = %q, want success", result.Status)
	}
	proposal := decodeProposal(t, result)
	if !proposal.RequiresConfirmation {
		t.Fatal("proposal did not set requiresConfirmation")
	}
	if writeStore.createCalls != 0 {
		t.Fatalf("CreateTransaction was called %d times before confirmation", writeStore.createCalls)
	}
}

func TestCreateTransactionExecutesWithValidConfirmation(t *testing.T) {
	writeStore := sampleWriteStore()
	confirmer := testConfirmer(t)
	registry := mustMutationRegistry(t, writeStore, confirmer)
	tool, ok := registry.lookup("create_transaction")
	if !ok {
		t.Fatal("create_transaction tool not registered")
	}

	args := json.RawMessage(`{"type":"expense","amountCents":10000,"accountId":"acc-banamex","categoryId":"cat-food","date":"2026-07-20","description":"Restaurante","merchant":"La Buena","transferToAccountId":null}`)

	proposeResult, err := tool.Handler(context.Background(), args)
	if err != nil {
		t.Fatalf("propose: %v", err)
	}
	proposal := decodeProposal(t, proposeResult)

	ctx := WithConfirmationToken(context.Background(), proposal.ConfirmationToken)
	confirmResult, err := tool.Handler(ctx, args)
	if err != nil {
		t.Fatalf("confirm: %v", err)
	}
	if confirmResult.Status != ToolStatusSuccess {
		t.Fatalf("confirm status = %q, want success", confirmResult.Status)
	}
	if writeStore.createCalls != 1 {
		t.Fatalf("CreateTransaction called %d times, want 1", writeStore.createCalls)
	}
	if writeStore.createInput.AccountID != "acc-banamex" || writeStore.createInput.Amount != 10000 {
		t.Fatalf("create input = %+v", writeStore.createInput)
	}
	// The executed result must not itself look like a new pending proposal.
	var probe struct {
		ConfirmationToken string `json:"confirmationToken"`
	}
	_ = json.Unmarshal(confirmResult.Data, &probe)
	if probe.ConfirmationToken != "" {
		t.Fatalf("executed result unexpectedly carries a confirmationToken: %s", confirmResult.Data)
	}
}

func TestCreateTransactionRepeatedConfirmationUsesStableIdempotencyKey(t *testing.T) {
	writeStore := sampleWriteStore()
	confirmer := testConfirmer(t)
	registry := mustMutationRegistry(t, writeStore, confirmer)
	tool, _ := registry.lookup("create_transaction")

	args := json.RawMessage(`{"type":"expense","amountCents":10000,"accountId":"acc-banamex","categoryId":"cat-food","date":"2026-07-20","description":"Restaurante","merchant":"La Buena","transferToAccountId":null}`)
	proposeResult, err := tool.Handler(context.Background(), args)
	if err != nil {
		t.Fatalf("propose: %v", err)
	}
	proposal := decodeProposal(t, proposeResult)
	ctx := WithConfirmationToken(context.Background(), proposal.ConfirmationToken)

	if _, err := tool.Handler(ctx, args); err != nil {
		t.Fatalf("first confirm: %v", err)
	}
	firstKey := writeStore.createInput.IdempotencyKey

	if _, err := tool.Handler(ctx, args); err != nil {
		t.Fatalf("second confirm: %v", err)
	}
	secondKey := writeStore.createInput.IdempotencyKey

	if firstKey == nil || secondKey == nil || *firstKey == "" || *firstKey != *secondKey {
		t.Fatalf("idempotency key not stable across repeated confirmation: first=%v second=%v", firstKey, secondKey)
	}
	if writeStore.createCalls != 2 {
		t.Fatalf("expected the tool to call CreateTransaction both times (the store's own idempotency constraint is what dedupes), got %d", writeStore.createCalls)
	}
}

func TestCreateTransactionRejectsNonPositiveAmount(t *testing.T) {
	writeStore := sampleWriteStore()
	registry := mustMutationRegistry(t, writeStore, testConfirmer(t))
	tool, _ := registry.lookup("create_transaction")

	for _, amount := range []string{"0", "-500"} {
		args := json.RawMessage(`{"type":"expense","amountCents":` + amount + `,"accountId":"acc-banamex","categoryId":"cat-food","date":"2026-07-20","description":"Restaurante","merchant":null,"transferToAccountId":null}`)
		result, err := tool.Handler(context.Background(), args)
		if err != nil {
			t.Fatalf("handler: %v", err)
		}
		if result.Status != ToolStatusError {
			t.Fatalf("amount %s: status = %q, want error", amount, result.Status)
		}
	}
	if writeStore.createCalls != 0 {
		t.Fatalf("CreateTransaction called for an invalid amount")
	}
}

func TestCreateTransactionRejectsNonIntegerAmount(t *testing.T) {
	writeStore := sampleWriteStore()
	registry := mustMutationRegistry(t, writeStore, testConfirmer(t))
	tool, _ := registry.lookup("create_transaction")

	args := json.RawMessage(`{"type":"expense","amountCents":100.5,"accountId":"acc-banamex","categoryId":"cat-food","date":"2026-07-20","description":"Restaurante","merchant":null,"transferToAccountId":null}`)
	result, err := tool.Handler(context.Background(), args)
	if err != nil {
		t.Fatalf("handler: %v", err)
	}
	if result.Status != ToolStatusError {
		t.Fatalf("status = %q, want error for a fractional amount", result.Status)
	}
	if writeStore.createCalls != 0 {
		t.Fatal("CreateTransaction called for a fractional amount")
	}
}

func TestCreateTransactionRejectsUnknownAccount(t *testing.T) {
	writeStore := sampleWriteStore()
	registry := mustMutationRegistry(t, writeStore, testConfirmer(t))
	tool, _ := registry.lookup("create_transaction")

	args := json.RawMessage(`{"type":"expense","amountCents":10000,"accountId":"does-not-exist","categoryId":"cat-food","date":"2026-07-20","description":"Restaurante","merchant":null,"transferToAccountId":null}`)
	result, err := tool.Handler(context.Background(), args)
	if err != nil {
		t.Fatalf("handler: %v", err)
	}
	if result.Status != ToolStatusError {
		t.Fatalf("status = %q, want error for an unknown account", result.Status)
	}
	if writeStore.createCalls != 0 {
		t.Fatal("CreateTransaction called for an unknown account")
	}
}

func TestCreateTransactionChangedArgumentsInvalidatesOldToken(t *testing.T) {
	writeStore := sampleWriteStore()
	confirmer := testConfirmer(t)
	registry := mustMutationRegistry(t, writeStore, confirmer)
	tool, _ := registry.lookup("create_transaction")

	original := json.RawMessage(`{"type":"expense","amountCents":10000,"accountId":"acc-banamex","categoryId":"cat-food","date":"2026-07-20","description":"Restaurante","merchant":null,"transferToAccountId":null}`)
	proposeResult, err := tool.Handler(context.Background(), original)
	if err != nil {
		t.Fatalf("propose: %v", err)
	}
	proposal := decodeProposal(t, proposeResult)

	changed := json.RawMessage(`{"type":"expense","amountCents":99999,"accountId":"acc-banamex","categoryId":"cat-food","date":"2026-07-20","description":"Restaurante","merchant":null,"transferToAccountId":null}`)
	ctx := WithConfirmationToken(context.Background(), proposal.ConfirmationToken)
	result, err := tool.Handler(ctx, changed)
	if err != nil {
		t.Fatalf("confirm with changed args: %v", err)
	}
	if writeStore.createCalls != 0 {
		t.Fatal("CreateTransaction executed despite mismatched confirmation token")
	}
	// A changed request re-proposes instead of erroring or silently applying
	// the original amount.
	newProposal := decodeProposal(t, result)
	if newProposal.ConfirmationToken == proposal.ConfirmationToken {
		t.Fatal("re-proposal reused the same token as the invalidated one")
	}
}

// --- update_transaction ---

func TestUpdateTransactionProposesThenExecutesPartialPatch(t *testing.T) {
	writeStore := sampleWriteStore()
	confirmer := testConfirmer(t)
	registry := mustMutationRegistry(t, writeStore, confirmer)
	tool, ok := registry.lookup("update_transaction")
	if !ok {
		t.Fatal("update_transaction tool not registered")
	}

	args := json.RawMessage(`{"transactionId":"t2","amountCents":50000,"categoryId":null,"date":null,"description":null,"merchant":null}`)
	proposeResult, err := tool.Handler(context.Background(), args)
	if err != nil {
		t.Fatalf("propose: %v", err)
	}
	if writeStore.updateCalls != 0 {
		t.Fatal("UpdateTransaction called before confirmation")
	}
	proposal := decodeProposal(t, proposeResult)

	ctx := WithConfirmationToken(context.Background(), proposal.ConfirmationToken)
	if _, err := tool.Handler(ctx, args); err != nil {
		t.Fatalf("confirm: %v", err)
	}
	if writeStore.updateCalls != 1 || writeStore.updateID != "t2" {
		t.Fatalf("update calls=%d id=%q", writeStore.updateCalls, writeStore.updateID)
	}
	if writeStore.updatePatch.Amount == nil || *writeStore.updatePatch.Amount != 50000 {
		t.Fatalf("patch amount = %+v, want 50000", writeStore.updatePatch.Amount)
	}
	// Fields left null in the request must not be part of the patch at all.
	if writeStore.updatePatch.CategoryID.Set {
		t.Fatalf("categoryId should not be part of the patch when null: %+v", writeStore.updatePatch.CategoryID)
	}
	if writeStore.updatePatch.Description != nil {
		t.Fatalf("description should not be part of the patch when null: %+v", writeStore.updatePatch.Description)
	}
}

func TestUpdateTransactionRejectsWhenNoFieldsProvided(t *testing.T) {
	writeStore := sampleWriteStore()
	registry := mustMutationRegistry(t, writeStore, testConfirmer(t))
	tool, _ := registry.lookup("update_transaction")

	args := json.RawMessage(`{"transactionId":"t2","amountCents":null,"categoryId":null,"date":null,"description":null,"merchant":null}`)
	result, err := tool.Handler(context.Background(), args)
	if err != nil {
		t.Fatalf("handler: %v", err)
	}
	if result.Status != ToolStatusError {
		t.Fatalf("status = %q, want error when no fields are being changed", result.Status)
	}
}

func TestUpdateTransactionRejectsUnknownTransaction(t *testing.T) {
	writeStore := sampleWriteStore()
	registry := mustMutationRegistry(t, writeStore, testConfirmer(t))
	tool, _ := registry.lookup("update_transaction")

	args := json.RawMessage(`{"transactionId":"does-not-exist","amountCents":50000,"categoryId":null,"date":null,"description":null,"merchant":null}`)
	result, err := tool.Handler(context.Background(), args)
	if err != nil {
		t.Fatalf("handler: %v", err)
	}
	if result.Status != ToolStatusError {
		t.Fatalf("status = %q, want error for an unknown transaction", result.Status)
	}
}

func TestUpdateTransactionRequiresConfirmationBeforeExecuting(t *testing.T) {
	writeStore := sampleWriteStore()
	registry := mustMutationRegistry(t, writeStore, testConfirmer(t))
	tool, _ := registry.lookup("update_transaction")

	// No confirmation token attached to the context at all: must never write.
	args := json.RawMessage(`{"transactionId":"t2","amountCents":50000,"categoryId":null,"date":null,"description":null,"merchant":null}`)
	if _, err := tool.Handler(context.Background(), args); err != nil {
		t.Fatalf("handler: %v", err)
	}
	if writeStore.updateCalls != 0 {
		t.Fatal("UpdateTransaction executed without any confirmation token")
	}
}

// --- delete_transaction ---

func TestDeleteTransactionRequiresConfirmation(t *testing.T) {
	writeStore := sampleWriteStore()
	registry := mustMutationRegistry(t, writeStore, testConfirmer(t))
	tool, ok := registry.lookup("delete_transaction")
	if !ok {
		t.Fatal("delete_transaction tool not registered")
	}

	args := json.RawMessage(`{"transactionId":"t2"}`)
	result, err := tool.Handler(context.Background(), args)
	if err != nil {
		t.Fatalf("handler: %v", err)
	}
	decodeProposal(t, result)
	if writeStore.deleteCalls != 0 {
		t.Fatal("DeleteTransaction executed without confirmation")
	}
}

func TestDeleteTransactionExecutesWithValidConfirmation(t *testing.T) {
	writeStore := sampleWriteStore()
	confirmer := testConfirmer(t)
	registry := mustMutationRegistry(t, writeStore, confirmer)
	tool, _ := registry.lookup("delete_transaction")

	args := json.RawMessage(`{"transactionId":"t2"}`)
	proposeResult, err := tool.Handler(context.Background(), args)
	if err != nil {
		t.Fatalf("propose: %v", err)
	}
	proposal := decodeProposal(t, proposeResult)

	ctx := WithConfirmationToken(context.Background(), proposal.ConfirmationToken)
	result, err := tool.Handler(ctx, args)
	if err != nil {
		t.Fatalf("confirm: %v", err)
	}
	if result.Status != ToolStatusSuccess {
		t.Fatalf("status = %q, want success", result.Status)
	}
	if writeStore.deleteCalls != 1 || writeStore.deleteID != "t2" {
		t.Fatalf("delete calls=%d id=%q", writeStore.deleteCalls, writeStore.deleteID)
	}
}

func TestDeleteTransactionAlreadyGoneIsTreatedAsSuccess(t *testing.T) {
	writeStore := sampleWriteStore()
	writeStore.deleteErr = store.ErrNotFound
	confirmer := testConfirmer(t)
	registry := mustMutationRegistry(t, writeStore, confirmer)
	tool, _ := registry.lookup("delete_transaction")

	args := json.RawMessage(`{"transactionId":"t2"}`)
	proposeResult, err := tool.Handler(context.Background(), args)
	if err != nil {
		t.Fatalf("propose: %v", err)
	}
	proposal := decodeProposal(t, proposeResult)

	ctx := WithConfirmationToken(context.Background(), proposal.ConfirmationToken)
	result, err := tool.Handler(ctx, args)
	if err != nil {
		t.Fatalf("confirm: %v", err)
	}
	if result.Status != ToolStatusSuccess {
		t.Fatalf("status = %q, want success (idempotent delete of an already-gone resource)", result.Status)
	}
}

func TestDeleteTransactionRejectsUnknownTransaction(t *testing.T) {
	writeStore := sampleWriteStore()
	registry := mustMutationRegistry(t, writeStore, testConfirmer(t))
	tool, _ := registry.lookup("delete_transaction")

	args := json.RawMessage(`{"transactionId":"does-not-exist"}`)
	result, err := tool.Handler(context.Background(), args)
	if err != nil {
		t.Fatalf("handler: %v", err)
	}
	if result.Status != ToolStatusError {
		t.Fatalf("status = %q, want error for an unknown transaction", result.Status)
	}
}

// --- Runner-level: full propose -> confirm loop through Service, exercising
// the confirmation token end to end via context plumbing rather than calling
// tool.Handler directly. ---

func TestServiceChatThreadsConfirmationTokenToMutationTools(t *testing.T) {
	writeStore := sampleWriteStore()
	confirmer := testConfirmer(t)

	proposeArgs := `{"type":"expense","amountCents":10000,"accountId":"acc-banamex","categoryId":"cat-food","date":"2026-07-20","description":"Restaurante","merchant":null,"transferToAccountId":null}`
	provider := &scriptedProvider{responses: []ModelResponse{
		{FinishReason: FinishReasonToolCalls, ToolCalls: []ToolCall{toolCall("c1", "create_transaction", proposeArgs)}},
		{FinishReason: FinishReasonCompleted, Output: json.RawMessage(
			`{"status":"confirmation_required","message":"¿Confirmas el gasto?","summary":"Propuesta","artifacts":[]}`,
		)},
	}}
	service := mustMutationService(t, provider, writeStore, confirmer)

	result, err := service.Chat(context.Background(), testUser, userTurn("Registra un gasto de 100 en Banamex"), nil, "", nil)
	if err != nil {
		t.Fatalf("chat: %v", err)
	}
	if result.PendingConfirmation == nil {
		t.Fatal("expected a pending confirmation from the propose turn")
	}
	if writeStore.createCalls != 0 {
		t.Fatal("CreateTransaction executed on the propose turn")
	}

	token := result.PendingConfirmation.Token
	provider.responses = append(provider.responses, ModelResponse{
		FinishReason: FinishReasonToolCalls,
		ToolCalls:    []ToolCall{toolCall("c2", "create_transaction", proposeArgs)},
	}, ModelResponse{
		FinishReason: FinishReasonCompleted,
		Output:       json.RawMessage(`{"status":"completed","message":"Listo, registré el gasto.","summary":"Gasto registrado","artifacts":[]}`),
	})

	confirmResult, err := service.Chat(context.Background(), testUser, userTurn("Sí, confirmo"), nil, token, nil)
	if err != nil {
		t.Fatalf("confirm chat: %v", err)
	}
	if confirmResult.Outcome != OutcomeCompleted {
		t.Fatalf("confirm outcome = %q", confirmResult.Outcome)
	}
	if writeStore.createCalls != 1 {
		t.Fatalf("CreateTransaction called %d times after confirmation, want 1", writeStore.createCalls)
	}
}

func mustMutationService(t *testing.T, provider Provider, data Store, confirmer *Confirmer) *Service {
	t.Helper()
	service, err := NewService(provider, data, confirmer, testAgentConfig())
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	return service
}
