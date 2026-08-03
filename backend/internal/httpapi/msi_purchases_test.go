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

type stubMSIPurchaseStore struct {
	listErr      error
	createErr    error
	updateErr    error
	deleteErr    error
	listResult   []store.MSIPurchase
	createInput  store.MSIPurchaseInput
	createResult store.MSIPurchase
	updateID     string
	updateInput  store.MSIPurchaseInput
	updateResult store.MSIPurchase
	deleteID     string
}

func (s *stubMSIPurchaseStore) List(_ context.Context, _ string) ([]store.MSIPurchase, error) {
	return s.listResult, s.listErr
}

func (s *stubMSIPurchaseStore) Create(_ context.Context, _ string, in store.MSIPurchaseInput) (store.MSIPurchase, error) {
	s.createInput = in
	return s.createResult, s.createErr
}

func (s *stubMSIPurchaseStore) Update(_ context.Context, _ string, id string, in store.MSIPurchaseInput) (store.MSIPurchase, error) {
	s.updateID = id
	s.updateInput = in
	return s.updateResult, s.updateErr
}

func (s *stubMSIPurchaseStore) Delete(_ context.Context, _ string, id string) error {
	s.deleteID = id
	return s.deleteErr
}

func newMSIPurchasesRouter(stub MSIPurchaseStoreForTest) http.Handler {
	return httpapi.NewRouter(httpapi.Options{
		Database:       readyDatabase(),
		AuthMiddleware: authenticatedMiddleware,
		MSIPurchases:   stub,
	})
}

type MSIPurchaseStoreForTest = httpapi.MSIPurchaseStore

