package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/aleonsa/budg/backend/internal/auth"
	"github.com/aleonsa/budg/backend/internal/store"
)

// MSIPurchaseStore is the subset of the repository the handlers need.
type MSIPurchaseStore interface {
	List(ctx context.Context, userID string) ([]store.MSIPurchase, error)
	Create(ctx context.Context, userID string, in store.MSIPurchaseInput) (store.MSIPurchase, error)
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
	created, err := h.store.Create(r.Context(), user.ID, in)
	if err != nil {
		if errors.Is(err, store.ErrMSIRequiresCreditAccount) {
			writeJSON(w, http.StatusBadRequest, errorResponse{
				Error: apiError{Code: "invalid_request", Message: "accountId must refer to a credit account"},
			})
			return
		}
		writeInternalError(w, r, err, "could not create msi purchase")
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
