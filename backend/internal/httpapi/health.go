package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

type healthResponse struct {
	Status string `json:"status"`
}

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type errorResponse struct {
	Error apiError `json:"error"`
}

// healthHandler reports process liveness only. It never probes downstream
// dependencies such as PostgreSQL; that responsibility belongs to /readyz
// once the database is introduced in Phase 2.
type healthHandler struct{}

func (h *healthHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w)
		return
	}

	writeJSON(w, http.StatusOK, healthResponse{Status: "ok"})
}

func writeMethodNotAllowed(w http.ResponseWriter) {
	w.Header().Set("Allow", http.MethodGet)
	writeJSON(w, http.StatusMethodNotAllowed, errorResponse{
		Error: apiError{Code: "method_not_allowed", Message: "GET is required"},
	})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// writeInternalError logs the real, unredacted error server-side (never sent
// to the client — see docs/backend/04-operations.md's logging policy) and
// writes the generic 500 body callers already used. Every handler's
// "internal_error" response should go through this instead of writeJSON
// directly, otherwise a real failure (bad DSN, RLS denial, network error to
// Postgres, ...) is completely invisible in production: chi's
// middleware.Logger only records the status code, not why it was 500.
func writeInternalError(w http.ResponseWriter, r *http.Request, err error, message string) {
	slog.ErrorContext(r.Context(), message, "error", err, "method", r.Method, "path", r.URL.Path)
	writeJSON(w, http.StatusInternalServerError, errorResponse{
		Error: apiError{Code: "internal_error", Message: message},
	})
}
