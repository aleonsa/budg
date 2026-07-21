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

// stubAccountStore is an in-memory AccountStore for handler tests.
type stubAccountStore struct {
	listErr      error
	createErr    error
	updateErr    error
	deleteErr    error
	listResult   []store.Account
	createInput  store.AccountInput
	updateID     string
	updatePatch  store.AccountPatch
	deleteID     string
	createResult store.Account
	updateResult store.Account
}

func (s *stubAccountStore) List(_ context.Context, _ string) ([]store.Account, error) {
	return s.listResult, s.listErr
}

func (s *stubAccountStore) Create(_ context.Context, _ string, in store.AccountInput) (store.Account, error) {
	s.createInput = in
	return s.createResult, s.createErr
}

func (s *stubAccountStore) Update(_ context.Context, _, id string, patch store.AccountPatch) (store.Account, error) {
	s.updateID = id
	s.updatePatch = patch
	return s.updateResult, s.updateErr
}

func (s *stubAccountStore) Delete(_ context.Context, _, id string) error {
	s.deleteID = id
	return s.deleteErr
}

func newAccountsRouter(stub AccountStoreForTest) http.Handler {
	return httpapi.NewRouter(httpapi.Options{
		Database:       readyDatabase(),
		AuthMiddleware: authenticatedMiddleware,
		Accounts:       stub,
	})
}

// Alias so we don't leak the unexported interface into the public API.
type AccountStoreForTest = httpapi.AccountStore

