package agent

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/aleonsa/budg/backend/internal/store"
)

func TestPlanningMutationToolsProposeThenExecute(t *testing.T) {
	tests := []struct {
		name      string
		toolName  string
		arguments string
		calls     func(*fakeWriteStore) int
		setup     func(*fakeWriteStore)
	}{
		{name: "create budget", toolName: "create_budget", arguments: `{"categoryId":"cat-food","amountCents":500000,"period":"monthly","startDate":"2026-09-01"}`, calls: func(s *fakeWriteStore) int { return s.budgetCreateCalls }},
		{name: "update budget", toolName: "update_budget", arguments: `{"budgetId":"bud-food","categoryId":null,"amountCents":600000,"period":"monthly","startDate":"2026-09-01"}`, calls: func(s *fakeWriteStore) int { return s.budgetUpdateCalls }},
		{name: "delete budget", toolName: "delete_budget", arguments: `{"budgetId":"bud-food"}`, calls: func(s *fakeWriteStore) int { return s.budgetDeleteCalls }},
		{name: "create savings goal", toolName: "create_savings_goal", arguments: `{"name":"Vacaciones","targetAmountCents":3000000,"targetDate":"2027-01-15","accountId":"acc-bbva","order":2}`, calls: func(s *fakeWriteStore) int { return s.goalCreateCalls }},
		{name: "update savings goal", toolName: "update_savings_goal", arguments: `{"goalId":"goal-emergency","name":"Fondo amplio","targetAmountCents":150000000,"targetDate":null,"accountId":"acc-bbva","order":0}`, calls: func(s *fakeWriteStore) int { return s.goalUpdateCalls }},
		{name: "delete savings goal", toolName: "delete_savings_goal", arguments: `{"goalId":"goal-emergency"}`, calls: func(s *fakeWriteStore) int { return s.goalDeleteCalls }},
		{name: "create recurring", toolName: "create_recurring_transaction", arguments: `{"accountId":"acc-bbva","categoryId":"cat-food","description":"Internet","merchant":"ISP","amountCents":89900,"frequency":"monthly","startDate":"2026-09-05"}`, calls: func(s *fakeWriteStore) int { return s.recurringCreateCalls }},
		{name: "update recurring", toolName: "update_recurring_transaction", arguments: `{"recurringId":"rec-netflix","accountId":"acc-banamex","categoryId":"cat-food","description":"Streaming","merchant":"Netflix","amountCents":24900,"frequency":"monthly","startDate":"2026-01-05","isActive":false}`, calls: func(s *fakeWriteStore) int { return s.recurringUpdateCalls }},
		{name: "delete recurring", toolName: "delete_recurring_transaction", arguments: `{"recurringId":"rec-netflix"}`, calls: func(s *fakeWriteStore) int { return s.recurringDeleteCalls }},
		{name: "create msi", toolName: "create_msi_purchase", arguments: `{"accountId":"acc-banamex","categoryId":"cat-food","description":"Monitor","merchant":"Tienda","totalAmountCents":1200000,"installmentCount":12,"startDate":"2026-09-01"}`, calls: func(s *fakeWriteStore) int { return s.msiCreateCalls }},
		{name: "update msi", toolName: "update_msi_purchase", arguments: `{"msiPurchaseId":"msi-phone","accountId":"acc-banamex","categoryId":"cat-food","description":"Laptop Pro","merchant":"Tienda","totalAmountCents":3000000,"installmentCount":12,"startDate":"2026-08-01"}`, calls: func(s *fakeWriteStore) int { return s.msiUpdateCalls }, setup: func(s *fakeWriteStore) { s.msiPurchases[0].InstallmentsPaid = 0 }},
		{name: "delete msi", toolName: "delete_msi_purchase", arguments: `{"msiPurchaseId":"msi-phone"}`, calls: func(s *fakeWriteStore) int { return s.msiDeleteCalls }},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data := sampleWriteStore()
			if tt.setup != nil {
				tt.setup(data)
			}
			registry := mustMutationRegistry(t, data, testConfirmer(t))
			tool, ok := registry.lookup(tt.toolName)
			if !ok {
				t.Fatalf("tool %q not registered", tt.toolName)
			}
			arguments := json.RawMessage(tt.arguments)

			proposalResult, err := tool.Handler(context.Background(), arguments)
			if err != nil {
				t.Fatalf("propose: %v", err)
			}
			proposal := decodeProposal(t, proposalResult)
			if !proposal.RequiresConfirmation {
				t.Fatal("proposal does not require confirmation")
			}
			if got := tt.calls(data); got != 0 {
				t.Fatalf("write calls before confirmation = %d, want 0", got)
			}

			ctx := WithConfirmationToken(context.Background(), proposal.ConfirmationToken)
			result, err := tool.Handler(ctx, arguments)
			if err != nil {
				t.Fatalf("confirm: %v", err)
			}
			if result.Status != ToolStatusSuccess {
				t.Fatalf("confirm status = %q, summary = %q", result.Status, result.Summary)
			}
			if got := tt.calls(data); got != 1 {
				t.Fatalf("write calls after confirmation = %d, want 1", got)
			}
		})
	}
}

