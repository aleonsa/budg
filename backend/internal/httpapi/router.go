package httpapi

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// Options wires the router's dependencies. Keeping them in a struct avoids a
// growing positional signature as new capabilities arrive per phase.
type Options struct {
	Database       databasePinger
	AuthMiddleware func(http.Handler) http.Handler
	CORSOrigins    []string
}

// NewRouter builds the HTTP routing tree used by the API server and tests.
func NewRouter(opts Options) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(15 * time.Second))
	r.Use(middleware.Logger)
	r.Use(newCORS(opts.CORSOrigins))

	r.Handle("/healthz", &healthHandler{})
	r.Handle("/readyz", &readyHandler{database: opts.Database})

	r.Route("/v1", func(v1 chi.Router) {
		if opts.AuthMiddleware != nil {
			v1.Use(opts.AuthMiddleware)
		}
		v1.Handle("/me", &meHandler{})
	})

	return r
}
