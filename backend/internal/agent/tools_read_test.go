package agent

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/aleonsa/budg/backend/internal/store"
)

// fakeReadStore satisfies the read-only data dependencies the tools need. It
// returns fixed synthetic data so tool behavior is deterministic.
type fakeReadStore struct {
	accounts     []store.Account
	categories   []store.Category
	transactions []store.Transaction
	err          error
}

func (f *fakeReadStore) ListAccounts(context.Context, string) ([]store.Account, error) {
	return f.accounts, f.err
}
func (f *fakeReadStore) ListCategories(context.Context, string) ([]store.Category, error) {
	return f.categories, f.err
}
func (f *fakeReadStore) ListTransactions(context.Context, string) ([]store.Transaction, error) {
	return f.transactions, f.err
}

// The three methods below let *fakeReadStore satisfy Store (ReadStore +
// WriteStore) so tests that only care about read behavior can still pass it
// to NewService without constructing a full fakeWriteStore. They fail loudly
// rather than silently succeeding: a scripted eval accidentally exercising a
// mutation path against a read-only fixture is a test bug worth surfacing,
// not masking. fakeWriteStore (tools_mutate_test.go) overrides all three with
// real, assertable behavior for tests that actually exercise mutations.
func (f *fakeReadStore) CreateTransaction(context.Context, string, store.TransactionInput) (store.Transaction, error) {
	return store.Transaction{}, errors.New("fakeReadStore does not support mutations; use fakeWriteStore")
}

func (f *fakeReadStore) UpdateTransaction(context.Context, string, string, store.TransactionPatch) (store.Transaction, error) {
	return store.Transaction{}, errors.New("fakeReadStore does not support mutations; use fakeWriteStore")
}

func (f *fakeReadStore) DeleteTransaction(context.Context, string, string) error {
	return errors.New("fakeReadStore does not support mutations; use fakeWriteStore")
}

func cents(v int64) *int64 { return &v }

func sampleStore() *fakeReadStore {
	return &fakeReadStore{
		accounts: []store.Account{
			{ID: "acc-bbva", Name: "Nómina BBVA", Type: "debit", Institution: "BBVA", Last4: "4321", Currency: "MXN", BalanceCents: cents(2540050), IsActive: true},
			{ID: "acc-banamex", Name: "Tarjeta Banamex", Type: "credit", Institution: "Banamex", Last4: "8890", Currency: "MXN", CreditLimitCents: cents(5000000), AvailableCreditCents: cents(3820000), IsActive: true},
			{ID: "acc-old", Name: "Cuenta Vieja", Type: "debit", Institution: "Otro", Last4: "0000", Currency: "MXN", BalanceCents: cents(0), IsActive: false},
		},
		categories: []store.Category{
			{ID: "cat-food", Name: "Alimentos y Bebidas", Kind: "expense", Color: "orange", Icon: "Utensils"},
			{ID: "cat-transport", Name: "Transporte", Kind: "expense", Color: "blue", Icon: "Car"},
			{ID: "cat-salary", Name: "Nómina", Kind: "income", Color: "green", Icon: "Briefcase"},
		},
		transactions: []store.Transaction{
			{ID: "t1", AccountID: "acc-bbva", Type: "income", Amount: 2400000, CategoryID: strptr("cat-salary"), Date: "2026-07-05", Description: "Quincena"},
			{ID: "t2", AccountID: "acc-banamex", Type: "expense", Amount: 45000, CategoryID: strptr("cat-food"), Date: "2026-07-10", Description: "Restaurante"},
			{ID: "t3", AccountID: "acc-bbva", Type: "expense", Amount: 25000, CategoryID: strptr("cat-transport"), Date: "2026-07-11", Description: "Uber"},
			{ID: "t4", AccountID: "acc-banamex", Type: "expense", Amount: 18000, CategoryID: strptr("cat-food"), Date: "2026-06-30", Description: "Café"},
		},
	}
}

func strptr(s string) *string { return &s }

const testUser = "1b65ab86-586b-427f-b126-ee7f7ad35753"

func mustRegistry(t *testing.T, store ReadStore) *ToolRegistry {
	t.Helper()
	registry, err := NewReadOnlyToolRegistry(store, testUser)
	if err != nil {
		t.Fatalf("build read-only registry: %v", err)
	}
	return registry
}

func callTool(t *testing.T, registry *ToolRegistry, name, arguments string) ToolResult {
	t.Helper()
	tool, ok := registry.lookup(name)
	if !ok {
		t.Fatalf("tool %q not registered", name)
	}
	result, err := tool.Handler(context.Background(), json.RawMessage(arguments))
	if err != nil {
		t.Fatalf("tool %q handler: %v", name, err)
	}
	if err := result.Validate(); err != nil {
		t.Fatalf("tool %q result invalid: %v", name, err)
	}
	return result
}

func TestReadOnlyRegistryExposesExpectedTools(t *testing.T) {
	registry := mustRegistry(t, sampleStore())
	names := map[string]bool{}
	for _, def := range registry.Definitions() {
		names[def.Name] = true
	}
	for _, want := range []string{"list_accounts", "list_categories", "search_transactions", "get_financial_summary"} {
		if !names[want] {
			t.Fatalf("missing tool %q", want)
		}
	}
}