func TestPlanningCreateToolsUseStableIdempotencyKeys(t *testing.T) {
	tests := []struct {
		name      string
		toolName  string
		arguments string
		key       func(*fakeWriteStore) *string
		calls     func(*fakeWriteStore) int
	}{
		{name: "budget", toolName: "create_budget", arguments: `{"categoryId":null,"amountCents":500000,"period":"monthly","startDate":"2026-09-01"}`, key: func(s *fakeWriteStore) *string { return s.budgetCreateInput.IdempotencyKey }, calls: func(s *fakeWriteStore) int { return s.budgetCreateCalls }},
		{name: "savings goal", toolName: "create_savings_goal", arguments: `{"name":"Viaje","targetAmountCents":3000000,"targetDate":null,"accountId":null,"order":0}`, key: func(s *fakeWriteStore) *string { return s.goalCreateInput.IdempotencyKey }, calls: func(s *fakeWriteStore) int { return s.goalCreateCalls }},
		{name: "recurring", toolName: "create_recurring_transaction", arguments: `{"accountId":"acc-bbva","categoryId":null,"description":"Renta","merchant":null,"amountCents":1000000,"frequency":"monthly","startDate":"2026-09-01"}`, key: func(s *fakeWriteStore) *string { return s.recurringCreateInput.IdempotencyKey }, calls: func(s *fakeWriteStore) int { return s.recurringCreateCalls }},
		{name: "msi", toolName: "create_msi_purchase", arguments: `{"accountId":"acc-banamex","categoryId":null,"description":"Monitor","merchant":null,"totalAmountCents":1200000,"installmentCount":12,"startDate":"2026-09-01"}`, key: func(s *fakeWriteStore) *string { return s.msiCreateInput.IdempotencyKey }, calls: func(s *fakeWriteStore) int { return s.msiCreateCalls }},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data := sampleWriteStore()
			registry := mustMutationRegistry(t, data, testConfirmer(t))
			tool, _ := registry.lookup(tt.toolName)
			arguments := json.RawMessage(tt.arguments)
			proposed, err := tool.Handler(context.Background(), arguments)
			if err != nil {
				t.Fatalf("propose: %v", err)
			}
			token := decodeProposal(t, proposed).ConfirmationToken
			ctx := WithConfirmationToken(context.Background(), token)

			if _, err := tool.Handler(ctx, arguments); err != nil {
				t.Fatalf("first confirmation: %v", err)
			}
			first := tt.key(data)
			if first == nil || *first == "" {
				t.Fatal("first confirmation did not set an idempotency key")
			}
			firstValue := *first
			if _, err := tool.Handler(ctx, arguments); err != nil {
				t.Fatalf("second confirmation: %v", err)
			}
			second := tt.key(data)
			if second == nil || *second != firstValue {
				t.Fatalf("idempotency key changed: first=%q second=%v", firstValue, second)
			}
			if got := tt.calls(data); got != 2 {
				t.Fatalf("store calls = %d, want 2; repository performs durable deduplication", got)
			}
		})
	}
}

