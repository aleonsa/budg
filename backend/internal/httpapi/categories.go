package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/aleonsa/budg/backend/internal/auth"
	"github.com/aleonsa/budg/backend/internal/store"
)

// CategoryStore is the subset of the repository the handlers need. Declared
// here (the consumer) so tests can substitute a stub without a live database.
// Method signatures use the concrete repository's types so
// *store.CategoryRepository satisfies it structurally.
type CategoryStore interface {
	List(ctx context.Context, userID string) ([]store.Category, error)
	Create(ctx context.Context, userID string, in store.CategoryInput) (store.Category, error)
	Update(ctx context.Context, userID, id string, patch store.CategoryPatch) (store.Category, error)
	Delete(ctx context.Context, userID, id string) error
}

type categoriesHandler struct {
	store CategoryStore
}

func (h *categoriesHandler) list(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{
			Error: apiError{Code: "unauthorized", Message: "a valid access token is required"},
		})
		return
	}
	categories, err := h.store.List(r.Context(), user.ID)
	if err != nil {
		writeInternalError(w, r, err, "could not list categories")
		return
	}
	writeJSON(w, http.StatusOK, categoriesResponse{Data: categories})
}

func (h *categoriesHandler) create(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{
			Error: apiError{Code: "unauthorized", Message: "a valid access token is required"},
		})
		return
	}
	var in store.CategoryInput
	if err := decodeJSON(r, &in); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "request body is not valid JSON"},
		})
		return
	}
	if msg := validateCategoryInput(in); msg != "" {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: msg},
		})
		return
	}
	created, err := h.store.Create(r.Context(), user.ID, in)
	if err != nil {
		writeInternalError(w, r, err, "could not create category")
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (h *categoriesHandler) update(w http.ResponseWriter, r *http.Request) {
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
			Error: apiError{Code: "invalid_request", Message: "category id is required"},
		})
		return
	}
	var patch store.CategoryPatch
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
				Error: apiError{Code: "not_found", Message: "category was not found"},
			})
			return
		}
		writeInternalError(w, r, err, "could not update category")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (h *categoriesHandler) delete(w http.ResponseWriter, r *http.Request) {
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
			Error: apiError{Code: "invalid_request", Message: "category id is required"},
		})
		return
	}
	if err := h.store.Delete(r.Context(), user.ID, id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, errorResponse{
				Error: apiError{Code: "not_found", Message: "category was not found"},
			})
			return
		}
		writeInternalError(w, r, err, "could not delete category")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type categoriesResponse struct {
	Data []store.Category `json:"data"`
}

// validateCategoryInput returns a human-readable error message or "" when ok.
// We rely on the database CHECK constraints as the source of truth and only
// reject the obviously invalid cases here so clients get fast feedback.
func validateCategoryInput(in store.CategoryInput) string {
	if in.Name == "" {
		return "name is required"
	}
	if in.Kind != "expense" && in.Kind != "income" {
		return "kind must be 'expense' or 'income'"
	}
	if in.Icon == "" {
		return "icon is required"
	}
	if in.Color == "" {
		return "color is required"
	}
	return ""
}

func decodeJSON(r *http.Request, dst any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}
