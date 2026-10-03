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
	budgets      []store.Budget
	savingsGoals []store.SavingsGoal
	recurring    []store.RecurringTransaction
	msiPurchases []store.MSIPurchase
	yields       []store.YieldReconciliation
	err          error
}

func (f *fakeReadStore) ListYieldReconciliations(context.Context, string) ([]store.YieldReconciliation, error) {
	return f.yields, f.err
}

func (f *fakeReadStore) ReconcileYield(context.Context, string, string, store.YieldReconciliationInput) (store.YieldReconciliationResult, error) {
	return unsupportedMutation[store.YieldReconciliationResult]()
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
func (f *fakeReadStore) ListBudgets(context.Context, string) ([]store.Budget, error) {
	return f.budgets, f.err
}
func (f *fakeReadStore) ListSavingsGoals(context.Context, string) ([]store.SavingsGoal, error) {
	return f.savingsGoals, f.err
}
func (f *fakeReadStore) ListRecurringTransactions(context.Context, string) ([]store.RecurringTransaction, error) {
	return f.recurring, f.err
}
func (f *fakeReadStore) ListMSIPurchases(context.Context, string) ([]store.MSIPurchase, error) {
	return f.msiPurchases, f.err
}

// The methods below let *fakeReadStore satisfy Store (ReadStore +
// WriteStore) so tests that only care about read behavior can still pass it
// to NewService without constructing a full fakeWriteStore. They fail loudly
// rather than silently succeeding: a scripted eval accidentally exercising a
// mutation path against a read-only fixture is a test bug worth surfacing,
// not masking. fakeWriteStore (tools_mutate_test.go) overrides them with
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

func unsupportedMutation[T any]() (T, error) {
	var zero T
	return zero, errors.New("fakeReadStore does not support mutations; use fakeWriteStore")
}

func (f *fakeReadStore) CreateBudget(context.Context, string, store.BudgetInput) (store.Budget, error) {
	return unsupportedMutation[store.Budget]()
}
func (f *fakeReadStore) UpdateBudget(context.Context, string, string, store.BudgetPatch) (store.Budget, error) {
	return unsupportedMutation[store.Budget]()
}
func (f *fakeReadStore) DeleteBudget(context.Context, string, string) error {
	return errors.New("fakeReadStore does not support mutations; use fakeWriteStore")
}
func (f *fakeReadStore) CreateSavingsGoal(context.Context, string, store.SavingsGoalInput) (store.SavingsGoal, error) {
	return unsupportedMutation[store.SavingsGoal]()
}
func (f *fakeReadStore) UpdateSavingsGoal(context.Context, string, string, store.SavingsGoalPatch) (store.SavingsGoal, error) {
	return unsupportedMutation[store.SavingsGoal]()
}
func (f *fakeReadStore) DeleteSavingsGoal(context.Context, string, string) error {
	return errors.New("fakeReadStore does not support mutations; use fakeWriteStore")
}
func (f *fakeReadStore) CreateRecurringTransaction(context.Context, string, store.RecurringTransactionInput) (store.RecurringTransaction, error) {
	return unsupportedMutation[store.RecurringTransaction]()
}
func (f *fakeReadStore) UpdateRecurringTransaction(context.Context, string, string, store.RecurringTransactionUpdateInput) (store.RecurringTransaction, error) {
	return unsupportedMutation[store.RecurringTransaction]()
}
func (f *fakeReadStore) DeleteRecurringTransaction(context.Context, string, string) error {
	return errors.New("fakeReadStore does not support mutations; use fakeWriteStore")
}
func (f *fakeReadStore) CreateMSIPurchase(context.Context, string, store.MSIPurchaseInput) (store.MSIPurchase, error) {
	return unsupportedMutation[store.MSIPurchase]()
}
func (f *fakeReadStore) UpdateMSIPurchase(context.Context, string, string, store.MSIPurchaseInput) (store.MSIPurchase, error) {
	return unsupportedMutation[store.MSIPurchase]()
}
func (f *fakeReadStore) DeleteMSIPurchase(context.Context, string, string) error {
	return errors.New("fakeReadStore does not support mutations; use fakeWriteStore")
}

func cents(v int64) *int64 { return &v }

func sampleStore() *fakeReadStore {
	return &fakeReadStore{
		accounts: []store.Account{
			{ID: "acc-bbva", Name: "Nómina BBVA", Type: "debit", Institution: "BBVA", Last4: "4321", Currency: "MXN", BalanceCents: cents(2540050), IsActive: true},
			{ID: "acc-banamex", Name: "Tarjeta Banamex", Type: "credit", Institution: "Banamex", Last4: "8890", Currency: "MXN", CreditLimitCents: cents(5000000), AvailableCreditCents: cents(3820000), BalanceTrackingEnabled: true, IsActive: true},
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
			{ID: "t5", AccountID: "acc-bbva", Type: "expense", Amount: 30000, CategoryID: strptr("cat-food"), Date: "2026-08-12", Description: "Despensa"},
		},
		budgets: []store.Budget{
			{ID: "bud-food", CategoryID: strptr("cat-food"), Amount: 900000, Period: "monthly", StartDate: "2026-08-01"},
			{ID: "bud-global", CategoryID: nil, Amount: 15000000, Period: "monthly", StartDate: "2026-01-01"},
			{ID: "bud-transport", CategoryID: strptr("cat-transport"), Amount: 200000, Period: "yearly", StartDate: "2025-09-22"},
		},
		savingsGoals: []store.SavingsGoal{
			{ID: "goal-emergency", Name: "Fondo de emergencia", TargetAmount: 120000000, CurrentAmount: 85000000, TargetDate: strptr("2026-12-31"), IsCompleted: false, SortOrder: 0},
			{ID: "goal-laptop", Name: "Laptop", TargetAmount: 3500000, CurrentAmount: 3500000, IsCompleted: true, SortOrder: 1},
		},
		recurring: []store.RecurringTransaction{
			{ID: "rec-netflix", AccountID: "acc-banamex", CategoryID: strptr("cat-food"), Description: "Netflix", Amount: 21900, Frequency: "monthly", StartDate: "2026-01-05", NextDate: "2026-08-05", IsActive: true},
			{ID: "rec-old-gym", AccountID: "acc-bbva", Description: "Gimnasio viejo", Amount: 50000, Frequency: "monthly", StartDate: "2025-01-01", NextDate: "2026-02-01", IsActive: false},
		},
		msiPurchases: []store.MSIPurchase{
			{ID: "msi-phone", AccountID: "acc-banamex", CategoryID: strptr("cat-food"), Description: "Celular", TotalAmount: 18000000, InstallmentAmount: 1500000, InstallmentCount: 12, InstallmentsPaid: 6, StartDate: "2026-02-01", NextInstallmentDate: strptr("2026-08-01"), Status: "active"},
			{ID: "msi-done", AccountID: "acc-banamex", Description: "Bicicleta", TotalAmount: 6000000, InstallmentAmount: 500000, InstallmentCount: 12, InstallmentsPaid: 12, StartDate: "2025-01-01", Status: "completed"},
		},
	}
}

func strptr(s string) *string { return &s }

const testUser = "1b65ab86-586b-427f-b126-ee7f7ad35753"

func mustRegistry(t *testing.T, store ReadStore) *ToolRegistry {
	t.Helper()
	registry, err := NewReadOnlyToolRegistry(store, testUser, "2026-08-14")
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
	for _, want := range []string{
		"list_accounts", "list_categories", "search_transactions", "get_financial_summary",
		"list_budgets", "list_savings_goals", "list_recurring_transactions", "list_msi_purchases",
		"get_cash_flow_forecast",
	} {
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

func TestSearchTransactionsToolReturnsLatestNonFutureMovementFirst(t *testing.T) {
	data := sampleStore()
	data.transactions = []store.Transaction{
		{ID: "older", Date: "2026-08-01", Type: "expense", Amount: 100},
		{ID: "future-msi", Date: "2028-01-15", Type: "expense", Amount: 300, MSIPurchaseID: strptr("laptop")},
		{ID: "latest", Date: "2026-08-13", Type: "expense", Amount: 200},
	}
	registry := mustRegistry(t, data)
	result := callTool(t, registry, "search_transactions", `{"limit":1}`)

	var payload struct {
		Transactions []struct {
			ID string `json:"id"`
		} `json:"transactions"`
	}
	if err := json.Unmarshal(result.Data, &payload); err != nil {
		t.Fatalf("decode data: %v", err)
	}
	if len(payload.Transactions) != 1 || payload.Transactions[0].ID != "latest" {
		t.Fatalf("transactions = %+v, want latest non-future movement", payload.Transactions)
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

func TestFinancialSummaryDefaultsToCurrentDate(t *testing.T) {
	data := sampleStore()
	data.transactions = append(data.transactions, store.Transaction{
		ID: "future-income", Date: "2028-01-15", Type: "income", Amount: 9000000,
	})
	registry := mustRegistry(t, data)
	result := callTool(t, registry, "get_financial_summary", `{}`)

	var payload struct {
		IncomeCents int64 `json:"incomeCents"`
	}
	if err := json.Unmarshal(result.Data, &payload); err != nil {
		t.Fatalf("decode data: %v", err)
	}
	if payload.IncomeCents != 2400000 {
		t.Fatalf("income = %d, want current income only", payload.IncomeCents)
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

func TestListBudgetsToolComputesCycleProgress(t *testing.T) {
	registry := mustRegistry(t, sampleStore()) // currentDate 2026-08-14
	result := callTool(t, registry, "list_budgets", `{}`)

	var payload struct {
		Budgets []struct {
			ID             string `json:"id"`
			CategoryName   string `json:"categoryName"`
			WindowStart    string `json:"windowStart"`
			WindowEnd      string `json:"windowEnd"`
			SpentCents     int64  `json:"spentCents"`
			RemainingCents int64  `json:"remainingCents"`
		} `json:"budgets"`
	}
	if err := json.Unmarshal(result.Data, &payload); err != nil {
		t.Fatalf("decode data: %v", err)
	}
	if len(payload.Budgets) != 3 {
		t.Fatalf("expected 3 budgets, got %d", len(payload.Budgets))
	}
	byID := map[string]int{}
	for i, b := range payload.Budgets {
		byID[b.ID] = i
	}

	// Monthly anchored 2026-08-01: window Aug 01..Aug 31, spent = t5 only.
	food := payload.Budgets[byID["bud-food"]]
	if food.CategoryName != "Alimentos y Bebidas" {
		t.Fatalf("food category name = %q", food.CategoryName)
	}
	if food.WindowStart != "2026-08-01" || food.WindowEnd != "2026-08-31" {
		t.Fatalf("food window = %s..%s", food.WindowStart, food.WindowEnd)
	}
	if food.SpentCents != 30000 || food.RemainingCents != 870000 {
		t.Fatalf("food spent/remaining = %d/%d, want 30000/870000", food.SpentCents, food.RemainingCents)
	}

	// Global monthly anchored 2026-01-01: window Aug 01..Aug 31, expenses = t5.
	global := payload.Budgets[byID["bud-global"]]
	if global.CategoryName != "Global" {
		t.Fatalf("global category name = %q", global.CategoryName)
	}
	if global.SpentCents != 30000 {
		t.Fatalf("global spent = %d, want 30000 (income excluded)", global.SpentCents)
	}

	// Yearly anchored 2025-09-22: window 2025-09-22..2026-09-21, spent = t3.
	transport := payload.Budgets[byID["bud-transport"]]
	if transport.WindowStart != "2025-09-22" || transport.WindowEnd != "2026-09-21" {
		t.Fatalf("transport window = %s..%s", transport.WindowStart, transport.WindowEnd)
	}
	if transport.SpentCents != 25000 || transport.RemainingCents != 175000 {
		t.Fatalf("transport spent/remaining = %d/%d, want 25000/175000", transport.SpentCents, transport.RemainingCents)
	}
}

func TestBudgetCycleWindowAdvancesFromAnchor(t *testing.T) {
	cases := []struct {
		name                    string
		period, anchor, current string
		wantStart, wantEnd      string
	}{
		{"weekly same cycle", "weekly", "2026-08-10", "2026-08-14", "2026-08-10", "2026-08-16"},
		{"weekly next cycle", "weekly", "2026-08-10", "2026-08-17", "2026-08-17", "2026-08-23"},
		{"monthly mid cycle", "monthly", "2026-08-01", "2026-08-14", "2026-08-01", "2026-08-31"},
		{"monthly later cycle", "monthly", "2026-01-15", "2026-08-14", "2026-07-15", "2026-08-14"},
		{"monthly clamp short month", "monthly", "2026-01-31", "2026-03-05", "2026-02-28", "2026-03-30"},
		{"yearly first cycle", "yearly", "2025-09-22", "2026-08-14", "2025-09-22", "2026-09-21"},
		{"yearly later cycle", "yearly", "2024-02-29", "2026-08-14", "2026-02-28", "2027-02-27"},
		{"future anchor keeps first cycle", "monthly", "2026-09-01", "2026-08-14", "2026-09-01", "2026-09-30"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			start, end := budgetCycleWindow(tc.period, tc.anchor, tc.current)
			if start != tc.wantStart || end != tc.wantEnd {
				t.Fatalf("window = %s..%s, want %s..%s", start, end, tc.wantStart, tc.wantEnd)
			}
		})
	}
}

func TestListSavingsGoalsToolOmitsCompletedByDefault(t *testing.T) {
	registry := mustRegistry(t, sampleStore())
	result := callTool(t, registry, "list_savings_goals", `{}`)

	var payload struct {
		SavingsGoals []struct {
			Name            string `json:"name"`
			ProgressPercent int64  `json:"progressPercent"`
			RemainingCents  int64  `json:"remainingCents"`
			IsCompleted     bool   `json:"isCompleted"`
		} `json:"savingsGoals"`
	}
	if err := json.Unmarshal(result.Data, &payload); err != nil {
		t.Fatalf("decode data: %v", err)
	}
	if len(payload.SavingsGoals) != 1 || payload.SavingsGoals[0].Name != "Fondo de emergencia" {
		t.Fatalf("expected only the active goal, got %+v", payload.SavingsGoals)
	}
	goal := payload.SavingsGoals[0]
	if goal.ProgressPercent != 70 || goal.RemainingCents != 35000000 {
		t.Fatalf("progress/remaining = %d/%d, want 70/35000000", goal.ProgressPercent, goal.RemainingCents)
	}

	all := callTool(t, registry, "list_savings_goals", `{"includeCompleted":true}`)
	var allPayload struct {
		SavingsGoals []json.RawMessage `json:"savingsGoals"`
	}
	if err := json.Unmarshal(all.Data, &allPayload); err != nil {
		t.Fatalf("decode all data: %v", err)
	}
	if len(allPayload.SavingsGoals) != 2 {
		t.Fatalf("expected 2 goals including completed, got %d", len(allPayload.SavingsGoals))
	}
}

func TestListRecurringTransactionsToolFiltersInactive(t *testing.T) {
	registry := mustRegistry(t, sampleStore())
	result := callTool(t, registry, "list_recurring_transactions", `{}`)

	var payload struct {
		RecurringTransactions []struct {
			Description string `json:"description"`
			NextDate    string `json:"nextDate"`
		} `json:"recurringTransactions"`
		MonthlyOutflowCentsApprox int64 `json:"monthlyOutflowCentsApprox"`
	}
	if err := json.Unmarshal(result.Data, &payload); err != nil {
		t.Fatalf("decode data: %v", err)
	}
	if len(payload.RecurringTransactions) != 1 || payload.RecurringTransactions[0].Description != "Netflix" {
		t.Fatalf("expected only active recurring, got %+v", payload.RecurringTransactions)
	}
	if payload.MonthlyOutflowCentsApprox != 21900 {
		t.Fatalf("monthly outflow = %d, want 21900", payload.MonthlyOutflowCentsApprox)
	}

	withInactive := callTool(t, registry, "list_recurring_transactions", `{"includeInactive":true}`)
	var inactivePayload struct {
		RecurringTransactions []json.RawMessage `json:"recurringTransactions"`
	}
	if err := json.Unmarshal(withInactive.Data, &inactivePayload); err != nil {
		t.Fatalf("decode inactive data: %v", err)
	}
	if len(inactivePayload.RecurringTransactions) != 2 {
		t.Fatalf("expected 2 recurring including inactive, got %d", len(inactivePayload.RecurringTransactions))
	}
}

func TestListMSIPurchasesToolAggregatesActiveDebt(t *testing.T) {
	registry := mustRegistry(t, sampleStore())
	result := callTool(t, registry, "list_msi_purchases", `{}`)

	var payload struct {
		MSIPurchases []struct {
			Description           string `json:"description"`
			InstallmentsRemaining int    `json:"installmentsRemaining"`
			Status                string `json:"status"`
		} `json:"msiPurchases"`
		ActiveDebtRemainingCents int64 `json:"activeDebtRemainingCents"`
		ActiveMonthlyBurdenCents int64 `json:"activeMonthlyBurdenCents"`
	}
	if err := json.Unmarshal(result.Data, &payload); err != nil {
		t.Fatalf("decode data: %v", err)
	}
	if len(payload.MSIPurchases) != 2 {
		t.Fatalf("expected 2 purchases unfiltered, got %d", len(payload.MSIPurchases))
	}
	if payload.ActiveDebtRemainingCents != 9000000 {
		t.Fatalf("active debt = %d, want 9000000 (6 remaining x 1500000)", payload.ActiveDebtRemainingCents)
	}
	if payload.ActiveMonthlyBurdenCents != 1500000 {
		t.Fatalf("monthly burden = %d, want 1500000", payload.ActiveMonthlyBurdenCents)
	}

	activeOnly := callTool(t, registry, "list_msi_purchases", `{"status":"active"}`)
	var activePayload struct {
		MSIPurchases []struct {
			Description string `json:"description"`
		} `json:"msiPurchases"`
	}
	if err := json.Unmarshal(activeOnly.Data, &activePayload); err != nil {
		t.Fatalf("decode active data: %v", err)
	}
	if len(activePayload.MSIPurchases) != 1 || activePayload.MSIPurchases[0].Description != "Celular" {
		t.Fatalf("expected only the active purchase, got %+v", activePayload.MSIPurchases)
	}
}

func TestPlanningListToolsExposeEveryFullUpdateField(t *testing.T) {
	registry := mustRegistry(t, sampleStore())
	tests := []struct {
		name      string
		arguments string
		arrayKey  string
		fields    []string
	}{
		{name: "list_budgets", arguments: `{}`, arrayKey: "budgets", fields: []string{"id", "categoryId", "amountCents", "period", "startDate"}},
		{name: "list_savings_goals", arguments: `{"includeCompleted":true}`, arrayKey: "savingsGoals", fields: []string{"id", "name", "targetAmountCents", "targetDate", "accountId", "order"}},
		{name: "list_recurring_transactions", arguments: `{"includeInactive":true}`, arrayKey: "recurringTransactions", fields: []string{"id", "accountId", "categoryId", "description", "merchant", "amountCents", "frequency", "startDate", "isActive"}},
		{name: "list_msi_purchases", arguments: `{"status":null}`, arrayKey: "msiPurchases", fields: []string{"id", "accountId", "categoryId", "description", "merchant", "totalAmountCents", "installmentCount", "startDate"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := callTool(t, registry, tt.name, tt.arguments)
			var payload map[string]json.RawMessage
			if err := json.Unmarshal(result.Data, &payload); err != nil {
				t.Fatalf("decode payload: %v", err)
			}
			var rows []map[string]json.RawMessage
			if err := json.Unmarshal(payload[tt.arrayKey], &rows); err != nil || len(rows) == 0 {
				t.Fatalf("decode %s rows: %v, count=%d", tt.arrayKey, err, len(rows))
			}
			for _, field := range tt.fields {
				if _, ok := rows[0][field]; !ok {
					t.Errorf("first row missing %q: %s", field, payload[tt.arrayKey])
				}
			}
		})
	}
}

func TestCashFlowForecastToolProjectsLiquidityAndCommitments(t *testing.T) {
	registry := mustRegistry(t, sampleStore()) // currentDate 2026-08-14
	result := callTool(t, registry, "get_cash_flow_forecast", `{"daysAhead":30}`)

	var payload struct {
		StartingLiquidBalanceCents int64  `json:"startingLiquidBalanceCents"`
		HorizonDays                int    `json:"horizonDays"`
		EndDate                    string `json:"endDate"`
		ProjectedBalanceCents      int64  `json:"projectedBalanceCents"`
		MinBalanceCents            int64  `json:"minBalanceCents"`
		MinBalanceDate             string `json:"minBalanceDate"`
		IsLiquidityRisk            bool   `json:"isLiquidityRisk"`
		TotalRecurringOutflowCents int64  `json:"totalRecurringOutflowCents"`
		TotalMSIOutflowCents       int64  `json:"totalMSIOutflowCents"`
		ScheduledPaymentsCount     int    `json:"scheduledPaymentsCount"`
		UpcomingPayments           []struct {
			Date                       string `json:"date"`
			Type                       string `json:"type"`
			Description                string `json:"description"`
			AmountCents                int64  `json:"amountCents"`
			ProjectedBalanceAfterCents int64  `json:"projectedBalanceAfterCents"`
		} `json:"upcomingPayments"`
	}

	if err := json.Unmarshal(result.Data, &payload); err != nil {
		t.Fatalf("decode forecast payload: %v", err)
	}

	// acc-bbva is active debit account with 2540050 cents
	if payload.StartingLiquidBalanceCents != 2540050 {
		t.Fatalf("starting liquid balance = %d, want 2540050", payload.StartingLiquidBalanceCents)
	}
	if payload.HorizonDays != 30 {
		t.Fatalf("horizonDays = %d, want 30", payload.HorizonDays)
	}
	if payload.IsLiquidityRisk {
		t.Fatal("expected no liquidity risk with healthy starting balance")
	}

	// Within 30 days of 2026-08-14 (up to 2026-09-13):
	// - msi-phone installment on 2026-09-01 (1500000 cents)
	// - rec-netflix occurrence on 2026-09-05 (21900 cents)
	if payload.ScheduledPaymentsCount != 2 {
		t.Fatalf("payments count = %d, want 2 (%+v)", payload.ScheduledPaymentsCount, payload.UpcomingPayments)
	}
	if payload.TotalMSIOutflowCents != 1500000 {
		t.Fatalf("total msi outflow = %d, want 1500000", payload.TotalMSIOutflowCents)
	}
	if payload.TotalRecurringOutflowCents != 21900 {
		t.Fatalf("total recurring outflow = %d, want 21900", payload.TotalRecurringOutflowCents)
	}

	wantEndBalance := int64(2540050 - 1500000 - 21900)
	if payload.ProjectedBalanceCents != wantEndBalance {
		t.Fatalf("projected balance = %d, want %d", payload.ProjectedBalanceCents, wantEndBalance)
	}
}

func TestCashFlowForecastToolRejectsInvalidDaysAhead(t *testing.T) {
	registry := mustRegistry(t, sampleStore())
	tool, _ := registry.lookup("get_cash_flow_forecast")

	for _, invalid := range []string{`{"daysAhead":15}`, `{"daysAhead":45}`, `{"daysAhead":120}`} {
		result, err := tool.Handler(context.Background(), json.RawMessage(invalid))
		if err != nil {
			t.Fatalf("handler err: %v", err)
		}
		if result.Status != ToolStatusError {
			t.Fatalf("daysAhead %s: status = %q, want error", invalid, result.Status)
		}
	}
}
