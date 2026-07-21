package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/aleonsa/budg/backend/internal/auth"
	"github.com/aleonsa/budg/backend/internal/store"
)

// RuleStore is subset of repository handlers need.
type RuleStore interface {
	List(ctx context.Context, userID string) ([]store.Rule, error)
	Create(ctx context.Context, userID string, in store.RuleInput) (store.Rule, error)
	Toggle(ctx context.Context, userID, id string) (store.Rule, error)
	Delete(ctx context.Context, userID, id string) error
}

type rulesHandler struct {
	store RuleStore
}

func (h *rulesHandler) list(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{
			Error: apiError{Code: "unauthorized", Message: "a valid access token is required"},
		})
		return
	}
	rules, err := h.store.List(r.Context(), user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorResponse{
			Error: apiError{Code: "internal_error", Message: "could not list rules"},
		})
		return
	}
	writeJSON(w, http.StatusOK, rulesResponse{Data: rules})
}

func (h *rulesHandler) create(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{
			Error: apiError{Code: "unauthorized", Message: "a valid access token is required"},
		})
		return
	}
	var in store.RuleInput
	if err := decodeJSON(r, &in); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "request body is not valid JSON"},
		})
		return
	}
	if msg := validateRuleInput(in); msg != "" {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: msg},
		})
		return
	}
	created, err := h.store.Create(r.Context(), user.ID, in)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorResponse{
			Error: apiError{Code: "internal_error", Message: "could not create rule"},
		})
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (h *rulesHandler) toggle(w http.ResponseWriter, r *http.Request) {
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
			Error: apiError{Code: "invalid_request", Message: "rule id is required"},
		})
		return
	}
	updated, err := h.store.Toggle(r.Context(), user.ID, id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, errorResponse{
				Error: apiError{Code: "not_found", Message: "rule was not found"},
			})
			return
		}
		writeJSON(w, http.StatusInternalServerError, errorResponse{
			Error: apiError{Code: "internal_error", Message: "could not toggle rule"},
		})
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (h *rulesHandler) delete(w http.ResponseWriter, r *http.Request) {
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
			Error: apiError{Code: "invalid_request", Message: "rule id is required"},
		})
		return
	}
	if err := h.store.Delete(r.Context(), user.ID, id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, errorResponse{
				Error: apiError{Code: "not_found", Message: "rule was not found"},
			})
			return
		}
		writeJSON(w, http.StatusInternalServerError, errorResponse{
			Error: apiError{Code: "internal_error", Message: "could not delete rule"},
		})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type rulesResponse struct {
	Data []store.Rule `json:"data"`
}

func validateRuleInput(in store.RuleInput) string {
	if in.Field != "merchant" && in.Field != "description" {
		return "field must be 'merchant' or 'description'"
	}
	if in.Operator != "contains" && in.Operator != "startsWith" {
		return "operator must be 'contains' or 'startsWith'"
	}
	if strings.TrimSpace(in.Value) == "" {
		return "value is required"
	}
	if strings.TrimSpace(in.CategoryID) == "" {
		return "categoryId is required"
	}
	return ""
}
