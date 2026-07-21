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

type stubSavingsGoalStore struct {
	listErr      error
	createErr    error
	updateErr    error
	deleteErr    error
	listResult   []store.SavingsGoal
	createInput  store.SavingsGoalInput
	updateID     string
	updatePatch  store.SavingsGoalPatch
	deleteID     string
	createResult store.SavingsGoal
	updateResult store.SavingsGoal
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

func (s *stubSavingsGoalStore) Delete(_ context.Context, _, id string) error {
	s.deleteID = id
	return s.deleteErr
}

func newSavingsGoalsRouter(stub SavingsGoalStoreForTest) http.Handler {
	return httpapi.NewRouter(httpapi.Options{
		Database:       readyDatabase(),
		AuthMiddleware: authenticatedMiddleware,
		SavingsGoals:   stub,
	})
}

type SavingsGoalStoreForTest = httpapi.SavingsGoalStore

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

	body := `{"name":"Trip","targetAmount":50000,"currentAmount":0,"order":0}`
	rec := doRequest(router, http.MethodPost, "/v1/savings-goals", body)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rec.Code, rec.Body.String())
	}
	if stub.createInput.Name != "Trip" || stub.createInput.TargetAmount != 50000 {
		t.Fatalf("captured input = %+v", stub.createInput)
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

	body := `{"name":"Long Trip"}`
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
