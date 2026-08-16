package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

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
	Overview(ctx context.Context, userID string) (store.SavingsOverview, error)
	Save(ctx context.Context, userID, id string, in store.SaveToGoalInput) (store.SavingsGoalActionResult, error)
	Allocate(ctx context.Context, userID, id string, in store.SavingsAllocationInput) (store.SavingsGoal, error)
	Reallocate(ctx context.Context, userID, id string, in store.SavingsReallocationInput) (store.SavingsReallocationResult, error)
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

func (h *savingsGoalsHandler) overview(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{
			Error: apiError{Code: "unauthorized", Message: "a valid access token is required"},
		})
		return
	}
	overview, err := h.store.Overview(r.Context(), user.ID)
	if err != nil {
		writeInternalError(w, r, err, "could not load savings overview")
		return
	}
	writeJSON(w, http.StatusOK, overview)
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
	if msg := validateSavingsGoalPatch(patch); msg != "" {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: msg},
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

func (h *savingsGoalsHandler) save(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{
			Error: apiError{Code: "unauthorized", Message: "a valid access token is required"},
		})
		return
	}
	id := chi.URLParam(r, "id")
	var in store.SaveToGoalInput
	if err := decodeJSON(r, &in); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "request body is not valid JSON"},
		})
		return
	}
	key := r.Header.Get("Idempotency-Key")
	if key == "" || len(key) > 128 {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "Idempotency-Key is required and must be at most 128 characters"},
		})
		return
	}
	in.IdempotencyKey = key
	if id == "" || in.SourceAccountID == "" || in.DestinationAccountID == "" ||
		in.SourceAccountID == in.DestinationAccountID || in.Amount <= 0 ||
		strings.TrimSpace(in.Description) == "" || !validISODate(in.Date) {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "savings transfer fields are invalid"},
		})
		return
	}
	result, err := h.store.Save(r.Context(), user.ID, id, in)
	if err != nil {
		if writeSavingsClientError(w, err) {
			return
		}
		writeInternalError(w, r, err, "could not save to savings goal")
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *savingsGoalsHandler) allocate(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{
			Error: apiError{Code: "unauthorized", Message: "a valid access token is required"},
		})
		return
	}
	id := chi.URLParam(r, "id")
	var in store.SavingsAllocationInput
	if err := decodeJSON(r, &in); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "request body is not valid JSON"},
		})
		return
	}
	key := r.Header.Get("Idempotency-Key")
	if key == "" || len(key) > 128 {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "Idempotency-Key is required and must be at most 128 characters"},
		})
		return
	}
	in.IdempotencyKey = key
	if id == "" || in.AccountID == "" || in.Amount == 0 || !validISODate(in.Date) {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "allocation fields are invalid"},
		})
		return
	}
	goal, err := h.store.Allocate(r.Context(), user.ID, id, in)
	if err != nil {
		if writeSavingsClientError(w, err) {
			return
		}
		writeInternalError(w, r, err, "could not allocate savings")
		return
	}
	writeJSON(w, http.StatusOK, goal)
}

func (h *savingsGoalsHandler) reallocate(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{
			Error: apiError{Code: "unauthorized", Message: "a valid access token is required"},
		})
		return
	}
	id := chi.URLParam(r, "id")
	var in store.SavingsReallocationInput
	if err := decodeJSON(r, &in); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "request body is not valid JSON"},
		})
		return
	}
	key := r.Header.Get("Idempotency-Key")
	if key == "" || len(key) > 128 {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "Idempotency-Key is required and must be at most 128 characters"},
		})
		return
	}
	in.IdempotencyKey = key
	if id == "" || in.ToGoalID == "" || id == in.ToGoalID || in.AccountID == "" ||
		in.Amount <= 0 || !validISODate(in.Date) {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "reallocation fields are invalid"},
		})
		return
	}
	result, err := h.store.Reallocate(r.Context(), user.ID, id, in)
	if err != nil {
		if writeSavingsClientError(w, err) {
			return
		}
		writeInternalError(w, r, err, "could not reallocate savings")
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func writeSavingsClientError(w http.ResponseWriter, err error) bool {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeJSON(w, http.StatusNotFound, errorResponse{
			Error: apiError{Code: "not_found", Message: "savings goal or account was not found"},
		})
	case errors.Is(err, store.ErrInvalidTransactionShape), errors.Is(err, store.ErrInvalidAccountShape), errors.Is(err, store.ErrTransferCurrencyMismatch):
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "savings operation is invalid"},
		})
	case errors.Is(err, store.ErrBalanceTrackingNotEnabled):
		writeJSON(w, http.StatusConflict, errorResponse{
			Error: apiError{Code: "balance_tracking_conflict", Message: "savings accounts require automatic balance tracking"},
		})
	case errors.Is(err, store.ErrInsufficientUnallocatedSavings):
		writeJSON(w, http.StatusConflict, errorResponse{
			Error: apiError{Code: "insufficient_unallocated_savings", Message: "account does not have enough unallocated savings"},
		})
	case errors.Is(err, store.ErrInsufficientGoalAllocation):
		writeJSON(w, http.StatusConflict, errorResponse{
			Error: apiError{Code: "insufficient_goal_allocation", Message: "goal does not have enough allocated savings"},
		})
	case errors.Is(err, store.ErrIdempotencyConflict):
		writeJSON(w, http.StatusConflict, errorResponse{
			Error: apiError{Code: "idempotency_conflict", Message: "Idempotency-Key was already used with different savings data"},
		})
	default:
		return false
	}
	return true
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
	if strings.TrimSpace(in.Name) == "" {
		return "name is required"
	}
	if in.TargetAmount <= 0 {
		return "targetAmount must be greater than zero"
	}
	if in.CurrentAmount != 0 {
		return "currentAmount must start at zero; assign existing savings after creation"
	}
	if in.TargetDate != nil && !validISODate(*in.TargetDate) {
		return "targetDate must use YYYY-MM-DD"
	}
	return ""
}

func validateSavingsGoalPatch(patch store.SavingsGoalPatch) string {
	if patch.Name != nil && strings.TrimSpace(*patch.Name) == "" {
		return "name cannot be empty"
	}
	if patch.TargetAmount != nil && *patch.TargetAmount <= 0 {
		return "targetAmount must be greater than zero"
	}
	if patch.TargetDate.Set && patch.TargetDate.Value != nil && !validISODate(*patch.TargetDate.Value) {
		return "targetDate must use YYYY-MM-DD"
	}
	if patch.SortOrder != nil && *patch.SortOrder < 0 {
		return "order cannot be negative"
	}
	return ""
}

func validISODate(value string) bool {
	_, err := time.Parse(time.DateOnly, value)
	return err == nil
}
