package httpapi

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/aleonsa/budg/backend/internal/auth"
	"github.com/aleonsa/budg/backend/internal/store"
)

type CreditCardStatementStore interface {
	List(ctx context.Context, userID, accountID string) ([]store.CreditCardStatement, error)
	Confirm(ctx context.Context, userID, accountID string, input store.CreditCardStatementInput) (store.CreditCardStatement, error)
}

type creditCardStatementsHandler struct {
	store CreditCardStatementStore
}

func (h *creditCardStatementsHandler) list(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{
			Error: apiError{Code: "unauthorized", Message: "a valid access token is required"},
		})
		return
	}
	statements, err := h.store.List(r.Context(), user.ID, chi.URLParam(r, "id"))
	if err != nil {
		if writeCreditCardStatementClientError(w, err) {
			return
		}
		writeInternalError(w, r, err, "could not list credit card statements")
		return
	}
	writeJSON(w, http.StatusOK, creditCardStatementsResponse{Data: statements})
}

type creditCardStatementRequest struct {
	CycleStartDate        *string `json:"cycleStartDate"`
	CycleEndDate          *string `json:"cycleEndDate"`
	PaymentDueDate        *string `json:"paymentDueDate"`
	StatementBalanceCents *int64  `json:"statementBalance"`
	MinimumPaymentCents   *int64  `json:"minimumPayment"`
}

func (h *creditCardStatementsHandler) confirm(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{
			Error: apiError{Code: "unauthorized", Message: "a valid access token is required"},
		})
		return
	}
	accountID := chi.URLParam(r, "id")
	var request creditCardStatementRequest
	if err := decodeJSON(r, &request); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "request body is not valid JSON"},
		})
		return
	}
	if accountID == "" || request.CycleStartDate == nil || request.CycleEndDate == nil ||
		request.PaymentDueDate == nil || request.StatementBalanceCents == nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "account id, cycle dates, payment due date, and statement balance are required"},
		})
		return
	}
	statement, err := h.store.Confirm(r.Context(), user.ID, accountID, store.CreditCardStatementInput{
		CycleStartDate:        *request.CycleStartDate,
		CycleEndDate:          *request.CycleEndDate,
		PaymentDueDate:        *request.PaymentDueDate,
		StatementBalanceCents: *request.StatementBalanceCents,
		MinimumPaymentCents:   request.MinimumPaymentCents,
	})
	if err != nil {
		if writeCreditCardStatementClientError(w, err) {
			return
		}
		writeInternalError(w, r, err, "could not confirm credit card statement")
		return
	}
	writeJSON(w, http.StatusOK, statement)
}

func writeCreditCardStatementClientError(w http.ResponseWriter, err error) bool {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeJSON(w, http.StatusNotFound, errorResponse{
			Error: apiError{Code: "not_found", Message: "account was not found"},
		})
	case errors.Is(err, store.ErrInvalidAccountShape), errors.Is(err, store.ErrInvalidCreditCardStatement):
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "credit card statement fields or account are invalid"},
		})
	default:
		return false
	}
	return true
}

type creditCardStatementsResponse struct {
	Data []store.CreditCardStatement `json:"data"`
}
