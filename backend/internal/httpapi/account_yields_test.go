package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/aleonsa/budg/backend/internal/httpapi"
	"github.com/aleonsa/budg/backend/internal/store"
)

type stubYieldStore struct {
	listResult      []store.YieldReconciliation
	reconcileErr    error
	reconcileID     string
	reconcileInput  store.YieldReconciliationInput
	reconcileResult store.YieldReconciliationResult
	undoErr         error
	undoAccountID   string
	undoID          string
}

func (s *stubYieldStore) List(context.Context, string) ([]store.YieldReconciliation, error) {
	return s.listResult, nil
}

func (s *stubYieldStore) Reconcile(_ context.Context, _, accountID string, in store.YieldReconciliationInput) (store.YieldReconciliationResult, error) {
	s.reconcileID = accountID
	s.reconcileInput = in
	return s.reconcileResult, s.reconcileErr
}

func (s *stubYieldStore) Undo(_ context.Context, _, accountID, id string) (store.Account, error) {
	s.undoAccountID, s.undoID = accountID, id
	return store.Account{ID: accountID}, s.undoErr
}

func newYieldRouter(stub *stubYieldStore) http.Handler {
	return httpapi.NewRouter(httpapi.Options{
		Database:       readyDatabase(),
		AuthMiddleware: authenticatedMiddleware,
		AccountYields:  stub,
	})
}

func TestYieldReconciliationPassesInputAndIdempotencyKey(t *testing.T) {
	t.Parallel()
	stub := &stubYieldStore{reconcileResult: store.YieldReconciliationResult{
		Reconciliation: store.YieldReconciliation{ID: "rec-1", YieldCents: 1000},
	}}
	req := httptest.NewRequest(http.MethodPost, "/v1/accounts/11111111-2222-3333-4444-555555555555/yield-reconciliations",
		strings.NewReader(`{"currentBalance":101500,"yieldAmount":1000,"categoryId":"cccccccc-1111-1111-1111-111111111111","date":"2026-10-02"}`))
	req.Header.Set("Idempotency-Key", "key-1")
	rec := httptest.NewRecorder()
	newYieldRouter(stub).ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d body = %s", rec.Code, rec.Body.String())
	}
	in := stub.reconcileInput
	if stub.reconcileID != "11111111-2222-3333-4444-555555555555" || in.CurrentBalanceCents != 101500 || in.YieldCents != 1000 ||
		in.CategoryID == nil || *in.CategoryID != "cccccccc-1111-1111-1111-111111111111" || in.Date != "2026-10-02" ||
		in.IdempotencyKey == nil || *in.IdempotencyKey != "key-1" {
		t.Fatalf("captured = %s %+v", stub.reconcileID, in)
	}
}

func TestYieldReconciliationValidationAndErrors(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		body   string
		err    error
		status int
		code   string
	}{
		{"missing balance", `{"date":"2026-10-02"}`, nil, http.StatusBadRequest, "invalid_request"},
		{"bad date", `{"currentBalance":1,"date":"02/10/2026"}`, nil, http.StatusBadRequest, "invalid_request"},
		{"invalid split", `{"currentBalance":1,"date":"2026-10-02"}`, store.ErrInvalidTransactionShape, http.StatusBadRequest, "invalid_request"},
		{"untracked", `{"currentBalance":1,"date":"2026-10-02"}`, store.ErrBalanceTrackingNotEnabled, http.StatusConflict, "balance_tracking_conflict"},
		{"credit account", `{"currentBalance":1,"date":"2026-10-02"}`, store.ErrInvalidAccountShape, http.StatusBadRequest, "invalid_request"},
		{"missing account", `{"currentBalance":1,"date":"2026-10-02"}`, store.ErrNotFound, http.StatusNotFound, "not_found"},
		{"non-uuid category", `{"currentBalance":1,"date":"2026-10-02","categoryId":"x"}`, nil, http.StatusBadRequest, "invalid_request"},
		{"later movements", `{"currentBalance":1,"date":"2026-10-01"}`, store.ErrYieldDateBeforeMovements, http.StatusConflict, "yield_date_before_movements"},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			stub := &stubYieldStore{reconcileErr: tc.err}
			rec := doRequest(newYieldRouter(stub), http.MethodPost, "/v1/accounts/11111111-2222-3333-4444-555555555555/yield-reconciliations", tc.body)
			assertErrorCode(t, rec, tc.status, tc.code)
		})
	}
}

func TestYieldReconciliationUndoAndList(t *testing.T) {
	t.Parallel()
	stub := &stubYieldStore{listResult: []store.YieldReconciliation{{ID: "rec-1", Allocations: []store.YieldAllocation{}}}}
	router := newYieldRouter(stub)

	rec := doRequest(router, http.MethodDelete, "/v1/accounts/11111111-2222-3333-4444-555555555555/yield-reconciliations/aaaaaaaa-1111-1111-1111-111111111111", "")
	if rec.Code != http.StatusOK || stub.undoAccountID != "11111111-2222-3333-4444-555555555555" || stub.undoID != "aaaaaaaa-1111-1111-1111-111111111111" {
		t.Fatalf("undo status = %d captured = %s/%s", rec.Code, stub.undoAccountID, stub.undoID)
	}

	stub.undoErr = store.ErrYieldReconciliationNotLatest
	assertErrorCode(t, doRequest(router, http.MethodDelete, "/v1/accounts/11111111-2222-3333-4444-555555555555/yield-reconciliations/aaaaaaaa-0000-0000-0000-000000000000", ""),
		http.StatusConflict, "yield_reconciliation_not_latest")

	assertErrorCode(t, doRequest(router, http.MethodDelete, "/v1/accounts/not-a-uuid/yield-reconciliations/x", ""),
		http.StatusNotFound, "not_found")

	list := doRequest(router, http.MethodGet, "/v1/yield-reconciliations", "")
	var body struct {
		Data []store.YieldReconciliation `json:"data"`
	}
	if err := json.Unmarshal(list.Body.Bytes(), &body); err != nil || len(body.Data) != 1 {
		t.Fatalf("list = %s, %v", list.Body.String(), err)
	}
}

func assertErrorCode(t *testing.T, rec *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("status = %d, want %d (body=%s)", rec.Code, status, rec.Body.String())
	}
	var response struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if response.Error.Code != code {
		t.Fatalf("code = %q, want %q", response.Error.Code, code)
	}
}
