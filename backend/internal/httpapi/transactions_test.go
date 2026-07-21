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

type stubTransactionStore struct {
	listErr      error
	createErr    error
	updateErr    error
	deleteErr    error
	listResult   []store.Transaction
	createInput  store.TransactionInput
	updateID     string
	updatePatch  store.TransactionPatch
	deleteID     string
	createResult store.Transaction
	updateResult store.Transaction
}

func (s *stubTransactionStore) List(_ context.Context, _ string) ([]store.Transaction, error) {
	return s.listResult, s.listErr
}

func (s *stubTransactionStore) Create(_ context.Context, _ string, in store.TransactionInput) (store.Transaction, error) {
	s.createInput = in
	return s.createResult, s.createErr
}

func (s *stubTransactionStore) Update(_ context.Context, _, id string, patch store.TransactionPatch) (store.Transaction, error) {
	s.updateID = id
	s.updatePatch = patch
	return s.updateResult, s.updateErr
}

func (s *stubTransactionStore) Delete(_ context.Context, _, id string) error {
	s.deleteID = id
	return s.deleteErr
}

func newTransactionsRouter(stub TransactionStoreForTest) http.Handler {
	return httpapi.NewRouter(httpapi.Options{
		Database:       readyDatabase(),
		AuthMiddleware: authenticatedMiddleware,
		Transactions:   stub,
	})
}

type TransactionStoreForTest = httpapi.TransactionStore

func TestListTransactionsReturnsData(t *testing.T) {
	t.Parallel()
	stub := &stubTransactionStore{
		listResult: []store.Transaction{
			{ID: "tx-1", UserID: "user-1", AccountID: "acc-1", Type: "expense", Amount: 1500, Date: "2026-07-20", Description: "Coffee", IsReconciled: true},
		},
	}
	router := newTransactionsRouter(stub)

	rec := doRequest(router, http.MethodGet, "/v1/transactions", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body struct {
		Data []store.Transaction `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if len(body.Data) != 1 || body.Data[0].ID != "tx-1" {
		t.Fatalf("data = %+v, want [tx-1]", body.Data)
	}
}

func TestListTransactionsReportsInternalError(t *testing.T) {
	t.Parallel()
	stub := &stubTransactionStore{listErr: errors.New("connection lost")}
	router := newTransactionsRouter(stub)

	rec := doRequest(router, http.MethodGet, "/v1/transactions", "")

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
}

func TestCreateTransactionPersistsAndReturnsCreated(t *testing.T) {
	t.Parallel()
	stub := &stubTransactionStore{
		createResult: store.Transaction{
			ID: "tx-new", UserID: "user-1", AccountID: "acc-1", Type: "expense",
			Amount: 1500, Date: "2026-07-20", Description: "Coffee", IsReconciled: false,
		},
	}
	router := newTransactionsRouter(stub)

	body := `{"accountId":"acc-1","type":"expense","amount":1500,"date":"2026-07-20","description":"Coffee"}`
	rec := doRequest(router, http.MethodPost, "/v1/transactions", body)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rec.Code, rec.Body.String())
	}
	if stub.createInput.Description != "Coffee" || stub.createInput.Amount != 1500 {
		t.Fatalf("captured input = %+v", stub.createInput)
	}
}

func TestCreateTransactionRejectsInvalidPayload(t *testing.T) {
	t.Parallel()
	stub := &stubTransactionStore{}
	router := newTransactionsRouter(stub)

	cases := []struct {
		name string
		body string
	}{
		{"malformed json", `{"accountId":`},
		{"missing accountId", `{"type":"expense","amount":100,"date":"2026-07-20","description":"X"}`},
		{"bad type", `{"accountId":"acc-1","type":"foo","amount":100,"date":"2026-07-20","description":"X"}`},
		{"zero amount", `{"accountId":"acc-1","type":"expense","amount":0,"date":"2026-07-20","description":"X"}`},
		{"negative amount", `{"accountId":"acc-1","type":"expense","amount":-50,"date":"2026-07-20","description":"X"}`},
		{"bad date format", `{"accountId":"acc-1","type":"expense","amount":100,"date":"20.07.2026","description":"X"}`},
		{"transfer missing target", `{"accountId":"acc-1","type":"transfer","amount":100,"date":"2026-07-20","description":"X"}`},
		{"transfer to self", `{"accountId":"acc-1","type":"transfer","amount":100,"date":"2026-07-20","description":"X","transferToAccountId":"acc-1"}`},
		{"transfer with category", `{"accountId":"acc-1","type":"transfer","amount":100,"date":"2026-07-20","description":"X","transferToAccountId":"acc-2","categoryId":"cat-1"}`},
		{"expense with transferToAccount", `{"accountId":"acc-1","type":"expense","amount":100,"date":"2026-07-20","description":"X","transferToAccountId":"acc-2"}`},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			rec := doRequest(router, http.MethodPost, "/v1/transactions", tc.body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 for %s (body=%s)", rec.Code, tc.name, rec.Body.String())
			}
		})
	}
}

func TestUpdateTransactionAppliesPatchAndReturnsUpdated(t *testing.T) {
	t.Parallel()
	stub := &stubTransactionStore{
		updateResult: store.Transaction{ID: "tx-1", Description: "Updated Coffee"},
	}
	router := newTransactionsRouter(stub)

	body := `{"description":"Updated Coffee","isReconciled":true}`
	rec := doRequest(router, http.MethodPatch, "/v1/transactions/tx-1", body)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if stub.updateID != "tx-1" {
		t.Fatalf("captured id = %q, want tx-1", stub.updateID)
	}
	if stub.updatePatch.Description == nil || *stub.updatePatch.Description != "Updated Coffee" {
		t.Fatalf("captured description patch = %+v", stub.updatePatch.Description)
	}
	if stub.updatePatch.IsReconciled == nil || *stub.updatePatch.IsReconciled != true {
		t.Fatalf("captured isReconciled patch = %+v", stub.updatePatch.IsReconciled)
	}
}

func TestUpdateTransactionReportsNotFound(t *testing.T) {
	t.Parallel()
	stub := &stubTransactionStore{updateErr: store.ErrNotFound}
	router := newTransactionsRouter(stub)

	rec := doRequest(router, http.MethodPatch, "/v1/transactions/missing", `{"description":"X"}`)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestDeleteTransactionReturnsNoContent(t *testing.T) {
	t.Parallel()
	stub := &stubTransactionStore{}
	router := newTransactionsRouter(stub)

	rec := doRequest(router, http.MethodDelete, "/v1/transactions/tx-1", "")

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	if stub.deleteID != "tx-1" {
		t.Fatalf("captured id = %q, want tx-1", stub.deleteID)
	}
}

func TestDeleteTransactionReportsNotFound(t *testing.T) {
	t.Parallel()
	stub := &stubTransactionStore{deleteErr: store.ErrNotFound}
	router := newTransactionsRouter(stub)

	rec := doRequest(router, http.MethodDelete, "/v1/transactions/missing", "")

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestTransactionsRejectUnauthenticatedRequests(t *testing.T) {
	t.Parallel()
	stub := &stubTransactionStore{}
	router := httpapi.NewRouter(httpapi.Options{
		Database:     readyDatabase(),
		Transactions: stub,
	})

	rec := doRequest(router, http.MethodGet, "/v1/transactions", "")

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}
