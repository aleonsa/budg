package httpapi_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"github.com/aleonsa/budg/backend/internal/httpapi"
	"github.com/aleonsa/budg/backend/internal/store"
)

type stubBudgetStore struct {
	listErr      error
	createErr    error
	updateErr    error
	deleteErr    error
	listResult   []store.Budget
	createInput  store.BudgetInput
	updateID     string
	updatePatch  store.BudgetPatch
	deleteID     string
	createResult store.Budget
	updateResult store.Budget
}

func (s *stubBudgetStore) List(_ context.Context, _ string) ([]store.Budget, error) {
	return s.listResult, s.listErr
}

func (s *stubBudgetStore) Create(_ context.Context, _ string, in store.BudgetInput) (store.Budget, error) {
	s.createInput = in
	return s.createResult, s.createErr
}

func (s *stubBudgetStore) Update(_ context.Context, _, id string, patch store.BudgetPatch) (store.Budget, error) {
	s.updateID = id
	s.updatePatch = patch
	return s.updateResult, s.updateErr
}

func (s *stubBudgetStore) Delete(_ context.Context, _, id string) error {
	s.deleteID = id
	return s.deleteErr
}

func newBudgetsRouter(stub BudgetStoreForTest) http.Handler {
	return httpapi.NewRouter(httpapi.Options{
		Database:       readyDatabase(),
		AuthMiddleware: authenticatedMiddleware,
		Budgets:        stub,
	})
}

type BudgetStoreForTest = httpapi.BudgetStore

func TestListBudgetsReturnsData(t *testing.T) {
	t.Parallel()
	stub := &stubBudgetStore{
		listResult: []store.Budget{
			{ID: "bud-1", UserID: "user-1", Amount: 5000, Period: "monthly", StartDate: "2026-01-01"},
		},
	}
	router := newBudgetsRouter(stub)

	rec := doRequest(router, http.MethodGet, "/v1/budgets", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body struct {
		Data []store.Budget `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if len(body.Data) != 1 || body.Data[0].ID != "bud-1" {
		t.Fatalf("data = %+v, want [bud-1]", body.Data)
	}
}

func TestListBudgetsReportsInternalError(t *testing.T) {
	t.Parallel()
	stub := &stubBudgetStore{listErr: errors.New("connection lost")}
	router := newBudgetsRouter(stub)

	rec := doRequest(router, http.MethodGet, "/v1/budgets", "")

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
}

func TestCreateBudgetPersistsAndReturnsCreated(t *testing.T) {
	t.Parallel()
	stub := &stubBudgetStore{
		createResult: store.Budget{
			ID: "bud-new", UserID: "user-1", Amount: 10000, Period: "monthly", StartDate: "2026-07-01",
		},
	}
	router := newBudgetsRouter(stub)

	body := `{"amount":10000,"period":"monthly","startDate":"2026-07-01"}`
	rec := doRequest(router, http.MethodPost, "/v1/budgets", body)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rec.Code, rec.Body.String())
	}
	if stub.createInput.Amount != 10000 || stub.createInput.Period != "monthly" {
		t.Fatalf("captured input = %+v", stub.createInput)
	}
}

func TestCreateBudgetRejectsInvalidPayload(t *testing.T) {
	t.Parallel()
	stub := &stubBudgetStore{}
	router := newBudgetsRouter(stub)

	cases := []struct {
		name string
		body string
	}{
		{"malformed json", `{"amount":`},
		{"zero amount", `{"amount":0,"period":"monthly","startDate":"2026-07-01"}`},
		{"negative amount", `{"amount":-100,"period":"monthly","startDate":"2026-07-01"}`},
		{"bad period", `{"amount":100,"period":"daily","startDate":"2026-07-01"}`},
		{"bad date", `{"amount":100,"period":"monthly","startDate":"07-01-2026"}`},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			rec := doRequest(router, http.MethodPost, "/v1/budgets", tc.body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 for %s", rec.Code, tc.name)
			}
		})
	}
}

func TestUpdateBudgetAppliesPatchAndReturnsUpdated(t *testing.T) {
	t.Parallel()
	newAmt := int64(12000)
	stub := &stubBudgetStore{
		updateResult: store.Budget{ID: "bud-1", Amount: 12000},
	}
	router := newBudgetsRouter(stub)

	body := `{"amount":12000}`
	rec := doRequest(router, http.MethodPatch, "/v1/budgets/bud-1", body)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if stub.updateID != "bud-1" {
		t.Fatalf("captured id = %q, want bud-1", stub.updateID)
	}
	if stub.updatePatch.Amount == nil || *stub.updatePatch.Amount != newAmt {
		t.Fatalf("captured amount patch = %+v", stub.updatePatch.Amount)
	}
}

func TestUpdateBudgetReportsNotFound(t *testing.T) {
	t.Parallel()
	stub := &stubBudgetStore{updateErr: store.ErrNotFound}
	router := newBudgetsRouter(stub)

	rec := doRequest(router, http.MethodPatch, "/v1/budgets/missing", `{"amount":100}`)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestDeleteBudgetReturnsNoContent(t *testing.T) {
	t.Parallel()
	stub := &stubBudgetStore{}
	router := newBudgetsRouter(stub)

	rec := doRequest(router, http.MethodDelete, "/v1/budgets/bud-1", "")

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	if stub.deleteID != "bud-1" {
		t.Fatalf("captured id = %q, want bud-1", stub.deleteID)
	}
}

func TestDeleteBudgetReportsNotFound(t *testing.T) {
	t.Parallel()
	stub := &stubBudgetStore{deleteErr: store.ErrNotFound}
	router := newBudgetsRouter(stub)

	rec := doRequest(router, http.MethodDelete, "/v1/budgets/missing", "")

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}
