package httpapi

import (
	"context"
	"net/http"
	"time"
)

const readinessTimeout = 2 * time.Second

type databasePinger interface {
	Ping(context.Context) error
}

type readyHandler struct {
	database databasePinger
}

func (h *readyHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), readinessTimeout)
	defer cancel()
	if err := h.database.Ping(ctx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, errorResponse{
			Error: apiError{Code: "service_unavailable", Message: "database is unavailable"},
		})
		return
	}

	writeJSON(w, http.StatusOK, healthResponse{Status: "ok"})
}