func TestListAccountsReturnsData(t *testing.T) {
	t.Parallel()
	balance := int64(1845000)
	stub := &stubAccountStore{
		listResult: []store.Account{
			{ID: "acc-1", UserID: "user-1", Name: "Nómina", Type: "debit", Institution: "BBVA", Last4: "4521", Currency: "MXN", BalanceCents: &balance, IsActive: true},
		},
	}
	router := newAccountsRouter(stub)

	rec := doRequest(router, http.MethodGet, "/v1/accounts", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body struct {
		Data []store.Account `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if len(body.Data) != 1 || body.Data[0].ID != "acc-1" {
		t.Fatalf("data = %+v, want [acc-1]", body.Data)
	}
}

func TestListAccountsReportsInternalError(t *testing.T) {
	t.Parallel()
	stub := &stubAccountStore{listErr: errors.New("connection lost")}
	router := newAccountsRouter(stub)

	rec := doRequest(router, http.MethodGet, "/v1/accounts", "")

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
}

func TestCreateAccountPersistsAndReturnsCreated(t *testing.T) {
	t.Parallel()
	stub := &stubAccountStore{
		createResult: store.Account{
			ID: "acc-new", UserID: "user-1", Name: "Nómina", Type: "debit",
			Institution: "BBVA", Last4: "4521", Currency: "MXN", IsActive: true,
		},
	}
	router := newAccountsRouter(stub)

	body := `{"name":"Nómina","type":"debit","institution":"BBVA","last4":"4521","currency":"MXN","balance":1845000}`
	rec := doRequest(router, http.MethodPost, "/v1/accounts", body)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rec.Code, rec.Body.String())
	}
	if stub.createInput.Name != "Nómina" || stub.createInput.Type != "debit" {
		t.Fatalf("captured input = %+v", stub.createInput)
	}
	if stub.createInput.BalanceCents == nil || *stub.createInput.BalanceCents != 1845000 {
		t.Fatalf("captured balance = %+v, want 1845000", stub.createInput.BalanceCents)
	}
	var got store.Account
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if got.ID != "acc-new" {
		t.Fatalf("id = %q, want acc-new", got.ID)
	}
}

func TestCreateAccountRejectsInvalidPayload(t *testing.T) {
	t.Parallel()
	stub := &stubAccountStore{}
	router := newAccountsRouter(stub)

	cases := []struct {
		name string
		body string
	}{
		{"malformed json", `{"name":`},
		{"missing name", `{"type":"debit","institution":"BBVA","last4":"4521","currency":"MXN"}`},
		{"bad type", `{"name":"X","type":"savings","institution":"BBVA","last4":"4521","currency":"MXN"}`},
		{"missing institution", `{"name":"X","type":"debit","last4":"4521","currency":"MXN"}`},
		{"bad last4 letters", `{"name":"X","type":"debit","institution":"BBVA","last4":"45AB","currency":"MXN"}`},
		{"bad last4 length", `{"name":"X","type":"debit","institution":"BBVA","last4":"451","currency":"MXN"}`},
		{"bad currency", `{"name":"X","type":"debit","institution":"BBVA","last4":"4521","currency":"EUR"}`},
		{"debit with credit field", `{"name":"X","type":"debit","institution":"BBVA","last4":"4521","currency":"MXN","creditLimit":1000}`},
		{"credit with balance", `{"name":"X","type":"credit","institution":"BBVA","last4":"4521","currency":"MXN","balance":1000}`},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			rec := doRequest(router, http.MethodPost, "/v1/accounts", tc.body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 for %s (body=%s)", rec.Code, tc.name, rec.Body.String())
			}
		})
	}
}

func TestUpdateAccountAppliesPatchAndReturnsUpdated(t *testing.T) {
	t.Parallel()
	stub := &stubAccountStore{
		updateResult: store.Account{ID: "acc-1", Name: "Renamed"},
	}
	router := newAccountsRouter(stub)

	body := `{"name":"Renamed","isActive":false}`
	rec := doRequest(router, http.MethodPatch, "/v1/accounts/acc-1", body)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if stub.updateID != "acc-1" {
		t.Fatalf("captured id = %q, want acc-1", stub.updateID)
	}
	if stub.updatePatch.Name == nil || *stub.updatePatch.Name != "Renamed" {
		t.Fatalf("captured name patch = %+v", stub.updatePatch.Name)
	}
	if stub.updatePatch.IsActive == nil || *stub.updatePatch.IsActive != false {
		t.Fatalf("captured isActive patch = %+v", stub.updatePatch.IsActive)
	}
}

func TestUpdateAccountClearsNullableFieldExplicitly(t *testing.T) {
	t.Parallel()
	stub := &stubAccountStore{updateResult: store.Account{ID: "acc-1"}}
	router := newAccountsRouter(stub)

	// Explicit null clears statementCutDay; omitted fields stay untouched.
	body := `{"statementCutDay":null}`
	rec := doRequest(router, http.MethodPatch, "/v1/accounts/acc-1", body)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if !stub.updatePatch.StatementCutDay.Set {
		t.Fatal("statementCutDay patch presence not captured, want Set=true for explicit null")
	}
	if stub.updatePatch.StatementCutDay.Value != nil {
		t.Fatalf("statementCutDay value = %v, want nil (explicit clear)", *stub.updatePatch.StatementCutDay.Value)
	}
}

// TestUpdateAccountOmittedFieldLeavesItUnset proves the other half: a body
// that never mentions a nullable field must leave Set false.
func TestUpdateAccountOmittedFieldLeavesItUnset(t *testing.T) {
	t.Parallel()
	stub := &stubAccountStore{updateResult: store.Account{ID: "acc-1"}}
	router := newAccountsRouter(stub)

	rec := doRequest(router, http.MethodPatch, "/v1/accounts/acc-1", `{"name":"Renamed"}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if stub.updatePatch.StatementCutDay.Set {
		t.Fatalf("statementCutDay patch = %+v, want Set=false when omitted", stub.updatePatch.StatementCutDay)
	}
	if stub.updatePatch.BalanceCents.Set {
		t.Fatalf("balance patch = %+v, want Set=false when omitted", stub.updatePatch.BalanceCents)
	}
}

func TestUpdateAccountReportsNotFound(t *testing.T) {
	t.Parallel()
	stub := &stubAccountStore{updateErr: store.ErrNotFound}
	router := newAccountsRouter(stub)

	rec := doRequest(router, http.MethodPatch, "/v1/accounts/missing", `{"name":"X"}`)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestDeleteAccountReturnsNoContent(t *testing.T) {
	t.Parallel()
	stub := &stubAccountStore{}
	router := newAccountsRouter(stub)

	rec := doRequest(router, http.MethodDelete, "/v1/accounts/acc-1", "")

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	if stub.deleteID != "acc-1" {
		t.Fatalf("captured id = %q, want acc-1", stub.deleteID)
	}
}

func TestDeleteAccountReportsNotFound(t *testing.T) {
	t.Parallel()
	stub := &stubAccountStore{deleteErr: store.ErrNotFound}
	router := newAccountsRouter(stub)

	rec := doRequest(router, http.MethodDelete, "/v1/accounts/missing", "")

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestAccountsRejectUnauthenticatedRequests(t *testing.T) {
	t.Parallel()
	stub := &stubAccountStore{}
	// No auth middleware wired.
	router := httpapi.NewRouter(httpapi.Options{
		Database: readyDatabase(),
		Accounts: stub,
	})

	rec := doRequest(router, http.MethodGet, "/v1/accounts", "")

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}
