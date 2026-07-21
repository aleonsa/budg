package httpapi

import (
	"context"
	"net/http"

	"github.com/aleonsa/budg/backend/internal/auth"
	"github.com/aleonsa/budg/backend/internal/store"
)

// MSIPurchaseStore is the subset of the repository the handlers need. There
// is currently no create/update/delete API for this resource -- it is
// read-only end to end (see migrations/00008_create_msi_purchases.sql).
type MSIPurchaseStore interface {
	List(ctx context.Context, userID string) ([]store.MSIPurchase, error)
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
		writeJSON(w, http.StatusInternalServerError, errorResponse{
			Error: apiError{Code: "internal_error", Message: "could not list msi purchases"},
		})
		return
	}
	writeJSON(w, http.StatusOK, msiPurchasesResponse{Data: purchases})
}

type msiPurchasesResponse struct {
	Data []store.MSIPurchase `json:"data"`
}