func TestListAccountsToolReturnsActiveByDefault(t *testing.T) {
	registry := mustRegistry(t, sampleStore())
	result := callTool(t, registry, "list_accounts", `{}`)

	var payload struct {
		Accounts []struct {
			ID       string `json:"id"`
			Name     string `json:"name"`
			IsActive bool   `json:"isActive"`
		} `json:"accounts"`
	}
	if err := json.Unmarshal(result.Data, &payload); err != nil {
		t.Fatalf("decode data: %v", err)
	}
	if len(payload.Accounts) != 2 {
		t.Fatalf("expected 2 active accounts, got %d", len(payload.Accounts))
	}
}

func TestListAccountsToolCanIncludeInactive(t *testing.T) {
	registry := mustRegistry(t, sampleStore())
	result := callTool(t, registry, "list_accounts", `{"includeInactive":true}`)
	var payload struct {
		Accounts []json.RawMessage `json:"accounts"`
	}
	if err := json.Unmarshal(result.Data, &payload); err != nil {
		t.Fatalf("decode data: %v", err)
	}
	if len(payload.Accounts) != 3 {
		t.Fatalf("expected 3 accounts including inactive, got %d", len(payload.Accounts))
	}
}

func TestListAccountsToolRejectsUnknownArgument(t *testing.T) {
	registry := mustRegistry(t, sampleStore())
	tool, _ := registry.lookup("list_accounts")
	result, err := tool.Handler(context.Background(), json.RawMessage(`{"bogus":true}`))
	if err != nil {
		t.Fatalf("handler returned error instead of tool result: %v", err)
	}
	if result.Status != ToolStatusError {
		t.Fatalf("status = %q, want error for unknown argument", result.Status)
	}
}

func TestListCategoriesToolFiltersByKind(t *testing.T) {
	registry := mustRegistry(t, sampleStore())
	result := callTool(t, registry, "list_categories", `{"kind":"income"}`)
	var payload struct {
		Categories []struct {
			Name string `json:"name"`
			Kind string `json:"kind"`
		} `json:"categories"`
	}
	if err := json.Unmarshal(result.Data, &payload); err != nil {
		t.Fatalf("decode data: %v", err)
	}
	if len(payload.Categories) != 1 || payload.Categories[0].Kind != "income" {
		t.Fatalf("expected only income categories, got %+v", payload.Categories)
	}
}

func TestSearchTransactionsToolFiltersByPeriodAndType(t *testing.T) {
	registry := mustRegistry(t, sampleStore())
	result := callTool(t, registry, "search_transactions", `{"startDate":"2026-07-01","endDate":"2026-07-31","type":"expense"}`)
	var payload struct {
		TotalCents   int64 `json:"totalCents"`
		Count        int   `json:"count"`
		Transactions []struct {
			ID string `json:"id"`
		} `json:"transactions"`
	}
	if err := json.Unmarshal(result.Data, &payload); err != nil {
		t.Fatalf("decode data: %v", err)
	}
	// July expenses: t2 (45000) + t3 (25000) = 70000, excludes June t4 and income t1.
	if payload.Count != 2 || payload.TotalCents != 70000 {
		t.Fatalf("count/total = %d/%d, want 2/70000", payload.Count, payload.TotalCents)
	}
}

func TestSearchTransactionsToolValidatesDate(t *testing.T) {
	registry := mustRegistry(t, sampleStore())
	tool, _ := registry.lookup("search_transactions")
	result, err := tool.Handler(context.Background(), json.RawMessage(`{"startDate":"07-2026"}`))
	if err != nil {
		t.Fatalf("handler returned error instead of tool result: %v", err)
	}
	if result.Status != ToolStatusError {
		t.Fatalf("status = %q, want error for invalid date", result.Status)
	}
}

func TestFinancialSummaryToolAggregatesPeriod(t *testing.T) {
	registry := mustRegistry(t, sampleStore())
	result := callTool(t, registry, "get_financial_summary", `{"startDate":"2026-07-01","endDate":"2026-07-31"}`)
	var payload struct {
		IncomeCents   int64 `json:"incomeCents"`
		ExpensesCents int64 `json:"expensesCents"`
		NetCents      int64 `json:"netCents"`
	}
	if err := json.Unmarshal(result.Data, &payload); err != nil {
		t.Fatalf("decode data: %v", err)
	}
	if payload.IncomeCents != 2400000 || payload.ExpensesCents != 70000 {
		t.Fatalf("income/expenses = %d/%d", payload.IncomeCents, payload.ExpensesCents)
	}
	if payload.NetCents != 2330000 {
		t.Fatalf("net = %d, want 2330000", payload.NetCents)
	}
}

func TestReadToolSurfacesStoreErrorSafely(t *testing.T) {
	failing := sampleStore()
	failing.err = context.DeadlineExceeded
	registry := mustRegistry(t, failing)
	tool, _ := registry.lookup("list_accounts")
	result, err := tool.Handler(context.Background(), json.RawMessage(`{}`))
	if err != nil {
		t.Fatalf("handler returned raw error: %v", err)
	}
	if result.Status != ToolStatusError || result.Retryable != true {
		t.Fatalf("store error not surfaced as retryable tool error: %+v", result)
	}
	if result.Data != nil {
		t.Fatalf("error result should not include data")
	}
}
