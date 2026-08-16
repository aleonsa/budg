package httpapi_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/aleonsa/budg/backend/internal/httpapi"
	"github.com/aleonsa/budg/backend/internal/store"
)

type stubSavingsGoalStore struct {
	listErr          error
	createErr        error
	updateErr        error
	contributeErr    error
	deleteErr        error
	listResult       []store.SavingsGoal
	createInput      store.SavingsGoalInput
	updateID         string
	updatePatch      store.SavingsGoalPatch
	contributeID     string
	contributeAmount int64
	deleteID         string
	createResult     store.SavingsGoal
	updateResult     store.SavingsGoal
	contributeResult store.SavingsGoal
	overviewResult   store.SavingsOverview
	overviewErr      error
	saveID           string
	saveInput        store.SaveToGoalInput
	saveResult       store.SavingsGoalActionResult
	saveErr          error
	allocationID     string
	allocationInput  store.SavingsAllocationInput
	allocationResult store.SavingsGoal
	allocationErr    error
	reallocateID     string
	reallocateInput  store.SavingsReallocationInput
	reallocateResult store.SavingsReallocationResult
	reallocateErr    error
}

func (s *stubSavingsGoalStore) List(_ context.Context, _ string) ([]store.SavingsGoal, error) {
	return s.listResult, s.listErr
}

func (s *stubSavingsGoalStore) Create(_ context.Context, _ string, in store.SavingsGoalInput) (store.SavingsGoal, error) {
	s.createInput = in
	return s.createResult, s.createErr
}

func (s *stubSavingsGoalStore) Update(_ context.Context, _, id string, patch store.SavingsGoalPatch) (store.SavingsGoal, error) {
	s.updateID = id
	s.updatePatch = patch
	return s.updateResult, s.updateErr
}

func (s *stubSavingsGoalStore) Contribute(_ context.Context, _, id string, amount int64) (store.SavingsGoal, error) {
	s.contributeID = id
	s.contributeAmount = amount
	return s.contributeResult, s.contributeErr
}

func (s *stubSavingsGoalStore) Delete(_ context.Context, _, id string) error {
	s.deleteID = id
	return s.deleteErr
}

func (s *stubSavingsGoalStore) Overview(_ context.Context, _ string) (store.SavingsOverview, error) {
	return s.overviewResult, s.overviewErr
}

func (s *stubSavingsGoalStore) Save(_ context.Context, _, id string, in store.SaveToGoalInput) (store.SavingsGoalActionResult, error) {
	s.saveID = id
	s.saveInput = in
	return s.saveResult, s.saveErr
}

func (s *stubSavingsGoalStore) Allocate(_ context.Context, _, id string, in store.SavingsAllocationInput) (store.SavingsGoal, error) {
	s.allocationID = id
	s.allocationInput = in
	return s.allocationResult, s.allocationErr
}

func (s *stubSavingsGoalStore) Reallocate(_ context.Context, _, id string, in store.SavingsReallocationInput) (store.SavingsReallocationResult, error) {
	s.reallocateID = id
	s.reallocateInput = in
	return s.reallocateResult, s.reallocateErr
}

func newSavingsGoalsRouter(stub SavingsGoalStoreForTest) http.Handler {
	return httpapi.NewRouter(httpapi.Options{
		Database:       readyDatabase(),
		AuthMiddleware: authenticatedMiddleware,
		SavingsGoals:   stub,
	})
}

type SavingsGoalStoreForTest = httpapi.SavingsGoalStore

