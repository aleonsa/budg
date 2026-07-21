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
	Categories     CategoryStore
	Accounts       AccountStore
	Transactions   TransactionStore
	Budgets        BudgetStore
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

		if opts.Categories != nil {
			h := &categoriesHandler{store: opts.Categories}
			v1.Route("/categories", func(cats chi.Router) {
				cats.Get("/", h.list)
				cats.Post("/", h.create)
				cats.Route("/{id}", func(item chi.Router) {
					item.Patch("/", h.update)
					item.Delete("/", h.delete)
				})
			})
		}

		if opts.Accounts != nil {
			h := &accountsHandler{store: opts.Accounts}
			v1.Route("/accounts", func(accts chi.Router) {
				accts.Get("/", h.list)
				accts.Post("/", h.create)
				accts.Route("/{id}", func(item chi.Router) {
					item.Patch("/", h.update)
					item.Delete("/", h.delete)
				})
			})
		}

		if opts.Transactions != nil {
			h := &transactionsHandler{store: opts.Transactions}
			v1.Route("/transactions", func(txs chi.Router) {
				txs.Get("/", h.list)
				txs.Post("/", h.create)
				txs.Route("/{id}", func(item chi.Router) {
					item.Patch("/", h.update)
					item.Delete("/", h.delete)
				})
			})
		}

		if opts.Budgets != nil {
			h := &budgetsHandler{store: opts.Budgets}
			v1.Route("/budgets", func(buds chi.Router) {
				buds.Get("/", h.list)
				buds.Post("/", h.create)
				buds.Route("/{id}", func(item chi.Router) {
					item.Patch("/", h.update)
					item.Delete("/", h.delete)
				})
			})
		}
	})

	return r
}