func TestPlanningCreateToolsRejectInvalidReferences(t *testing.T) {
	tests := []struct {
		name      string
		toolName  string
		arguments string
		calls     func(*fakeWriteStore) int
	}{
		{name: "budget income category", toolName: "create_budget", arguments: `{"categoryId":"cat-salary","amountCents":500000,"period":"monthly","startDate":"2026-09-01"}`, calls: func(s *fakeWriteStore) int { return s.budgetCreateCalls }},
		{name: "goal credit account", toolName: "create_savings_goal", arguments: `{"name":"Viaje","targetAmountCents":3000000,"targetDate":null,"accountId":"acc-banamex","order":0}`, calls: func(s *fakeWriteStore) int { return s.goalCreateCalls }},
		{name: "recurring inactive account", toolName: "create_recurring_transaction", arguments: `{"accountId":"acc-old","categoryId":null,"description":"Renta","merchant":null,"amountCents":1000000,"frequency":"monthly","startDate":"2026-09-01"}`, calls: func(s *fakeWriteStore) int { return s.recurringCreateCalls }},
		{name: "msi debit account", toolName: "create_msi_purchase", arguments: `{"accountId":"acc-bbva","categoryId":null,"description":"Monitor","merchant":null,"totalAmountCents":1200000,"installmentCount":12,"startDate":"2026-09-01"}`, calls: func(s *fakeWriteStore) int { return s.msiCreateCalls }},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data := sampleWriteStore()
			registry := mustMutationRegistry(t, data, testConfirmer(t))
			tool, _ := registry.lookup(tt.toolName)
			result, err := tool.Handler(context.Background(), json.RawMessage(tt.arguments))
			if err != nil {
				t.Fatalf("handler: %v", err)
			}
			if result.Status != ToolStatusError {
				t.Fatalf("status = %q, want error", result.Status)
			}
			if got := tt.calls(data); got != 0 {
				t.Fatalf("write calls = %d, want 0", got)
			}
		})
	}
}

func TestPlanningUpdateAndDeleteRejectUnownedResources(t *testing.T) {
	tests := []struct {
		toolName  string
		arguments string
	}{
		{toolName: "update_budget", arguments: `{"budgetId":"other-user","categoryId":null,"amountCents":1,"period":"monthly","startDate":"2026-09-01"}`},
		{toolName: "delete_budget", arguments: `{"budgetId":"other-user"}`},
		{toolName: "update_savings_goal", arguments: `{"goalId":"other-user","name":"Meta","targetAmountCents":1,"targetDate":null,"accountId":null,"order":0}`},
		{toolName: "delete_savings_goal", arguments: `{"goalId":"other-user"}`},
		{toolName: "update_recurring_transaction", arguments: `{"recurringId":"other-user","accountId":"acc-bbva","categoryId":null,"description":"Renta","merchant":null,"amountCents":1,"frequency":"monthly","startDate":"2026-09-01","isActive":true}`},
		{toolName: "delete_recurring_transaction", arguments: `{"recurringId":"other-user"}`},
		{toolName: "update_msi_purchase", arguments: `{"msiPurchaseId":"other-user","accountId":"acc-banamex","categoryId":null,"description":"Monitor","merchant":null,"totalAmountCents":12,"installmentCount":12,"startDate":"2026-09-01"}`},
		{toolName: "delete_msi_purchase", arguments: `{"msiPurchaseId":"other-user"}`},
	}

	for _, tt := range tests {
		t.Run(tt.toolName, func(t *testing.T) {
			data := sampleWriteStore()
			registry := mustMutationRegistry(t, data, testConfirmer(t))
			tool, _ := registry.lookup(tt.toolName)
			result, err := tool.Handler(context.Background(), json.RawMessage(tt.arguments))
			if err != nil {
				t.Fatalf("handler: %v", err)
			}
			if result.Status != ToolStatusError {
				t.Fatalf("status = %q, want error", result.Status)
			}
		})
	}
}