func doSavingsRequestWithKey(handler http.Handler, method, target, body, key string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", key)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func TestListSavingsGoalsReturnsData(t *testing.T) {
	t.Parallel()
	stub := &stubSavingsGoalStore{
		listResult: []store.SavingsGoal{
			{ID: "goal-1", UserID: "user-1", Name: "Trip", TargetAmount: 50000, CurrentAmount: 5000, SortOrder: 0},
		},
	}
	router := newSavingsGoalsRouter(stub)

	rec := doRequest(router, http.MethodGet, "/v1/savings-goals", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body struct {
		Data []store.SavingsGoal `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if len(body.Data) != 1 || body.Data[0].ID != "goal-1" {
		t.Fatalf("data = %+v, want [goal-1]", body.Data)
	}
}

func TestListSavingsGoalsReportsInternalError(t *testing.T) {
	t.Parallel()
	stub := &stubSavingsGoalStore{listErr: errors.New("connection lost")}
	router := newSavingsGoalsRouter(stub)

	rec := doRequest(router, http.MethodGet, "/v1/savings-goals", "")

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
}

func TestCreateSavingsGoalPersistsAndReturnsCreated(t *testing.T) {
	t.Parallel()
	stub := &stubSavingsGoalStore{
		createResult: store.SavingsGoal{
			ID: "goal-new", UserID: "user-1", Name: "Trip", TargetAmount: 50000, CurrentAmount: 0, SortOrder: 0,
		},
	}
	router := newSavingsGoalsRouter(stub)

	body := `{"name":"Trip","targetAmount":50000,"currentAmount":0,"targetDate":"2027-01-15","order":0}`
	rec := doRequest(router, http.MethodPost, "/v1/savings-goals", body)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rec.Code, rec.Body.String())
	}
	if stub.createInput.Name != "Trip" || stub.createInput.TargetAmount != 50000 {
		t.Fatalf("captured input = %+v", stub.createInput)
	}
	if stub.createInput.TargetDate == nil || *stub.createInput.TargetDate != "2027-01-15" {
		t.Fatalf("captured target date = %+v", stub.createInput.TargetDate)
	}
}

func TestCreateSavingsGoalRejectsInvalidPayload(t *testing.T) {
	t.Parallel()
	stub := &stubSavingsGoalStore{}
	router := newSavingsGoalsRouter(stub)

	cases := []struct {
		name string
		body string
	}{
		{"malformed json", `{"name":`},
		{"missing name", `{"targetAmount":50000,"currentAmount":0}`},
		{"zero targetAmount", `{"name":"Trip","targetAmount":0,"currentAmount":0}`},
		{"negative targetAmount", `{"name":"Trip","targetAmount":-100,"currentAmount":0}`},
		{"negative currentAmount", `{"name":"Trip","targetAmount":50000,"currentAmount":-10}`},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			rec := doRequest(router, http.MethodPost, "/v1/savings-goals", tc.body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 for %s", rec.Code, tc.name)
			}
		})
	}
}

func TestUpdateSavingsGoalAppliesPatchAndReturnsUpdated(t *testing.T) {
	t.Parallel()
	newName := "Long Trip"
	stub := &stubSavingsGoalStore{
		updateResult: store.SavingsGoal{ID: "goal-1", Name: "Long Trip"},
	}
	router := newSavingsGoalsRouter(stub)

	body := `{"name":"Long Trip","accountId":"00000000-0000-0000-0000-000000000002","targetDate":null}`
	rec := doRequest(router, http.MethodPatch, "/v1/savings-goals/goal-1", body)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if stub.updateID != "goal-1" {
		t.Fatalf("captured id = %q, want goal-1", stub.updateID)
	}
	if stub.updatePatch.Name == nil || *stub.updatePatch.Name != newName {
		t.Fatalf("captured name patch = %+v", stub.updatePatch.Name)
	}
	if !stub.updatePatch.AccountID.Set || stub.updatePatch.AccountID.Value == nil || *stub.updatePatch.AccountID.Value != "00000000-0000-0000-0000-000000000002" {
		t.Fatalf("captured account patch = %+v", stub.updatePatch.AccountID)
	}
	if !stub.updatePatch.TargetDate.Set || stub.updatePatch.TargetDate.Value != nil {
		t.Fatalf("captured target date patch = %+v", stub.updatePatch.TargetDate)
	}
}

func TestUpdateSavingsGoalRejectsInvalidPatch(t *testing.T) {
	t.Parallel()
	router := newSavingsGoalsRouter(&stubSavingsGoalStore{})

	cases := []string{
		`{"name":""}`,
		`{"targetAmount":0}`,
		`{"targetDate":"not-a-date"}`,
	}
	for _, body := range cases {
		rec := doRequest(router, http.MethodPatch, "/v1/savings-goals/goal-1", body)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400 for body %s", rec.Code, body)
		}
	}
}

func TestUpdateSavingsGoalReportsNotFound(t *testing.T) {
	t.Parallel()
	stub := &stubSavingsGoalStore{updateErr: store.ErrNotFound}
	router := newSavingsGoalsRouter(stub)

	rec := doRequest(router, http.MethodPatch, "/v1/savings-goals/missing", `{"name":"X"}`)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestLegacySavingsGoalContributionsAreNotRouted(t *testing.T) {
	t.Parallel()
	stub := &stubSavingsGoalStore{}
	router := newSavingsGoalsRouter(stub)

	rec := doRequest(router, http.MethodPost, "/v1/savings-goals/goal-1/contributions", `{"amount":1000}`)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestContributeToSavingsGoalRejectsZeroAmount(t *testing.T) {
	t.Parallel()
	router := newSavingsGoalsRouter(&stubSavingsGoalStore{})

	rec := doRequest(router, http.MethodPost, "/v1/savings-goals/goal-1/contributions", `{"amount":0}`)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestContributeToSavingsGoalReportsNotFound(t *testing.T) {
	t.Parallel()
	router := newSavingsGoalsRouter(&stubSavingsGoalStore{contributeErr: store.ErrNotFound})

	rec := doRequest(router, http.MethodPost, "/v1/savings-goals/missing/contributions", `{"amount":1000}`)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestDeleteSavingsGoalReturnsNoContent(t *testing.T) {
	t.Parallel()
	stub := &stubSavingsGoalStore{}
	router := newSavingsGoalsRouter(stub)

	rec := doRequest(router, http.MethodDelete, "/v1/savings-goals/goal-1", "")

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	if stub.deleteID != "goal-1" {
		t.Fatalf("captured id = %q, want goal-1", stub.deleteID)
	}
}

func TestDeleteSavingsGoalReportsNotFound(t *testing.T) {
	t.Parallel()
	stub := &stubSavingsGoalStore{deleteErr: store.ErrNotFound}
	router := newSavingsGoalsRouter(stub)

	rec := doRequest(router, http.MethodDelete, "/v1/savings-goals/missing", "")

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestSavingsOverviewReturnsAllocationTotals(t *testing.T) {
	t.Parallel()
	stub := &stubSavingsGoalStore{overviewResult: store.SavingsOverview{
		TotalAllocated: 10000, TotalAccountBalance: 15000, TotalUnallocated: 5000,
	}}
	router := newSavingsGoalsRouter(stub)

	rec := doRequest(router, http.MethodGet, "/v1/savings-goals/overview", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
}

func TestSaveToGoalCreatesTransferAndAllocation(t *testing.T) {
	t.Parallel()
	stub := &stubSavingsGoalStore{saveResult: store.SavingsGoalActionResult{
		Goal:        store.SavingsGoal{ID: "goal-1", CurrentAmount: 1000},
		Transaction: store.Transaction{ID: "tx-1", Amount: 1000},
	}}
	router := newSavingsGoalsRouter(stub)

	body := `{"sourceAccountId":"acc-1","destinationAccountId":"acc-2","amount":1000,"date":"2026-08-16","description":"Ahorro"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/savings-goals/goal-1/savings", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "save-key-1")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rec.Code, rec.Body.String())
	}
	if stub.saveID != "goal-1" || stub.saveInput.IdempotencyKey != "save-key-1" || stub.saveInput.Amount != 1000 {
		t.Fatalf("captured save = id %q input %+v", stub.saveID, stub.saveInput)
	}
}

func TestSaveToGoalRequiresIdempotencyKey(t *testing.T) {
	t.Parallel()
	router := newSavingsGoalsRouter(&stubSavingsGoalStore{})
	body := `{"sourceAccountId":"acc-1","destinationAccountId":"acc-2","amount":1000,"date":"2026-08-16","description":"Ahorro"}`

	rec := doRequest(router, http.MethodPost, "/v1/savings-goals/goal-1/savings", body)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestAllocateAndReallocateSavings(t *testing.T) {
	t.Parallel()
	stub := &stubSavingsGoalStore{}
	router := newSavingsGoalsRouter(stub)

	allocated := doSavingsRequestWithKey(router, http.MethodPost, "/v1/savings-goals/goal-1/allocations", `{"accountId":"acc-2","amount":500,"date":"2026-08-16"}`, "allocation-key-1")
	if allocated.Code != http.StatusOK {
		t.Fatalf("allocate status = %d, want 200 (body=%s)", allocated.Code, allocated.Body.String())
	}
	if stub.allocationID != "goal-1" || stub.allocationInput.Amount != 500 || stub.allocationInput.IdempotencyKey != "allocation-key-1" {
		t.Fatalf("captured allocation = id %q input %+v", stub.allocationID, stub.allocationInput)
	}

	reallocated := doSavingsRequestWithKey(router, http.MethodPost, "/v1/savings-goals/goal-1/reallocations", `{"toGoalId":"goal-2","accountId":"acc-2","amount":250,"date":"2026-08-16"}`, "reallocation-key-1")
	if reallocated.Code != http.StatusOK {
		t.Fatalf("reallocate status = %d, want 200 (body=%s)", reallocated.Code, reallocated.Body.String())
	}
	if stub.reallocateID != "goal-1" || stub.reallocateInput.ToGoalID != "goal-2" || stub.reallocateInput.Amount != 250 {
		t.Fatalf("captured reallocation = id %q input %+v", stub.reallocateID, stub.reallocateInput)
	}
}
