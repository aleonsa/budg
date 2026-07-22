package httpapi

import (
	"context"
	"net/http"
	"strings"

	"github.com/aleonsa/budg/backend/internal/auth"
	"github.com/aleonsa/budg/backend/internal/store"
)

type RecurringTransactionStore interface {
	List(ctx context.Context, userID string) ([]store.RecurringTransaction, error)
	Create(ctx context.Context, userID string, in store.RecurringTransactionInput) (store.RecurringTransaction, error)
	Process(ctx context.Context, userID string) (int, error)
}

type recurringTransactionsHandler struct{ store RecurringTransactionStore }

func (h *recurringTransactionsHandler) list(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{Error: apiError{Code: "unauthorized", Message: "a valid access token is required"}})
		return
	}
	items, err := h.store.List(r.Context(), user.ID)
	if err != nil {
		writeInternalError(w, r, err, "could not list recurring transactions")
		return
	}
	writeJSON(w, http.StatusOK, recurringTransactionsResponse{Data: items})
}

func (h *recurringTransactionsHandler) create(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{Error: apiError{Code: "unauthorized", Message: "a valid access token is required"}})
		return
	}
	var in store.RecurringTransactionInput
	if err := decodeJSON(r, &in); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: apiError{Code: "invalid_request", Message: "request body is not valid JSON"}})
		return
	}
	if msg := validateRecurringTransactionInput(in); msg != "" {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: apiError{Code: "invalid_request", Message: msg}})
		return
	}
	created, err := h.store.Create(r.Context(), user.ID, in)
	if err != nil {
		writeInternalError(w, r, err, "could not create recurring transaction")
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (h *recurringTransactionsHandler) process(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{Error: apiError{Code: "unauthorized", Message: "a valid access token is required"}})
		return
	}
	created, err := h.store.Process(r.Context(), user.ID)
	if err != nil {
		writeInternalError(w, r, err, "could not process recurring transactions")
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Created int `json:"created"`
	}{Created: created})
}

func validateRecurringTransactionInput(in store.RecurringTransactionInput) string {
	if in.AccountID == "" {
		return "accountId is required"
	}
	if strings.TrimSpace(in.Description) == "" {
		return "description is required"
	}
	if in.Amount <= 0 {
		return "amount must be greater than zero"
	}
	if in.Frequency != "monthly" && in.Frequency != "yearly" {
		return "frequency must be 'monthly' or 'yearly'"
	}
	if !datePattern.MatchString(in.StartDate) {
		return "startDate must be in YYYY-MM-DD format"
	}
	return ""
}

type recurringTransactionsResponse struct {
	Data []store.RecurringTransaction `json:"data"`
}
