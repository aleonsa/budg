package httpapi

import (
	"encoding/json"
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
