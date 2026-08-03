package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/aleonsa/budg/backend/internal/auth"
	"github.com/aleonsa/budg/backend/internal/store"
	"github.com/go-chi/chi/v5"
)

// MSIPurchaseStore is the subset of the repository the handlers need.
type MSIPurchaseStore interface {
	List(ctx context.Context, userID string) ([]store.MSIPurchase, error)
	Create(ctx context.Context, userID string, in store.MSIPurchaseInput) (store.MSIPurchase, error)
	Update(ctx context.Context, userID, id string, in store.MSIPurchaseInput) (store.MSIPurchase, error)
	Delete(ctx context.Context, userID, id string) error
}

func (h *msiPurchasesHandler) update(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{
			Error: apiError{Code: "unauthorized", Message: "a valid access token is required"},
		})
		return
	}
	var in store.MSIPurchaseInput
	if err := decodeJSON(r, &in); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "request body is not valid JSON"},
		})
		return
	}
	if msg := validateMSIPurchaseInput(in); msg != "" {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: msg},
		})
		return
	}
	updated, err := h.store.Update(r.Context(), user.ID, chi.URLParam(r, "id"), in)
	if err != nil {
		writeMSIPurchaseError(w, r, err, "update")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (h *msiPurchasesHandler) delete(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{
			Error: apiError{Code: "unauthorized", Message: "a valid access token is required"},
		})
		return
	}
	if err := h.store.Delete(r.Context(), user.ID, chi.URLParam(r, "id")); err != nil {
		writeMSIPurchaseError(w, r, err, "delete")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeMSIPurchaseError(w http.ResponseWriter, r *http.Request, err error, action string) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeJSON(w, http.StatusNotFound, errorResponse{
			Error: apiError{Code: "not_found", Message: "msi purchase was not found"},
		})
	case errors.Is(err, store.ErrMSIRequiresCreditAccount):
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "accountId must refer to a credit account"},
		})
	case errors.Is(err, store.ErrBalanceTrackingNotEnabled):
		writeJSON(w, http.StatusConflict, errorResponse{
			Error: apiError{Code: "balance_tracking_conflict", Message: "msi purchases require balance tracking on the credit account"},
		})
	case errors.Is(err, store.ErrIdempotencyConflict):
		writeJSON(w, http.StatusConflict, errorResponse{
			Error: apiError{Code: "idempotency_conflict", Message: "Idempotency-Key was already used with different msi purchase data"},
		})
	case errors.Is(err, store.ErrMSIPurchaseHasPaidInstallments):
		writeJSON(w, http.StatusConflict, errorResponse{
			Error: apiError{Code: "paid_installments_conflict", Message: "msi purchases with paid installments cannot be replaced"},
		})
	case errors.Is(err, store.ErrMSILegacyBalanceChange):
		writeJSON(w, http.StatusConflict, errorResponse{
			Error: apiError{Code: "legacy_msi_balance_conflict", Message: "legacy msi balance fields require reconciliation"},
		})
	default:
		writeInternalError(w, r, err, "could not "+action+" msi purchase")
	}
}

type msiPurchasesHandler struct {
	store MSIPurchaseStore
}

func (h *msiPurchasesHandler) list(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{
			Error: apiError{Code: "unauthorized", Message: "a valid access token is required"},
		})
		return
	}
	purchases, err := h.store.List(r.Context(), user.ID)
	if err != nil {
		writeInternalError(w, r, err, "could not list msi purchases")
		return
	}
	writeJSON(w, http.StatusOK, msiPurchasesResponse{Data: purchases})
}

func (h *msiPurchasesHandler) create(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{
			Error: apiError{Code: "unauthorized", Message: "a valid access token is required"},
		})
		return
	}
	var in store.MSIPurchaseInput
	if err := decodeJSON(r, &in); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "request body is not valid JSON"},
		})
		return
	}
	if msg := validateMSIPurchaseInput(in); msg != "" {
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
		writeMSIPurchaseError(w, r, err, "create")
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func validateMSIPurchaseInput(in store.MSIPurchaseInput) string {
	if in.AccountID == "" {
		return "accountId is required"
	}
	if strings.TrimSpace(in.Description) == "" {
		return "description is required"
	}
	if in.TotalAmount <= 0 {
		return "totalAmount must be greater than zero"
	}
	if in.InstallmentCount < 2 || in.InstallmentCount > 60 {
		return "installmentCount must be between 2 and 60"
	}
	if in.TotalAmount < int64(in.InstallmentCount) {
		return "totalAmount must be at least one cent per installment"
	}
	if !datePattern.MatchString(in.StartDate) {
		return "startDate must be in YYYY-MM-DD format"
	}
	return ""
}

type msiPurchasesResponse struct {
	Data []store.MSIPurchase `json:"data"`
}