func TestListMSIPurchasesReturnsData(t *testing.T) {
	t.Parallel()
	stub := &stubMSIPurchaseStore{
		listResult: []store.MSIPurchase{
			{
				ID:                "msi-1",
				UserID:            "user-1",
				AccountID:         "acct-1",
				Description:       "Laptop",
				TotalAmount:       120000,
				InstallmentAmount: 10000,
				InstallmentCount:  12,
				InstallmentsPaid:  3,
				StartDate:         "2026-01-01",
				Status:            "active",
			},
		},
	}
	router := newMSIPurchasesRouter(stub)

	rec := doRequest(router, http.MethodGet, "/v1/msi-purchases", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body struct {
		Data []store.MSIPurchase `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if len(body.Data) != 1 || body.Data[0].ID != "msi-1" {
		t.Fatalf("data = %+v, want [msi-1]", body.Data)
	}
}

func TestListMSIPurchasesReportsInternalError(t *testing.T) {
	t.Parallel()
	stub := &stubMSIPurchaseStore{listErr: errors.New("connection lost")}
	router := newMSIPurchasesRouter(stub)

	rec := doRequest(router, http.MethodGet, "/v1/msi-purchases", "")

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
}

func TestListMSIPurchasesRequiresAuth(t *testing.T) {
	t.Parallel()
	stub := &stubMSIPurchaseStore{}
	router := httpapi.NewRouter(httpapi.Options{
		Database:     readyDatabase(),
		MSIPurchases: stub,
	})

	rec := doRequest(router, http.MethodGet, "/v1/msi-purchases", "")

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestCreateMSIPurchaseCreatesInstallmentSchedule(t *testing.T) {
	t.Parallel()
	stub := &stubMSIPurchaseStore{createResult: store.MSIPurchase{
		ID:                "msi-new",
		AccountID:         "acct-1",
		Description:       "Laptop",
		TotalAmount:       120000,
		InstallmentAmount: 10000,
		InstallmentCount:  12,
		StartDate:         "2026-08-15",
		Status:            "active",
	}}

	req := httptest.NewRequest(http.MethodPost, "/v1/msi-purchases", strings.NewReader(`{
		"accountId":"acct-1",
		"categoryId":"cat-1",
		"description":"Laptop",
		"merchant":"Apple",
		"totalAmount":120000,
		"installmentCount":12,
		"startDate":"2026-08-15"
	}`))
	req.Header.Set("Idempotency-Key", "msi-attempt-1")
	rec := httptest.NewRecorder()
	newMSIPurchasesRouter(stub).ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rec.Code, rec.Body.String())
	}
	if stub.createInput.AccountID != "acct-1" || stub.createInput.CategoryID == nil || *stub.createInput.CategoryID != "cat-1" || stub.createInput.InstallmentCount != 12 {
		t.Fatalf("captured input = %+v", stub.createInput)
	}
	if stub.createInput.IdempotencyKey == nil || *stub.createInput.IdempotencyKey != "msi-attempt-1" {
		t.Fatalf("captured idempotency key = %+v", stub.createInput.IdempotencyKey)
	}
}

func TestCreateMSIPurchaseRejectsInvalidPayload(t *testing.T) {
	t.Parallel()
	router := newMSIPurchasesRouter(&stubMSIPurchaseStore{})
	cases := []struct {
		name string
		body string
	}{
		{"malformed json", `{"accountId":`},
		{"missing account", `{"description":"Laptop","totalAmount":120000,"installmentCount":12,"startDate":"2026-08-15"}`},
		{"blank description", `{"accountId":"acct-1","description":"  ","totalAmount":120000,"installmentCount":12,"startDate":"2026-08-15"}`},
		{"zero amount", `{"accountId":"acct-1","description":"Laptop","totalAmount":0,"installmentCount":12,"startDate":"2026-08-15"}`},
		{"single installment", `{"accountId":"acct-1","description":"Laptop","totalAmount":120000,"installmentCount":1,"startDate":"2026-08-15"}`},
		{"invalid date", `{"accountId":"acct-1","description":"Laptop","totalAmount":120000,"installmentCount":12,"startDate":"15/08/2026"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := doRequest(router, http.MethodPost, "/v1/msi-purchases", tc.body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 for %s", rec.Code, tc.name)
			}
		})
	}
}

func TestCreateMSIPurchaseReportsInternalError(t *testing.T) {
	t.Parallel()
	stub := &stubMSIPurchaseStore{createErr: errors.New("connection lost")}
	rec := doRequest(newMSIPurchasesRouter(stub), http.MethodPost, "/v1/msi-purchases", `{
		"accountId":"acct-1",
		"description":"Laptop",
		"totalAmount":120000,
		"installmentCount":12,
		"startDate":"2026-08-15"
	}`)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
}

func TestCreateMSIPurchaseRejectsNonCreditAccount(t *testing.T) {
	t.Parallel()
	stub := &stubMSIPurchaseStore{createErr: store.ErrMSIRequiresCreditAccount}
	rec := doRequest(newMSIPurchasesRouter(stub), http.MethodPost, "/v1/msi-purchases", `{
		"accountId":"debit-1",
		"description":"Laptop",
		"totalAmount":120000,
		"installmentCount":12,
		"startDate":"2026-08-15"
	}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestCreateMSIPurchaseRequiresBalanceTracking(t *testing.T) {
	t.Parallel()
	stub := &stubMSIPurchaseStore{createErr: store.ErrBalanceTrackingNotEnabled}
	rec := doRequest(newMSIPurchasesRouter(stub), http.MethodPost, "/v1/msi-purchases", `{
		"accountId":"credit-1",
		"description":"Laptop",
		"totalAmount":120000,
		"installmentCount":12,
		"startDate":"2026-08-15"
	}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", rec.Code)
	}
}

func TestUpdateMSIPurchaseReplacesSchedule(t *testing.T) {
	t.Parallel()
	stub := &stubMSIPurchaseStore{updateResult: store.MSIPurchase{ID: "msi-1", Description: "Laptop Pro"}}
	rec := doRequest(newMSIPurchasesRouter(stub), http.MethodPut, "/v1/msi-purchases/msi-1", `{
		"accountId":"acct-1",
		"categoryId":"cat-1",
		"description":"Laptop Pro",
		"totalAmount":180000,
		"installmentCount":18,
		"startDate":"2026-09-15"
	}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if stub.updateID != "msi-1" || stub.updateInput.TotalAmount != 180000 || stub.updateInput.InstallmentCount != 18 {
		t.Fatalf("captured update = id %q input %+v", stub.updateID, stub.updateInput)
	}
}

func TestUpdateMSIPurchaseReturnsNotFound(t *testing.T) {
	t.Parallel()
	stub := &stubMSIPurchaseStore{updateErr: store.ErrNotFound}
	rec := doRequest(newMSIPurchasesRouter(stub), http.MethodPut, "/v1/msi-purchases/missing", `{
		"accountId":"acct-1",
		"description":"Laptop",
		"totalAmount":120000,
		"installmentCount":12,
		"startDate":"2026-08-15"
	}`)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestDeleteMSIPurchaseDeletesSchedule(t *testing.T) {
	t.Parallel()
	stub := &stubMSIPurchaseStore{}
	rec := doRequest(newMSIPurchasesRouter(stub), http.MethodDelete, "/v1/msi-purchases/msi-1", "")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	if stub.deleteID != "msi-1" {
		t.Fatalf("delete id = %q, want msi-1", stub.deleteID)
	}
}

func TestDeleteMSIPurchaseReturnsNotFound(t *testing.T) {
	t.Parallel()
	stub := &stubMSIPurchaseStore{deleteErr: store.ErrNotFound}
	rec := doRequest(newMSIPurchasesRouter(stub), http.MethodDelete, "/v1/msi-purchases/missing", "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}
