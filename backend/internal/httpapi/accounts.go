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

// AccountStore is the subset of the repository the handlers need. Declared
// here (the consumer) so tests can substitute a stub without a live
// database. Method signatures use the concrete repository's types so
// *store.AccountRepository satisfies it structurally.
type AccountStore interface {
	List(ctx context.Context, userID string) ([]store.Account, error)
	Create(ctx context.Context, userID string, in store.AccountInput) (store.Account, error)
	Update(ctx context.Context, userID, id string, patch store.AccountPatch) (store.Account, error)
	EnableBalanceTracking(ctx context.Context, userID, id string, currentAmount int64) (store.Account, error)
	ReconcileBalance(ctx context.Context, userID, id string, currentAmount int64) (store.Account, error)
	Delete(ctx context.Context, userID, id string) error
}

type accountsHandler struct {
	store AccountStore
}

func (h *accountsHandler) list(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{
			Error: apiError{Code: "unauthorized", Message: "a valid access token is required"},
		})
		return
	}
	accounts, err := h.store.List(r.Context(), user.ID)
	if err != nil {
		writeInternalError(w, r, err, "could not list accounts")
		return
	}
	writeJSON(w, http.StatusOK, accountsResponse{Data: accounts})
}

func (h *accountsHandler) create(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{
			Error: apiError{Code: "unauthorized", Message: "a valid access token is required"},
		})
		return
	}
	var in store.AccountInput
	if err := decodeJSON(r, &in); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "request body is not valid JSON"},
		})
		return
	}
	if msg := validateAccountInput(in); msg != "" {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: msg},
		})
		return
	}
	created, err := h.store.Create(r.Context(), user.ID, in)
	if err != nil {
		writeInternalError(w, r, err, "could not create account")
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (h *accountsHandler) update(w http.ResponseWriter, r *http.Request) {
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
			Error: apiError{Code: "invalid_request", Message: "account id is required"},
		})
		return
	}
	var patch store.AccountPatch
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
				Error: apiError{Code: "not_found", Message: "account was not found"},
			})
			return
		}
		if errors.Is(err, store.ErrDirectBalancePatchForbidden) {
			writeJSON(w, http.StatusConflict, errorResponse{
				Error: apiError{Code: "balance_tracking_conflict", Message: "tracked balances must be changed through reconciliation"},
			})
			return
		}
		if errors.Is(err, store.ErrInvalidAccountShape) {
			writeJSON(w, http.StatusBadRequest, errorResponse{
				Error: apiError{Code: "invalid_request", Message: "account fields do not form a valid account"},
			})
			return
		}
		writeInternalError(w, r, err, "could not update account")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

type currentAmountRequest struct {
	CurrentAmount *int64 `json:"currentAmount"`
}

func (h *accountsHandler) enableBalanceTracking(w http.ResponseWriter, r *http.Request) {
	h.handleCurrentAmountMutation(w, r, true)
}

func (h *accountsHandler) reconcileBalance(w http.ResponseWriter, r *http.Request) {
	h.handleCurrentAmountMutation(w, r, false)
}

func (h *accountsHandler) handleCurrentAmountMutation(w http.ResponseWriter, r *http.Request, enable bool) {
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
			Error: apiError{Code: "invalid_request", Message: "account id is required"},
		})
		return
	}
	var request currentAmountRequest
	if err := decodeJSON(r, &request); err != nil || request.CurrentAmount == nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "currentAmount is required"},
		})
		return
	}

	var account store.Account
	if enable {
		account, err = h.store.EnableBalanceTracking(r.Context(), user.ID, id, *request.CurrentAmount)
	} else {
		account, err = h.store.ReconcileBalance(r.Context(), user.ID, id, *request.CurrentAmount)
	}
	if err != nil {
		switch {
		case errors.Is(err, store.ErrNotFound):
			writeJSON(w, http.StatusNotFound, errorResponse{
				Error: apiError{Code: "not_found", Message: "account was not found"},
			})
		case errors.Is(err, store.ErrBalanceTrackingAlreadyEnabled):
			writeJSON(w, http.StatusConflict, errorResponse{
				Error: apiError{Code: "balance_tracking_conflict", Message: "balance tracking is already enabled"},
			})
		case errors.Is(err, store.ErrBalanceTrackingNotEnabled), errors.Is(err, store.ErrDirectBalancePatchForbidden):
			writeJSON(w, http.StatusConflict, errorResponse{
				Error: apiError{Code: "balance_tracking_conflict", Message: "balance tracking is not enabled"},
			})
		case errors.Is(err, store.ErrInvalidAccountShape):
			writeJSON(w, http.StatusBadRequest, errorResponse{
				Error: apiError{Code: "invalid_request", Message: "account fields do not form a valid account"},
			})
		default:
			writeInternalError(w, r, err, "could not update account balance tracking")
		}
		return
	}
	writeJSON(w, http.StatusOK, account)
}

func (h *accountsHandler) delete(w http.ResponseWriter, r *http.Request) {
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
			Error: apiError{Code: "invalid_request", Message: "account id is required"},
		})
		return
	}
	if err := h.store.Delete(r.Context(), user.ID, id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, errorResponse{
				Error: apiError{Code: "not_found", Message: "account was not found"},
			})
			return
		}
		writeInternalError(w, r, err, "could not delete account")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type accountsResponse struct {
	Data []store.Account `json:"data"`
}

var last4Pattern = regexp.MustCompile(`^[0-9]{4}$`)

// validateAccountInput returns a human-readable error message or "" when ok.
// The database's accounts_type_fields CHECK constraint is the source of
// truth for the debit/credit field-shape invariant; this only rejects the
// obviously invalid cases early so clients get fast, friendly feedback
// instead of a raw constraint-violation error.
func validateAccountInput(in store.AccountInput) string {
	if in.Name == "" {
		return "name is required"
	}
	if in.Type != "debit" && in.Type != "credit" {
		return "type must be 'debit' or 'credit'"
	}
	if in.Institution == "" {
		return "institution is required"
	}
	if !last4Pattern.MatchString(in.Last4) {
		return "last4 must be exactly 4 digits"
	}
	if in.Currency != "MXN" && in.Currency != "USD" {
		return "currency must be 'MXN' or 'USD'"
	}
	if in.Type == "debit" {
		if in.CreditLimitCents != nil || in.AvailableCreditCents != nil ||
			in.StatementCutDay != nil || in.PaymentDueDay != nil {
			return "debit accounts cannot set credit fields"
		}
	}
	if in.Type == "credit" {
		if in.BalanceCents != nil {
			return "credit accounts cannot set balance"
		}
	}
	return ""
}
