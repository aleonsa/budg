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

type stubRuleStore struct {
	listErr      error
	createErr    error
	toggleErr    error
	deleteErr    error
	listResult   []store.Rule
	createInput  store.RuleInput
	toggleID     string
	deleteID     string
	createResult store.Rule
	toggleResult store.Rule
}

func (s *stubRuleStore) List(_ context.Context, _ string) ([]store.Rule, error) {
	return s.listResult, s.listErr
}

func (s *stubRuleStore) Create(_ context.Context, _ string, in store.RuleInput) (store.Rule, error) {
	s.createInput = in
	return s.createResult, s.createErr
}

func (s *stubRuleStore) Toggle(_ context.Context, _, id string) (store.Rule, error) {
	s.toggleID = id
	return s.toggleResult, s.toggleErr
}

func (s *stubRuleStore) Delete(_ context.Context, _, id string) error {
	s.deleteID = id
	return s.deleteErr
}

func newRulesRouter(stub RuleStoreForTest) http.Handler {
	return httpapi.NewRouter(httpapi.Options{
		Database:       readyDatabase(),
		AuthMiddleware: authenticatedMiddleware,
		Rules:          stub,
	})
}

type RuleStoreForTest = httpapi.RuleStore

func TestListRulesReturnsData(t *testing.T) {
	t.Parallel()
	router := newRulesRouter(&stubRuleStore{listResult: []store.Rule{
		{ID: "rule-1", UserID: "user-1", Field: "merchant", Operator: "contains", Value: "Uber", CategoryID: "cat-1", IsActive: true, Priority: 1},
	}})

	rec := doRequest(router, http.MethodGet, "/v1/rules", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body struct {
		Data []store.Rule `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if len(body.Data) != 1 || body.Data[0].ID != "rule-1" {
		t.Fatalf("data = %+v, want [rule-1]", body.Data)
	}
}

func TestListRulesReportsInternalError(t *testing.T) {
	t.Parallel()
	rec := doRequest(newRulesRouter(&stubRuleStore{listErr: errors.New("connection lost")}), http.MethodGet, "/v1/rules", "")
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
}

func TestCreateRulePersistsAndReturnsCreated(t *testing.T) {
	t.Parallel()
	stub := &stubRuleStore{createResult: store.Rule{ID: "rule-new", Field: "merchant", Operator: "contains", Value: "Uber", CategoryID: "cat-1", IsActive: true, Priority: 1}}
	router := newRulesRouter(stub)

	rec := doRequest(router, http.MethodPost, "/v1/rules", `{"field":"merchant","operator":"contains","value":"Uber","categoryId":"cat-1","isActive":true}`)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rec.Code, rec.Body.String())
	}
	if stub.createInput.Field != "merchant" || stub.createInput.Operator != "contains" || stub.createInput.CategoryID != "cat-1" || !stub.createInput.IsActive {
		t.Fatalf("captured input = %+v", stub.createInput)
	}
}

func TestCreateRuleRejectsInvalidPayload(t *testing.T) {
	t.Parallel()
	router := newRulesRouter(&stubRuleStore{})
	cases := []struct {
		name string
		body string
	}{
		{"malformed json", `{"field":`},
		{"invalid field", `{"field":"memo","operator":"contains","value":"Uber","categoryId":"cat-1"}`},
		{"invalid operator", `{"field":"merchant","operator":"equals","value":"Uber","categoryId":"cat-1"}`},
		{"blank value", `{"field":"merchant","operator":"contains","value":"   ","categoryId":"cat-1"}`},
		{"missing category", `{"field":"merchant","operator":"contains","value":"Uber"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := doRequest(router, http.MethodPost, "/v1/rules", tc.body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 for %s", rec.Code, tc.name)
			}
		})
	}
}

func TestToggleRuleReturnsUpdatedRule(t *testing.T) {
	t.Parallel()
	stub := &stubRuleStore{toggleResult: store.Rule{ID: "rule-1", IsActive: false}}
	rec := doRequest(newRulesRouter(stub), http.MethodPost, "/v1/rules/rule-1/toggle", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if stub.toggleID != "rule-1" {
		t.Fatalf("captured id = %q, want rule-1", stub.toggleID)
	}
	var body store.Rule
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.IsActive {
		t.Fatalf("toggled body = %+v, want inactive", body)
	}
}

func TestToggleRuleReportsNotFound(t *testing.T) {
	t.Parallel()
	rec := doRequest(newRulesRouter(&stubRuleStore{toggleErr: store.ErrNotFound}), http.MethodPost, "/v1/rules/missing/toggle", "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestDeleteRuleReturnsNoContent(t *testing.T) {
	t.Parallel()
	stub := &stubRuleStore{}
	rec := doRequest(newRulesRouter(stub), http.MethodDelete, "/v1/rules/rule-1", "")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	if stub.deleteID != "rule-1" {
		t.Fatalf("captured id = %q, want rule-1", stub.deleteID)
	}
}

func TestDeleteRuleReportsNotFound(t *testing.T) {
	t.Parallel()
	rec := doRequest(newRulesRouter(&stubRuleStore{deleteErr: store.ErrNotFound}), http.MethodDelete, "/v1/rules/missing", "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}
