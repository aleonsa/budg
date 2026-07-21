package httpapi

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/aleonsa/budg/backend/internal/auth"
	"github.com/aleonsa/budg/backend/internal/store"
)

// SavingsGoalStore is the subset of the repository the handlers need.
type SavingsGoalStore interface {
	List(ctx context.Context, userID string) ([]store.SavingsGoal, error)
	Create(ctx context.Context, userID string, in store.SavingsGoalInput) (store.SavingsGoal, error)
	Update(ctx context.Context, userID, id string, patch store.SavingsGoalPatch) (store.SavingsGoal, error)
	Contribute(ctx context.Context, userID, id string, amount int64) (store.SavingsGoal, error)
	Delete(ctx context.Context, userID, id string) error
}

type savingsGoalsHandler struct {
	store SavingsGoalStore
}

func (h *savingsGoalsHandler) list(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{
			Error: apiError{Code: "unauthorized", Message: "a valid access token is required"},
		})
		return
	}
	goals, err := h.store.List(r.Context(), user.ID)
	if err != nil {
		writeInternalError(w, r, err, "could not list savings goals")
		return
	}
	writeJSON(w, http.StatusOK, savingsGoalsResponse{Data: goals})
}

func (h *savingsGoalsHandler) create(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{
			Error: apiError{Code: "unauthorized", Message: "a valid access token is required"},
		})
		return
	}
	var in store.SavingsGoalInput
	if err := decodeJSON(r, &in); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "request body is not valid JSON"},
		})
		return
	}
	if msg := validateSavingsGoalInput(in); msg != "" {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: msg},
		})
		return
	}
	created, err := h.store.Create(r.Context(), user.ID, in)
	if err != nil {
		writeInternalError(w, r, err, "could not create savings goal")
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (h *savingsGoalsHandler) update(w http.ResponseWriter, r *http.Request) {
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
			Error: apiError{Code: "invalid_request", Message: "savings goal id is required"},
		})
		return
	}
	var patch store.SavingsGoalPatch
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
				Error: apiError{Code: "not_found", Message: "savings goal was not found"},
			})
			return
		}
		writeInternalError(w, r, err, "could not update savings goal")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (h *savingsGoalsHandler) contribute(w http.ResponseWriter, r *http.Request) {
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
			Error: apiError{Code: "invalid_request", Message: "savings goal id is required"},
		})
		return
	}
	var input struct {
		Amount int64 `json:"amount"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "request body is not valid JSON"},
		})
		return
	}
	if input.Amount == 0 {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "amount must not be zero"},
		})
		return
	}
	updated, err := h.store.Contribute(r.Context(), user.ID, id, input.Amount)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, errorResponse{
				Error: apiError{Code: "not_found", Message: "savings goal was not found"},
			})
			return
		}
		writeInternalError(w, r, err, "could not contribute to savings goal")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (h *savingsGoalsHandler) delete(w http.ResponseWriter, r *http.Request) {
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
			Error: apiError{Code: "invalid_request", Message: "savings goal id is required"},
		})
		return
	}
	if err := h.store.Delete(r.Context(), user.ID, id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, errorResponse{
				Error: apiError{Code: "not_found", Message: "savings goal was not found"},
			})
			return
		}
		writeInternalError(w, r, err, "could not delete savings goal")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type savingsGoalsResponse struct {
	Data []store.SavingsGoal `json:"data"`
}

func validateSavingsGoalInput(in store.SavingsGoalInput) string {
	if in.Name == "" {
		return "name is required"
	}
	if in.TargetAmount <= 0 {
		return "targetAmount must be greater than zero"
	}
	if in.CurrentAmount < 0 {
		return "currentAmount cannot be negative"
	}
	return ""
}