func TestUpdateMSIPurchaseRejectsPaidScheduleBeforeProposal(t *testing.T) {
	data := sampleWriteStore()
	registry := mustMutationRegistry(t, data, testConfirmer(t))
	tool, _ := registry.lookup("update_msi_purchase")
	arguments := json.RawMessage(`{"msiPurchaseId":"msi-phone","accountId":"acc-banamex","categoryId":"cat-food","description":"Celular nuevo","merchant":null,"totalAmountCents":18000000,"installmentCount":12,"startDate":"2026-02-01"}`)

	result, err := tool.Handler(context.Background(), arguments)
	if err != nil {
		t.Fatalf("handler: %v", err)
	}
	if result.Status != ToolStatusError {
		t.Fatalf("status = %q, want error", result.Status)
	}
	if data.msiUpdateCalls != 0 {
		t.Fatal("UpdateMSIPurchase called for a schedule with paid installments")
	}
}

func TestPlanningMutationChangedArgumentsInvalidatesConfirmation(t *testing.T) {
	data := sampleWriteStore()
	registry := mustMutationRegistry(t, data, testConfirmer(t))
	tool, _ := registry.lookup("create_budget")
	original := json.RawMessage(`{"categoryId":null,"amountCents":500000,"period":"monthly","startDate":"2026-09-01"}`)
	changed := json.RawMessage(`{"categoryId":null,"amountCents":900000,"period":"monthly","startDate":"2026-09-01"}`)

	proposed, err := tool.Handler(context.Background(), original)
	if err != nil {
		t.Fatalf("propose: %v", err)
	}
	oldToken := decodeProposal(t, proposed).ConfirmationToken
	result, err := tool.Handler(WithConfirmationToken(context.Background(), oldToken), changed)
	if err != nil {
		t.Fatalf("changed confirmation: %v", err)
	}
	if data.budgetCreateCalls != 0 {
		t.Fatal("CreateBudget executed with a token bound to different arguments")
	}
	newToken := decodeProposal(t, result).ConfirmationToken
	if newToken == oldToken {
		t.Fatal("changed arguments reused the invalid confirmation token")
	}
}

func TestPlanningMutationInputsPreserveExplicitValues(t *testing.T) {
	t.Run("budget category clear", func(t *testing.T) {
		data := sampleWriteStore()
		registry := mustMutationRegistry(t, data, testConfirmer(t))
		tool, _ := registry.lookup("update_budget")
		arguments := json.RawMessage(`{"budgetId":"bud-food","categoryId":null,"amountCents":600000,"period":"yearly","startDate":"2026-09-01"}`)
		proposed, _ := tool.Handler(context.Background(), arguments)
		token := decodeProposal(t, proposed).ConfirmationToken
		if _, err := tool.Handler(WithConfirmationToken(context.Background(), token), arguments); err != nil {
			t.Fatalf("confirm: %v", err)
		}
		if !data.budgetUpdatePatch.CategoryID.Set || data.budgetUpdatePatch.CategoryID.Value != nil {
			t.Fatalf("category patch = %+v, want explicit null", data.budgetUpdatePatch.CategoryID)
		}
	})

	t.Run("new goal starts at zero", func(t *testing.T) {
		data := sampleWriteStore()
		registry := mustMutationRegistry(t, data, testConfirmer(t))
		tool, _ := registry.lookup("create_savings_goal")
		arguments := json.RawMessage(`{"name":"Viaje","targetAmountCents":3000000,"targetDate":null,"accountId":null,"order":0}`)
		proposed, _ := tool.Handler(context.Background(), arguments)
		token := decodeProposal(t, proposed).ConfirmationToken
		if _, err := tool.Handler(WithConfirmationToken(context.Background(), token), arguments); err != nil {
			t.Fatalf("confirm: %v", err)
		}
		if data.goalCreateInput.CurrentAmount != 0 {
			t.Fatalf("current amount = %d, want 0", data.goalCreateInput.CurrentAmount)
		}
	})

	t.Run("recurring can be paused", func(t *testing.T) {
		data := sampleWriteStore()
		registry := mustMutationRegistry(t, data, testConfirmer(t))
		tool, _ := registry.lookup("update_recurring_transaction")
		arguments := json.RawMessage(`{"recurringId":"rec-netflix","accountId":"acc-banamex","categoryId":null,"description":"Netflix","merchant":null,"amountCents":24900,"frequency":"monthly","startDate":"2026-01-05","isActive":false}`)
		proposed, _ := tool.Handler(context.Background(), arguments)
		token := decodeProposal(t, proposed).ConfirmationToken
		if _, err := tool.Handler(WithConfirmationToken(context.Background(), token), arguments); err != nil {
			t.Fatalf("confirm: %v", err)
		}
		if data.recurringUpdateInput.IsActive == nil || *data.recurringUpdateInput.IsActive {
			t.Fatalf("isActive = %v, want false", data.recurringUpdateInput.IsActive)
		}
		if data.recurringUpdateInput.MaterializeOccurrences == nil || *data.recurringUpdateInput.MaterializeOccurrences {
			t.Fatalf("materialize occurrences = %v, want false", data.recurringUpdateInput.MaterializeOccurrences)
		}
	})
}

