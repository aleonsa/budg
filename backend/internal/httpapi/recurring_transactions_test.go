package httpapi_test

import (
	"context"
	"net/http"
	"testing"

	"github.com/aleonsa/budg/backend/internal/httpapi"
	"github.com/aleonsa/budg/backend/internal/store"
)

type stubRecurringStore struct {
	createInput   store.RecurringTransactionInput
	createResult  store.RecurringTransaction
	processResult int
}

func (s *stubRecurringStore) List(context.Context, string) ([]store.RecurringTransaction, error) {
	return nil, nil
}
func (s *stubRecurringStore) Create(_ context.Context, _ string, in store.RecurringTransactionInput) (store.RecurringTransaction, error) {
	s.createInput = in
	return s.createResult, nil
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
	} {
		rec := doRequest(router, http.MethodPost, "/v1/recurring-transactions", body)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400 for %s", rec.Code, body)
		}
	}
}

func TestProcessRecurringTransactions(t *testing.T) {
	rec := doRequest(newRecurringRouter(&stubRecurringStore{processResult: 2}), http.MethodPost, "/v1/recurring-transactions/process", "")
	if rec.Code != http.StatusOK || rec.Body.String() != "{\"created\":2}\n" {
		t.Fatalf("response = %d %s", rec.Code, rec.Body.String())
	}
}
