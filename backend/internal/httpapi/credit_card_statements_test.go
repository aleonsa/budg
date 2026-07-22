package httpapi_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/aleonsa/budg/backend/internal/httpapi"
	"github.com/aleonsa/budg/backend/internal/store"
)

type stubCreditCardStatementStore struct {
	listResult    []store.CreditCardStatement
	listErr       error
	confirmResult store.CreditCardStatement
	confirmErr    error
	listAccountID string
	confirmID     string
	confirmInput  store.CreditCardStatementInput
}

func (s *stubCreditCardStatementStore) List(_ context.Context, _, accountID string) ([]store.CreditCardStatement, error) {
	s.listAccountID = accountID
	return s.listResult, s.listErr
}

func (s *stubCreditCardStatementStore) Confirm(_ context.Context, _, accountID string, input store.CreditCardStatementInput) (store.CreditCardStatement, error) {
	s.confirmID = accountID
	s.confirmInput = input
	return s.confirmResult, s.confirmErr
}

func newCreditCardStatementsRouter(stub httpapi.CreditCardStatementStore) http.Handler {
	return httpapi.NewRouter(httpapi.Options{
		Database:             readyDatabase(),
		AuthMiddleware:       authenticatedMiddleware,
		CreditCardStatements: stub,
	})
}

func TestAccountAndCreditCardStatementRoutesMountTogether(t *testing.T) {
	t.Parallel()
	router := httpapi.NewRouter(httpapi.Options{
		Database:             readyDatabase(),
		AuthMiddleware:       authenticatedMiddleware,
		Accounts:             &stubAccountStore{},
		CreditCardStatements: &stubCreditCardStatementStore{},
	})
	rec := doRequest(router, http.MethodGet, "/v1/accounts/account-1/credit-card-statements", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
}

func TestListCreditCardStatementsReturnsAccountData(t *testing.T) {
	t.Parallel()
	stub := &stubCreditCardStatementStore{listResult: []store.CreditCardStatement{{
		ID: "statement-1", AccountID: "account-1", StatementBalanceCents: 15000,
		PaidAmountCents: 5000, Status: "partial", ConfirmedAt: time.Now(),
	}}}
	rec := doRequest(newCreditCardStatementsRouter(stub), http.MethodGet, "/v1/accounts/account-1/credit-card-statements", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if stub.listAccountID != "account-1" {
		t.Fatalf("account id = %q, want account-1", stub.listAccountID)
	}
	var response struct {
		Data []store.CreditCardStatement `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(response.Data) != 1 || response.Data[0].Status != "partial" || response.Data[0].PaidAmountCents != 5000 {
		t.Fatalf("response data = %+v", response.Data)
	}
}

func TestConfirmCreditCardStatementAcceptsZeroBalance(t *testing.T) {
	t.Parallel()
	minimum := int64(0)
	stub := &stubCreditCardStatementStore{confirmResult: store.CreditCardStatement{ID: "statement-1", Status: "paid"}}
	body := `{"cycleStartDate":"2026-06-12","cycleEndDate":"2026-07-11","paymentDueDate":"2026-07-28","statementBalance":0,"minimumPayment":0}`
	rec := doRequest(newCreditCardStatementsRouter(stub), http.MethodPost, "/v1/accounts/account-1/credit-card-statements", body)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if stub.confirmID != "account-1" || stub.confirmInput.StatementBalanceCents != 0 ||
		stub.confirmInput.MinimumPaymentCents == nil || *stub.confirmInput.MinimumPaymentCents != minimum {
		t.Fatalf("captured confirmation = (%q, %+v)", stub.confirmID, stub.confirmInput)
	}
}

func TestConfirmCreditCardStatementRejectsInvalidBody(t *testing.T) {
	t.Parallel()
	cases := []string{
		`{"cycleStartDate":`,
		`{"cycleStartDate":"2026-06-12","cycleEndDate":"2026-07-11","paymentDueDate":"2026-07-28"}`,
	}
	for _, body := range cases {
		rec := doRequest(newCreditCardStatementsRouter(&stubCreditCardStatementStore{}), http.MethodPost, "/v1/accounts/account-1/credit-card-statements", body)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400 (body=%s)", rec.Code, rec.Body.String())
		}
	}
}

func TestCreditCardStatementStoreErrorsMapToContract(t *testing.T) {
	t.Parallel()
	body := `{"cycleStartDate":"2026-06-12","cycleEndDate":"2026-07-11","paymentDueDate":"2026-07-28","statementBalance":100}`
	cases := []struct {
		name       string
		err        error
		wantStatus int
	}{
		{name: "missing account", err: store.ErrNotFound, wantStatus: http.StatusNotFound},
		{name: "non-credit account", err: store.ErrInvalidAccountShape, wantStatus: http.StatusBadRequest},
		{name: "invalid statement", err: store.ErrInvalidCreditCardStatement, wantStatus: http.StatusBadRequest},
		{name: "internal", err: errors.New("database unavailable"), wantStatus: http.StatusInternalServerError},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			stub := &stubCreditCardStatementStore{confirmErr: tc.err}
			rec := doRequest(newCreditCardStatementsRouter(stub), http.MethodPost, "/v1/accounts/account-1/credit-card-statements", body)
			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d (body=%s)", rec.Code, tc.wantStatus, rec.Body.String())
			}
		})
	}
}
