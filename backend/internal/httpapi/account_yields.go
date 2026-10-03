package httpapi

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/aleonsa/budg/backend/internal/auth"
	"github.com/aleonsa/budg/backend/internal/store"
)

// AccountYieldStore is the subset of the yield repository the handlers need.
type AccountYieldStore interface {
	List(ctx context.Context, userID string) ([]store.YieldReconciliation, error)
	Reconcile(ctx context.Context, userID, accountID string, in store.YieldReconciliationInput) (store.YieldReconciliationResult, error)
	Undo(ctx context.Context, userID, accountID, id string) (store.Account, error)
}

func writeNotFoundYield(w http.ResponseWriter) {
	writeJSON(w, http.StatusNotFound, errorResponse{
		Error: apiError{Code: "not_found", Message: "account or reconciliation was not found"},
	})
}

type accountYieldsHandler struct {
	store AccountYieldStore
}

type yieldReconciliationRequest struct {
	CurrentBalance *int64  `json:"currentBalance"`
	YieldAmount    *int64  `json:"yieldAmount"`
	CategoryID     *string `json:"categoryId"`
	Date           *string `json:"date"`
}

func (h *accountYieldsHandler) list(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeUnauthorized(w)
		return
	}
	reconciliations, err := h.store.List(r.Context(), user.ID)
	if err != nil {
		writeInternalError(w, r, err, "could not list yield reconciliations")
		return
	}
	writeJSON(w, http.StatusOK, yieldReconciliationsResponse{Data: reconciliations})
}

func (h *accountYieldsHandler) reconcile(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeUnauthorized(w)
		return
	}
	if !uuidPattern.MatchString(chi.URLParam(r, "id")) {
		writeNotFoundYield(w)
		return
	}
	var request yieldReconciliationRequest
	if err := decodeJSON(r, &request); err != nil || request.CurrentBalance == nil ||
		request.Date == nil || !datePattern.MatchString(*request.Date) ||
		(request.CategoryID != nil && !uuidPattern.MatchString(*request.CategoryID)) {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "currentBalance and date (YYYY-MM-DD) are required; categoryId must be a UUID"},
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
	in := store.YieldReconciliationInput{
		CurrentBalanceCents: *request.CurrentBalance,
		CategoryID:          request.CategoryID,
		Date:                *request.Date,
	}
	if request.YieldAmount != nil {
		in.YieldCents = *request.YieldAmount
	}
	if idempotencyKey != "" {
		in.IdempotencyKey = &idempotencyKey
	}
	result, err := h.store.Reconcile(r.Context(), user.ID, chi.URLParam(r, "id"), in)
	if err != nil {
		if !writeYieldClientError(w, err) {
			writeInternalError(w, r, err, "could not reconcile yield")
		}
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *accountYieldsHandler) undo(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeUnauthorized(w)
		return
	}
	if !uuidPattern.MatchString(chi.URLParam(r, "id")) || !uuidPattern.MatchString(chi.URLParam(r, "reconciliationId")) {
		writeNotFoundYield(w)
		return
	}
	account, err := h.store.Undo(r.Context(), user.ID, chi.URLParam(r, "id"), chi.URLParam(r, "reconciliationId"))
	if err != nil {
		if !writeYieldClientError(w, err) {
			writeInternalError(w, r, err, "could not undo yield reconciliation")
		}
		return
	}
	writeJSON(w, http.StatusOK, account)
}

func writeUnauthorized(w http.ResponseWriter) {
	writeJSON(w, http.StatusUnauthorized, errorResponse{
		Error: apiError{Code: "unauthorized", Message: "a valid access token is required"},
	})
}

func writeYieldClientError(w http.ResponseWriter, err error) bool {
	type mapping struct {
		target  error
		status  int
		code    string
		message string
	}
	for _, m := range []mapping{
		{store.ErrNotFound, http.StatusNotFound, "not_found", "account or reconciliation was not found"},
		{store.ErrInvalidAccountShape, http.StatusBadRequest, "invalid_request", "yield reconciliation requires a debit account"},
		{store.ErrInvalidTransactionShape, http.StatusBadRequest, "invalid_request", "yield must be between zero and the positive difference, the category must be an income category, and the date cannot precede the last reconciliation"},
		{store.ErrBalanceTrackingNotEnabled, http.StatusConflict, "balance_tracking_conflict", "enable balance tracking before reconciling yield"},
		{store.ErrIdempotencyConflict, http.StatusConflict, "idempotency_conflict", "Idempotency-Key was already used with different data"},
		{store.ErrIdempotencyReplayDeleted, http.StatusConflict, "idempotency_resource_deleted", "Idempotency-Key refers to a reconciliation that was undone"},
		{store.ErrYieldReconciliationNotLatest, http.StatusConflict, "yield_reconciliation_not_latest", "only the latest reconciliation of an account can be undone"},
		{store.ErrInsufficientGoalAllocation, http.StatusConflict, "goal_allocation_conflict", "a goal no longer holds the yield it received; release funds first"},
		{store.ErrInsufficientUnallocatedSavings, http.StatusConflict, "goal_allocation_conflict", "undoing would leave more allocated to goals than the account holds; release funds first"},
		{store.ErrYieldDateBeforeMovements, http.StatusConflict, "yield_date_before_movements", "the account has movements dated after this date; reconcile with today's bank balance"},
	} {
		if errors.Is(err, m.target) {
			writeJSON(w, m.status, errorResponse{Error: apiError{Code: m.code, Message: m.message}})
			return true
		}
	}
	return false
}

type yieldReconciliationsResponse struct {
	Data []store.YieldReconciliation `json:"data"`
}
