package httpapi

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/aleonsa/budg/backend/internal/auth"
	"github.com/aleonsa/budg/backend/internal/store"
)

// BudgetStore is the subset of the repository the handlers need.
type BudgetStore interface {
	List(ctx context.Context, userID string) ([]store.Budget, error)
	Create(ctx context.Context, userID string, in store.BudgetInput) (store.Budget, error)
	Update(ctx context.Context, userID, id string, patch store.BudgetPatch) (store.Budget, error)
	Delete(ctx context.Context, userID, id string) error
}

type budgetsHandler struct {
	store BudgetStore
}

func (h *budgetsHandler) list(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{
			Error: apiError{Code: "unauthorized", Message: "a valid access token is required"},
		})
		return
	}
	budgets, err := h.store.List(r.Context(), user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorResponse{
			Error: apiError{Code: "internal_error", Message: "could not list budgets"},
		})
		return
	}
	writeJSON(w, http.StatusOK, budgetsResponse{Data: budgets})
}

func (h *budgetsHandler) create(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{
			Error: apiError{Code: "unauthorized", Message: "a valid access token is required"},
		})
		return
	}
	var in store.BudgetInput
	if err := decodeJSON(r, &in); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "request body is not valid JSON"},
		})
		return
	}
	if msg := validateBudgetInput(in); msg != "" {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: msg},
		})
		return
	}
	created, err := h.store.Create(r.Context(), user.ID, in)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorResponse{
			Error: apiError{Code: "internal_error", Message: "could not create budget"},
		})
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (h *budgetsHandler) update(w http.ResponseWriter, r *http.Request) {
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
			Error: apiError{Code: "invalid_request", Message: "budget id is required"},
		})
		return
	}
	var patch store.BudgetPatch
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
				Error: apiError{Code: "not_found", Message: "budget was not found"},
			})
			return
		}
		writeJSON(w, http.StatusInternalServerError, errorResponse{
			Error: apiError{Code: "internal_error", Message: "could not update budget"},
		})
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (h *budgetsHandler) delete(w http.ResponseWriter, r *http.Request) {
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
			Error: apiError{Code: "invalid_request", Message: "budget id is required"},
		})
		return
	}
	if err := h.store.Delete(r.Context(), user.ID, id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, errorResponse{
				Error: apiError{Code: "not_found", Message: "budget was not found"},
			})
			return
		}
		writeJSON(w, http.StatusInternalServerError, errorResponse{
			Error: apiError{Code: "internal_error", Message: "could not delete budget"},
		})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type budgetsResponse struct {
	Data []store.Budget `json:"data"`
}

func validateBudgetInput(in store.BudgetInput) string {
	if in.Amount <= 0 {
		return "amount must be greater than zero"
	}
	if in.Period != "weekly" && in.Period != "monthly" && in.Period != "yearly" {
		return "period must be 'weekly', 'monthly', or 'yearly'"
	}
	if !datePattern.MatchString(in.StartDate) {
		return "startDate must be in YYYY-MM-DD format"
	}
	return ""
}
