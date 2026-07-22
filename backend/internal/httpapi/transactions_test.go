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
	if stub.createInput.AffectsBalance != nil {
		t.Fatalf("affectsBalance = %v, want nil when omitted", *stub.createInput.AffectsBalance)
	}
}

func TestCreateTransactionAcceptsExplicitAffectsBalanceFalse(t *testing.T) {
	t.Parallel()
	stub := &stubTransactionStore{createResult: store.Transaction{ID: "tx-new", AffectsBalance: false}}
	body := `{"accountId":"acc-1","type":"expense","amount":1500,"date":"2026-07-20","description":"History","affectsBalance":false}`
	rec := doRequest(newTransactionsRouter(stub), http.MethodPost, "/v1/transactions", body)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rec.Code, rec.Body.String())
	}
	if stub.createInput.AffectsBalance == nil || *stub.createInput.AffectsBalance {
		t.Fatalf("captured affectsBalance = %+v, want false", stub.createInput.AffectsBalance)
	}
	var response store.Transaction
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.AffectsBalance {
		t.Fatal("response affectsBalance = true, want false")
	}
}

func TestCreateTransactionAcceptsCreditCardStatementLink(t *testing.T) {
	t.Parallel()
	stub := &stubTransactionStore{createResult: store.Transaction{ID: "tx-new"}}
	body := `{"accountId":"acc-1","type":"transfer","amount":1500,"date":"2026-07-20","description":"Card payment","transferToAccountId":"card-1","creditCardStatementId":"statement-1"}`
	rec := doRequest(newTransactionsRouter(stub), http.MethodPost, "/v1/transactions", body)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rec.Code, rec.Body.String())
	}
	if stub.createInput.CreditCardStatementID == nil || *stub.createInput.CreditCardStatementID != "statement-1" {
		t.Fatalf("creditCardStatementId = %+v, want statement-1", stub.createInput.CreditCardStatementID)
	}
}

func TestCreateTransactionPassesIdempotencyKeyWithoutExposingIt(t *testing.T) {
	t.Parallel()
	key := "payment-attempt-1"
	stub := &stubTransactionStore{createResult: store.Transaction{ID: "tx-new", IdempotencyKey: &key}}
	body := `{"accountId":"acc-1","type":"expense","amount":1500,"date":"2026-07-20","description":"Payment"}`
	req, err := http.NewRequest(http.MethodPost, "/v1/transactions", strings.NewReader(body))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", key)
	rec := httptest.NewRecorder()
	newTransactionsRouter(stub).ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rec.Code, rec.Body.String())
	}
	if stub.createInput.IdempotencyKey == nil || *stub.createInput.IdempotencyKey != key {
		t.Fatalf("captured idempotency key = %+v, want %q", stub.createInput.IdempotencyKey, key)
	}
	if strings.Contains(rec.Body.String(), "idempotency") || strings.Contains(rec.Body.String(), key) {
		t.Fatalf("response exposed idempotency key: %s", rec.Body.String())
	}
}

func TestCreateTransactionRejectsLongIdempotencyKey(t *testing.T) {
	t.Parallel()
	stub := &stubTransactionStore{}
	body := `{"accountId":"acc-1","type":"expense","amount":1,"date":"2026-07-20","description":"X"}`
	req, err := http.NewRequest(http.MethodPost, "/v1/transactions", strings.NewReader(body))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", strings.Repeat("x", 129))
	rec := httptest.NewRecorder()
	newTransactionsRouter(stub).ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%s)", rec.Code, rec.Body.String())
	}
	if stub.createInput.AccountID != "" {
		t.Fatal("store Create called for invalid idempotency key")
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
		{"expense with statement", `{"accountId":"acc-1","type":"expense","amount":100,"date":"2026-07-20","description":"X","creditCardStatementId":"statement-1"}`},
		{"statement payment without balance effect", `{"accountId":"acc-1","type":"transfer","amount":100,"date":"2026-07-20","description":"X","transferToAccountId":"acc-2","creditCardStatementId":"statement-1","affectsBalance":false}`},
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

	body := `{"description":"Updated Coffee","isReconciled":true,"affectsBalance":false,"creditCardStatementId":"statement-1"}`
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
	if stub.updatePatch.AffectsBalance == nil || *stub.updatePatch.AffectsBalance {
		t.Fatalf("captured affectsBalance patch = %+v, want false", stub.updatePatch.AffectsBalance)
	}
	if !stub.updatePatch.CreditCardStatementID.Set || stub.updatePatch.CreditCardStatementID.Value == nil ||
		*stub.updatePatch.CreditCardStatementID.Value != "statement-1" {
		t.Fatalf("captured creditCardStatementId patch = %+v", stub.updatePatch.CreditCardStatementID)
	}
}