func TestUpdateRecurringCanPauseInactiveAccount(t *testing.T) {
	data := sampleWriteStore()
	data.recurring = append(data.recurring, store.RecurringTransaction{
		ID: "rec-inactive-account", AccountID: "acc-old", Description: "Legacy",
		Amount: 1000, Frequency: "monthly", StartDate: "2026-01-01", NextDate: "2026-09-01", IsActive: true,
	})
	registry := mustMutationRegistry(t, data, testConfirmer(t))
	tool, _ := registry.lookup("update_recurring_transaction")
	arguments := json.RawMessage(`{"recurringId":"rec-inactive-account","accountId":"acc-old","categoryId":null,"description":"Legacy","merchant":null,"amountCents":1000,"frequency":"monthly","startDate":"2026-01-01","isActive":false}`)

	proposed, err := tool.Handler(context.Background(), arguments)
	if err != nil {
		t.Fatalf("propose: %v", err)
	}
	token := decodeProposal(t, proposed).ConfirmationToken
	if _, err := tool.Handler(WithConfirmationToken(context.Background(), token), arguments); err != nil {
		t.Fatalf("confirm: %v", err)
	}
	if data.recurringUpdateCalls != 1 {
		t.Fatalf("update calls = %d, want 1", data.recurringUpdateCalls)
	}
}

func TestUpdateMSIPurchaseAllowsLegacyUntrackedMetadataProposal(t *testing.T) {
	data := sampleWriteStore()
	data.accounts = append(data.accounts, store.Account{
		ID: "acc-legacy-credit", Name: "Legacy Card", Type: "credit", Currency: "MXN", IsActive: false,
	})
	data.msiPurchases = append(data.msiPurchases, store.MSIPurchase{
		ID: "msi-legacy", AccountID: "acc-legacy-credit", Description: "Legacy purchase",
		TotalAmount: 120000, InstallmentCount: 12, InstallmentsPaid: 0, StartDate: "2025-01-01", Status: "active",
	})
	registry := mustMutationRegistry(t, data, testConfirmer(t))
	tool, _ := registry.lookup("update_msi_purchase")
	arguments := json.RawMessage(`{"msiPurchaseId":"msi-legacy","accountId":"acc-legacy-credit","categoryId":null,"description":"Legacy purchase renamed","merchant":null,"totalAmountCents":120000,"installmentCount":12,"startDate":"2025-01-01"}`)

	result, err := tool.Handler(context.Background(), arguments)
	if err != nil {
		t.Fatalf("propose: %v", err)
	}
	if result.Status != ToolStatusSuccess {
		t.Fatalf("status = %q, want confirmation proposal", result.Status)
	}
	decodeProposal(t, result)
	if data.msiUpdateCalls != 0 {
		t.Fatal("UpdateMSIPurchase executed before confirmation")
	}
}

