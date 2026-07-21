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
	listErr    error
	listResult []store.MSIPurchase
}

func (s *stubMSIPurchaseStore) List(_ context.Context, _ string) ([]store.MSIPurchase, error) {
	return s.listResult, s.listErr
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