func TestUpdateTransactionCanClearCreditCardStatementLink(t *testing.T) {
	t.Parallel()
	stub := &stubTransactionStore{updateResult: store.Transaction{ID: "tx-1"}}
	rec := doRequest(newTransactionsRouter(stub), http.MethodPatch, "/v1/transactions/tx-1", `{"creditCardStatementId":null}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if !stub.updatePatch.CreditCardStatementID.Set || stub.updatePatch.CreditCardStatementID.Value != nil {
		t.Fatalf("captured creditCardStatementId patch = %+v, want explicit null", stub.updatePatch.CreditCardStatementID)
	}
}

func TestTransactionStoreValidationErrorsReturnBadRequest(t *testing.T) {
	t.Parallel()
	cases := []error{store.ErrInvalidTransactionShape, store.ErrTransferCurrencyMismatch, store.ErrInvalidAccountShape}
	for _, storeErr := range cases {
		storeErr := storeErr
		t.Run(storeErr.Error(), func(t *testing.T) {
			stub := &stubTransactionStore{createErr: storeErr}
			body := `{"accountId":"acc-1","type":"expense","amount":1,"date":"2026-07-20","description":"X"}`
			rec := doRequest(newTransactionsRouter(stub), http.MethodPost, "/v1/transactions", body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%s)", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestUpdateStatementLinkValidationErrorReturnsBadRequest(t *testing.T) {
	t.Parallel()
	stub := &stubTransactionStore{updateErr: store.ErrInvalidTransactionShape}
	rec := doRequest(
		newTransactionsRouter(stub),
		http.MethodPatch,
		"/v1/transactions/tx-1",
		`{"creditCardStatementId":"statement-1"}`,
	)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%s)", rec.Code, rec.Body.String())
	}
}

func TestTransactionIdempotencyConflictReturnsConflict(t *testing.T) {
	t.Parallel()
	stub := &stubTransactionStore{createErr: store.ErrIdempotencyConflict}
	body := `{"accountId":"acc-1","type":"expense","amount":1,"date":"2026-07-20","description":"X"}`
	rec := doRequest(newTransactionsRouter(stub), http.MethodPost, "/v1/transactions", body)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 (body=%s)", rec.Code, rec.Body.String())
	}
}

func TestStatementPaymentTrackingConflictsReturnConflict(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		stub *stubTransactionStore
	}{
		{name: "untracked source", stub: &stubTransactionStore{createErr: store.ErrBalanceTrackingNotEnabled}},
		{name: "untracked destination", stub: &stubTransactionStore{createErr: store.ErrBalanceTrackingNotEnabled}},
		{name: "update link", stub: &stubTransactionStore{updateErr: store.ErrBalanceTrackingNotEnabled}},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			method := http.MethodPost
			path := "/v1/transactions"
			body := `{"accountId":"acc-1","type":"transfer","amount":1,"date":"2026-07-20","description":"Payment","transferToAccountId":"card-1","creditCardStatementId":"statement-1"}`
			if tc.stub.updateErr != nil {
				method = http.MethodPatch
				path = "/v1/transactions/tx-1"
				body = `{"creditCardStatementId":"statement-1"}`
			}
			rec := doRequest(newTransactionsRouter(tc.stub), method, path, body)
			if rec.Code != http.StatusConflict {
				t.Fatalf("status = %d, want 409 (body=%s)", rec.Code, rec.Body.String())
			}
			var response struct {
				Error struct {
					Code string `json:"code"`
				} `json:"error"`
			}
			if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if response.Error.Code != "balance_tracking_conflict" {
				t.Fatalf("error code = %q, want balance_tracking_conflict", response.Error.Code)
			}
		})
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
