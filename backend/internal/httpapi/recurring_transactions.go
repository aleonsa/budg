package httpapi

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/aleonsa/budg/backend/internal/auth"
	"github.com/aleonsa/budg/backend/internal/store"
	"github.com/go-chi/chi/v5"
)

type RecurringTransactionStore interface {
	List(ctx context.Context, userID string) ([]store.RecurringTransaction, error)
	Create(ctx context.Context, userID string, in store.RecurringTransactionInput) (store.RecurringTransaction, error)
	Update(ctx context.Context, userID, id string, in store.RecurringTransactionUpdateInput) (store.RecurringTransaction, error)
	Delete(ctx context.Context, userID, id string) error
	Process(ctx context.Context, userID string) (int, error)
}

type recurringTransactionsHandler struct{ store RecurringTransactionStore }

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

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

func (h *recurringTransactionsHandler) update(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{Error: apiError{Code: "unauthorized", Message: "a valid access token is required"}})
		return
	}
	id := chi.URLParam(r, "id")
	if !uuidPattern.MatchString(id) {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: apiError{Code: "invalid_request", Message: "recurring transaction id must be a UUID"}})
		return
	}
	var in store.RecurringTransactionUpdateInput
	if err := decodeJSON(r, &in); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: apiError{Code: "invalid_request", Message: "request body is not valid JSON"}})
		return
	}
	if msg := validateRecurringTransactionUpdateInput(in); msg != "" {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: apiError{Code: "invalid_request", Message: msg}})
		return
	}
	updated, err := h.store.Update(r.Context(), user.ID, id, in)
	if err != nil {
		writeRecurringTransactionError(w, r, err, "update")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (h *recurringTransactionsHandler) delete(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{Error: apiError{Code: "unauthorized", Message: "a valid access token is required"}})
		return
	}
	id := chi.URLParam(r, "id")
	if !uuidPattern.MatchString(id) {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: apiError{Code: "invalid_request", Message: "recurring transaction id must be a UUID"}})
		return
	}
	if err := h.store.Delete(r.Context(), user.ID, id); err != nil {
		writeRecurringTransactionError(w, r, err, "delete")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeRecurringTransactionError(w http.ResponseWriter, r *http.Request, err error, action string) {
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, errorResponse{Error: apiError{Code: "not_found", Message: "recurring transaction was not found"}})
		return
	}
	writeInternalError(w, r, err, "could not "+action+" recurring transaction")
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
	if _, err := time.Parse("2006-01-02", in.StartDate); err != nil {
		return "startDate must be a valid calendar date"
	}
	return ""
}

func validateRecurringTransactionUpdateInput(in store.RecurringTransactionUpdateInput) string {
	if in.IsActive == nil {
		return "isActive is required"
	}
	return validateRecurringTransactionInput(store.RecurringTransactionInput{
		AccountID: in.AccountID, CategoryID: in.CategoryID, Description: in.Description,
		Merchant: in.Merchant, Amount: in.Amount, Frequency: in.Frequency, StartDate: in.StartDate,
	})
}

type recurringTransactionsResponse struct {
	Data []store.RecurringTransaction `json:"data"`
}
