package httpapi_test

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/aleonsa/budg/backend/internal/httpapi"
	"github.com/aleonsa/budg/backend/internal/store"
	"net/http"
	"strings"
	"testing"
)

type stubLoans struct {
	httpapi.LoanStore
	createInput store.LoanInput
	calls       int
	getErr      error
}

func (s *stubLoans) Create(_ context.Context, _ string, in store.LoanInput) (store.Loan, error) {
	s.calls++
	s.createInput = in
	return store.Loan{ID: "11111111-1111-1111-1111-111111111111"}, nil
}
func (s *stubLoans) Get(_ context.Context, _ string, _ string) (store.Loan, []store.LoanPayment, error) {
	return store.Loan{RemainingCents: 27690000, AnnualRateBps: 1373, MonthlyPaymentCents: 640428, DayOfMonth: 13}, []store.LoanPayment{{Status: "pending", DueDate: "2026-12-13"}}, s.getErr
}

func TestLoanCreateValidation(t *testing.T) {
	for _, body := range []string{`{}`, `{"accountId":"bogus"}`, `{"accountId":"11111111-1111-1111-1111-111111111111","description":"Car","principalCents":27690000,"annualRateBps":1373,"monthlyPaymentCents":100,"termMonths":60,"dayOfMonth":13,"startDate":"2026-12-13"}`} {
		stub := &stubLoans{}
		router := httpapi.NewRouter(httpapi.Options{AuthMiddleware: authenticatedMiddleware, Loans: stub})
		response := doRequest(router, http.MethodPost, "/v1/loans", body)
		if response.Code != 400 || stub.calls != 0 {
			t.Fatalf("invalid input status %d calls %d", response.Code, stub.calls)
		}
	}
	stub := &stubLoans{}
	router := httpapi.NewRouter(httpapi.Options{AuthMiddleware: authenticatedMiddleware, Loans: stub})
	body := `{"accountId":"11111111-1111-1111-1111-111111111111","description":"Car","principalCents":27690000,"annualRateBps":1373,"monthlyPaymentCents":640428,"termMonths":60,"dayOfMonth":13,"startDate":"2026-12-13"}`
	response := doRequest(router, http.MethodPost, "/v1/loans", body)
	if response.Code != 201 || stub.calls != 1 {
		t.Fatalf("valid create: %d %s", response.Code, response.Body.String())
	}
}
func TestLoansRequireAuthenticatedUserAndValidResourceID(t *testing.T) {
	stub := &stubLoans{}
	router := httpapi.NewRouter(httpapi.Options{Loans: stub})
	if got := doRequest(router, http.MethodPost, "/v1/loans", `{}`).Code; got != 401 {
		t.Fatalf("auth=%d", got)
	}
	router = httpapi.NewRouter(httpapi.Options{AuthMiddleware: authenticatedMiddleware, Loans: stub})
	if got := doRequest(router, http.MethodGet, "/v1/loans/not-uuid", "").Code; got != 400 {
		t.Fatalf("id=%d", got)
	}
	stub.getErr = store.ErrNotFound
	if got := doRequest(router, http.MethodGet, "/v1/loans/11111111-1111-1111-1111-111111111111", "").Code; got != 404 {
		t.Fatalf("other user resource=%d", got)
	}
}
func TestLoanErrorsDoNotLeakDatabaseDetails(t *testing.T) {
	stub := &stubLoans{getErr: errors.New("internal SQL private-server secret")}
	router := httpapi.NewRouter(httpapi.Options{AuthMiddleware: authenticatedMiddleware, Loans: stub})
	response := doRequest(router, http.MethodGet, "/v1/loans/11111111-1111-1111-1111-111111111111", "")
	if response.Code != 500 {
		t.Fatal(response.Code)
	}
	var result map[string]any
	if json.Unmarshal(response.Body.Bytes(), &result) != nil {
		t.Fatal("invalid error JSON")
	}
	if strings.Contains(response.Body.String(), "private-server") {
		t.Fatal("leaked internals")
	}
}
