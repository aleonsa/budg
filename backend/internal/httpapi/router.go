package httpapi

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// NewRouter builds the HTTP routing tree used by the API server and tests.
// Phase 1 exposes only /healthz; CORS, auth, and versioned resources arrive
// in later phases so the wiring here must stay small and observable.
func NewRouter() http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(15 * time.Second))
	r.Use(middleware.Logger)

	r.Handle("/healthz", &healthHandler{})

	return r
}
