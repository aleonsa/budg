package httpapi_test

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/aleonsa/budg/backend/internal/httpapi"
	"github.com/aleonsa/budg/backend/internal/store"
)

type stubRecurringStore struct {
	createInput   store.RecurringTransactionInput
	createResult  store.RecurringTransaction
	updateID      string
	updateInput   store.RecurringTransactionUpdateInput
	updateResult  store.RecurringTransaction
	updateErr     error
	deleteID      string
	deleteErr     error
	processResult int
}

const (
	recurringID        = "11111111-1111-1111-1111-111111111111"
	missingRecurringID = "22222222-2222-2222-2222-222222222222"
)

func (s *stubRecurringStore) List(context.Context, string) ([]store.RecurringTransaction, error) {
	return nil, nil
}
func (s *stubRecurringStore) Create(_ context.Context, _ string, in store.RecurringTransactionInput) (store.RecurringTransaction, error) {
	s.createInput = in
	return s.createResult, nil
}
func (s *stubRecurringStore) Update(_ context.Context, _ string, id string, in store.RecurringTransactionUpdateInput) (store.RecurringTransaction, error) {
	s.updateID = id
	s.updateInput = in
	return s.updateResult, s.updateErr
}
func (s *stubRecurringStore) Delete(_ context.Context, _ string, id string) error {
	s.deleteID = id
	return s.deleteErr
}
func (s *stubRecurringStore) Process(context.Context, string) (int, error) {
	return s.processResult, nil
}

func newRecurringRouter(stub *stubRecurringStore) http.Handler {
	return httpapi.NewRouter(httpapi.Options{
		Database:              readyDatabase(),
		AuthMiddleware:        authenticatedMiddleware,
		RecurringTransactions: stub,
	})
}

func TestCreateRecurringTransaction(t *testing.T) {
	stub := &stubRecurringStore{createResult: store.RecurringTransaction{ID: "recurring-1"}}
	rec := doRequest(newRecurringRouter(stub), http.MethodPost, "/v1/recurring-transactions", `{
		"accountId":"acct-1", "categoryId":"cat-1", "description":"Netflix",
		"merchant":"Netflix", "amount":21900, "frequency":"monthly", "startDate":"2026-08-07"
	}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rec.Code, rec.Body.String())
	}
	if stub.createInput.Description != "Netflix" || stub.createInput.Amount != 21900 || stub.createInput.Frequency != "monthly" {
		t.Fatalf("captured input = %+v", stub.createInput)
	}
}

func TestCreateRecurringTransactionRejectsInvalidInput(t *testing.T) {
	router := newRecurringRouter(&stubRecurringStore{})
	for _, body := range []string{
		`{"accountId":"acct-1","description":"Netflix","amount":21900,"frequency":"weekly","startDate":"2026-08-07"}`,
		`{"accountId":"acct-1","description":" ","amount":21900,"frequency":"monthly","startDate":"2026-08-07"}`,
		`{"accountId":"acct-1","description":"Netflix","amount":0,"frequency":"monthly","startDate":"2026-08-07"}`,
		`{"accountId":"acct-1","description":"Netflix","amount":21900,"frequency":"monthly","startDate":"2026-02-31"}`,
	} {
		rec := doRequest(router, http.MethodPost, "/v1/recurring-transactions", body)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400 for %s", rec.Code, body)
		}
	}
}

func TestUpdateRecurringTransaction(t *testing.T) {
	stub := &stubRecurringStore{updateResult: store.RecurringTransaction{ID: recurringID, Description: "Netflix Premium"}}
	rec := doRequest(newRecurringRouter(stub), http.MethodPut, "/v1/recurring-transactions/"+recurringID, `{
		"accountId":"acct-2", "categoryId":null, "description":"Netflix Premium",
		"amount":29900, "frequency":"yearly", "startDate":"2026-09-01", "isActive":false
	}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if stub.updateID != recurringID || stub.updateInput.Description != "Netflix Premium" || stub.updateInput.IsActive == nil || *stub.updateInput.IsActive {
		t.Fatalf("captured update = id %q input %+v", stub.updateID, stub.updateInput)
	}
}

func TestUpdateRecurringTransactionRejectsInvalidInput(t *testing.T) {
	rec := doRequest(newRecurringRouter(&stubRecurringStore{}), http.MethodPut, "/v1/recurring-transactions/"+recurringID, `{
		"accountId":"acct-1", "description":"Netflix", "amount":0,
		"frequency":"monthly", "startDate":"2026-09-01", "isActive":true
	}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestUpdateRecurringTransactionRequiresExplicitStatus(t *testing.T) {
	router := newRecurringRouter(&stubRecurringStore{})
	for _, body := range []string{
		`{"accountId":"acct-1","description":"Netflix","amount":21900,"frequency":"monthly","startDate":"2026-09-01"}`,
		`{"accountId":"acct-1","description":"Netflix","amount":21900,"frequency":"monthly","startDate":"2026-09-01","isActive":null}`,
	} {
		rec := doRequest(router, http.MethodPut, "/v1/recurring-transactions/"+recurringID, body)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400 for %s", rec.Code, body)
		}
	}
}

func TestUpdateRecurringTransactionReportsNotFound(t *testing.T) {
	rec := doRequest(newRecurringRouter(&stubRecurringStore{updateErr: store.ErrNotFound}), http.MethodPut, "/v1/recurring-transactions/"+missingRecurringID, `{
		"accountId":"acct-1", "description":"Netflix", "amount":21900,
		"frequency":"monthly", "startDate":"2026-09-01", "isActive":true
	}`)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestDeleteRecurringTransaction(t *testing.T) {
	stub := &stubRecurringStore{}
	rec := doRequest(newRecurringRouter(stub), http.MethodDelete, "/v1/recurring-transactions/"+recurringID, "")
	if rec.Code != http.StatusNoContent || stub.deleteID != recurringID {
		t.Fatalf("response = %d id %q, want 204 %s", rec.Code, stub.deleteID, recurringID)
	}
}

func TestDeleteRecurringTransactionReportsNotFound(t *testing.T) {
	stub := &stubRecurringStore{deleteErr: errors.Join(errors.New("wrapped"), store.ErrNotFound)}
	rec := doRequest(newRecurringRouter(stub), http.MethodDelete, "/v1/recurring-transactions/"+missingRecurringID, "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestRecurringTransactionMutationsRejectMalformedID(t *testing.T) {
	router := newRecurringRouter(&stubRecurringStore{})
	update := doRequest(router, http.MethodPut, "/v1/recurring-transactions/not-a-uuid", `{}`)
	if update.Code != http.StatusBadRequest {
		t.Fatalf("update status = %d, want 400", update.Code)
	}
	deleted := doRequest(router, http.MethodDelete, "/v1/recurring-transactions/not-a-uuid", "")
	if deleted.Code != http.StatusBadRequest {
		t.Fatalf("delete status = %d, want 400", deleted.Code)
	}
}

func TestProcessRecurringTransactions(t *testing.T) {
	rec := doRequest(newRecurringRouter(&stubRecurringStore{processResult: 2}), http.MethodPost, "/v1/recurring-transactions/process", "")
	if rec.Code != http.StatusOK || rec.Body.String() != "{\"created\":2}\n" {
		t.Fatalf("response = %d %s", rec.Code, rec.Body.String())
	}
}
