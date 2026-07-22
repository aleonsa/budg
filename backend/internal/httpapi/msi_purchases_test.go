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

type stubMSIPurchaseStore struct {
	listErr      error
	createErr    error
	listResult   []store.MSIPurchase
	createInput  store.MSIPurchaseInput
	createResult store.MSIPurchase
}

func (s *stubMSIPurchaseStore) List(_ context.Context, _ string) ([]store.MSIPurchase, error) {
	return s.listResult, s.listErr
}

func (s *stubMSIPurchaseStore) Create(_ context.Context, _ string, in store.MSIPurchaseInput) (store.MSIPurchase, error) {
	s.createInput = in
	return s.createResult, s.createErr
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

	rec := doRequest(newMSIPurchasesRouter(stub), http.MethodPost, "/v1/msi-purchases", `{
		"accountId":"acct-1",
		"categoryId":"cat-1",
		"description":"Laptop",
		"merchant":"Apple",
		"totalAmount":120000,
		"installmentCount":12,
		"startDate":"2026-08-15"
	}`)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rec.Code, rec.Body.String())
	}
	if stub.createInput.AccountID != "acct-1" || stub.createInput.CategoryID == nil || *stub.createInput.CategoryID != "cat-1" || stub.createInput.InstallmentCount != 12 {
		t.Fatalf("captured input = %+v", stub.createInput)
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
