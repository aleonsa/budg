package httpapi

import (
	"context"
	"errors"
	"net/http"
	"regexp"

	"github.com/go-chi/chi/v5"

	"github.com/aleonsa/budg/backend/internal/auth"
	"github.com/aleonsa/budg/backend/internal/store"
)

// TransactionStore is the subset of the repository the handlers need.
type TransactionStore interface {
	List(ctx context.Context, userID string) ([]store.Transaction, error)
	Create(ctx context.Context, userID string, in store.TransactionInput) (store.Transaction, error)
	Update(ctx context.Context, userID, id string, patch store.TransactionPatch) (store.Transaction, error)
	Delete(ctx context.Context, userID, id string) error
}

type transactionsHandler struct {
	store TransactionStore
}

func (h *transactionsHandler) list(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{
			Error: apiError{Code: "unauthorized", Message: "a valid access token is required"},
		})
		return
	}
	transactions, err := h.store.List(r.Context(), user.ID)
	if err != nil {
		writeInternalError(w, r, err, "could not list transactions")
		return
	}
	writeJSON(w, http.StatusOK, transactionsResponse{Data: transactions})
}

func (h *transactionsHandler) create(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{
			Error: apiError{Code: "unauthorized", Message: "a valid access token is required"},
		})
		return
	}
	var in store.TransactionInput
	if err := decodeJSON(r, &in); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "request body is not valid JSON"},
		})
		return
	}
	if msg := validateTransactionInput(in); msg != "" {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: msg},
		})
		return
	}
	idempotencyKey := r.Header.Get("Idempotency-Key")
	if len(idempotencyKey) > 128 {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "Idempotency-Key must be at most 128 characters"},
		})
		return
	}
	if idempotencyKey != "" {
		in.IdempotencyKey = &idempotencyKey
	}
	created, err := h.store.Create(r.Context(), user.ID, in)
	if err != nil {
		if writeTransactionClientError(w, err) {
			return
		}
		writeInternalError(w, r, err, "could not create transaction")
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (h *transactionsHandler) update(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{
			Error: apiError{Code: "unauthorized", Message: "a valid access token is required"},
		})
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "transaction id is required"},
		})
		return
	}
	var patch store.TransactionPatch
	if err := decodeJSON(r, &patch); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "request body is not valid JSON"},
		})
		return
	}
	updated, err := h.store.Update(r.Context(), user.ID, id, patch)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, errorResponse{
				Error: apiError{Code: "not_found", Message: "transaction was not found"},
			})
			return
		}
		if writeTransactionClientError(w, err) {
			return
		}
		writeInternalError(w, r, err, "could not update transaction")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func writeTransactionClientError(w http.ResponseWriter, err error) bool {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeJSON(w, http.StatusNotFound, errorResponse{
			Error: apiError{Code: "not_found", Message: "transaction account was not found"},
		})
	case errors.Is(err, store.ErrInvalidTransactionShape):
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "transaction fields do not form a valid transaction"},
		})
	case errors.Is(err, store.ErrTransferCurrencyMismatch):
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "transfer accounts must use the same currency"},
		})
	case errors.Is(err, store.ErrInvalidAccountShape):
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "transaction account has an invalid balance shape"},
		})
	case errors.Is(err, store.ErrIdempotencyConflict):
		writeJSON(w, http.StatusConflict, errorResponse{
			Error: apiError{Code: "idempotency_conflict", Message: "Idempotency-Key was already used with different transaction data"},
		})
	case errors.Is(err, store.ErrBalanceTrackingNotEnabled):
		writeJSON(w, http.StatusConflict, errorResponse{
			Error: apiError{Code: "balance_tracking_conflict", Message: "statement payments require balance tracking on both accounts"},
		})
	default:
		return false
	}
	return true
}

func (h *transactionsHandler) delete(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{
			Error: apiError{Code: "unauthorized", Message: "a valid access token is required"},
		})
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "transaction id is required"},
		})
		return
	}
	if err := h.store.Delete(r.Context(), user.ID, id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, errorResponse{
				Error: apiError{Code: "not_found", Message: "transaction was not found"},
			})
			return
		}
		writeInternalError(w, r, err, "could not delete transaction")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type transactionsResponse struct {
	Data []store.Transaction `json:"data"`
}

var datePattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

func validateTransactionInput(in store.TransactionInput) string {
	if in.AccountID == "" {
		return "accountId is required"
	}
	if in.Type != "expense" && in.Type != "income" && in.Type != "transfer" {
		return "type must be 'expense', 'income', or 'transfer'"
	}
	if in.Amount <= 0 {
		return "amount must be greater than zero"
	}
	if !datePattern.MatchString(in.Date) {
		return "date must be in YYYY-MM-DD format"
	}
	if in.Description == "" {
		return "description is required"
	}
	if in.Type == "transfer" {
		if in.TransferToAccount == nil || *in.TransferToAccount == "" {
			return "transferToAccountId is required for transfer transactions"
		}
		if *in.TransferToAccount == in.AccountID {
			return "cannot transfer to the same account"
		}
		if in.CategoryID != nil {
			return "transfer transactions cannot have a category"
		}
		if in.CreditCardStatementID != nil && in.AffectsBalance != nil && !*in.AffectsBalance {
			return "statement-linked transfers must affect balances"
		}
	} else {
		if in.TransferToAccount != nil {
			return "non-transfer transactions cannot have transferToAccountId"
		}
		if in.CreditCardStatementID != nil {
			return "non-transfer transactions cannot have creditCardStatementId"
		}
	}
	return ""
}