func TestPlanningDeletesTreatAlreadyGoneAsSuccess(t *testing.T) {
	tests := []struct {
		name      string
		toolName  string
		arguments string
		setError  func(*fakeWriteStore)
	}{
		{name: "budget", toolName: "delete_budget", arguments: `{"budgetId":"bud-food"}`, setError: func(s *fakeWriteStore) { s.budgetDeleteErr = store.ErrNotFound }},
		{name: "goal", toolName: "delete_savings_goal", arguments: `{"goalId":"goal-emergency"}`, setError: func(s *fakeWriteStore) { s.goalDeleteErr = store.ErrNotFound }},
		{name: "recurring", toolName: "delete_recurring_transaction", arguments: `{"recurringId":"rec-netflix"}`, setError: func(s *fakeWriteStore) { s.recurringDeleteErr = store.ErrNotFound }},
		{name: "msi", toolName: "delete_msi_purchase", arguments: `{"msiPurchaseId":"msi-phone"}`, setError: func(s *fakeWriteStore) { s.msiDeleteErr = store.ErrNotFound }},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data := sampleWriteStore()
			tt.setError(data)
			registry := mustMutationRegistry(t, data, testConfirmer(t))
			tool, _ := registry.lookup(tt.toolName)
			arguments := json.RawMessage(tt.arguments)
			proposed, err := tool.Handler(context.Background(), arguments)
			if err != nil {
				t.Fatalf("propose: %v", err)
			}
			token := decodeProposal(t, proposed).ConfirmationToken
			result, err := tool.Handler(WithConfirmationToken(context.Background(), token), arguments)
			if err != nil {
				t.Fatalf("confirm: %v", err)
			}
			if result.Status != ToolStatusSuccess {
				t.Fatalf("status = %q, want success", result.Status)
			}
		})
	}
}

func TestCreateToolsTreatDeletedIdempotentReplayAsCompleted(t *testing.T) {
	tests := []struct {
		name      string
		toolName  string
		arguments string
		setError  func(*fakeWriteStore, error)
	}{
		{name: "transaction", toolName: "create_transaction", arguments: `{"type":"expense","amountCents":10000,"accountId":"acc-banamex","categoryId":"cat-food","date":"2026-07-20","description":"Restaurante","merchant":null,"transferToAccountId":null}`, setError: func(s *fakeWriteStore, err error) { s.createErr = err }},
		{name: "budget", toolName: "create_budget", arguments: `{"categoryId":null,"amountCents":500000,"period":"monthly","startDate":"2026-09-01"}`, setError: func(s *fakeWriteStore, err error) { s.budgetCreateErr = err }},
		{name: "goal", toolName: "create_savings_goal", arguments: `{"name":"Viaje","targetAmountCents":3000000,"targetDate":null,"accountId":null,"order":0}`, setError: func(s *fakeWriteStore, err error) { s.goalCreateErr = err }},
		{name: "recurring", toolName: "create_recurring_transaction", arguments: `{"accountId":"acc-bbva","categoryId":null,"description":"Renta","merchant":null,"amountCents":1000000,"frequency":"monthly","startDate":"2026-09-01"}`, setError: func(s *fakeWriteStore, err error) { s.recurringCreateErr = err }},
		{name: "msi", toolName: "create_msi_purchase", arguments: `{"accountId":"acc-banamex","categoryId":null,"description":"Monitor","merchant":null,"totalAmountCents":1200000,"installmentCount":12,"startDate":"2026-09-01"}`, setError: func(s *fakeWriteStore, err error) { s.msiCreateErr = err }},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data := sampleWriteStore()
			replayErr := &store.IdempotencyReplayDeletedError{ResourceID: "deleted-resource-id"}
			tt.setError(data, replayErr)
			registry := mustMutationRegistry(t, data, testConfirmer(t))
			tool, _ := registry.lookup(tt.toolName)
			arguments := json.RawMessage(tt.arguments)
			proposed, err := tool.Handler(context.Background(), arguments)
			if err != nil {
				t.Fatalf("propose: %v", err)
			}
			token := decodeProposal(t, proposed).ConfirmationToken
			result, err := tool.Handler(WithConfirmationToken(context.Background(), token), arguments)
			if err != nil {
				t.Fatalf("confirm replay: %v", err)
			}
			if result.Status != ToolStatusSuccess {
				t.Fatalf("status = %q, want success", result.Status)
			}
			var payload struct {
				AlreadyExecuted bool `json:"alreadyExecuted"`
				ResourceDeleted bool `json:"resourceDeleted"`
			}
			if err := json.Unmarshal(result.Data, &payload); err != nil {
				t.Fatalf("decode result: %v", err)
			}
			if !payload.AlreadyExecuted || !payload.ResourceDeleted {
				t.Fatalf("payload = %+v, want deleted replay", payload)
			}
		})
	}
}
