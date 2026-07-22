package httpapi

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// defaultRouteTimeout bounds every standard (non-agent) /v1 request. It is
// applied inside the /v1 route tree rather than at the router root so the
// agent route below can use its own, independently configured deadline
// instead of inheriting this one.
const defaultRouteTimeout = 15 * time.Second

// minAgentRouteTimeout is the floor used when a caller constructs Options
// with an agent service but forgets to set AgentRouteTimeout (e.g. in a
// test). Production wiring always supplies the configured agent deadline
// (config.AgentConfig.Timeout, bounded 5-120s) explicitly.
const minAgentRouteTimeout = 30 * time.Second

// Options wires the router's dependencies. Keeping them in a struct avoids a
// growing positional signature as new capabilities arrive per phase.
type Options struct {
	Database              databasePinger
	AuthMiddleware        func(http.Handler) http.Handler
	CORSOrigins           []string
	Categories            CategoryStore
	Accounts              AccountStore
	Transactions          TransactionStore
	CreditCardStatements  CreditCardStatementStore
	Budgets               BudgetStore
	SavingsGoals          SavingsGoalStore
	Rules                 RuleStore
	MSIPurchases          MSIPurchaseStore
	RecurringTransactions RecurringTransactionStore

	// Agent, if non-nil, mounts POST /v1/agent/chat. It is nil whenever the
	// agent is disabled (no OPENAI_API_KEY configured; see
	// config.AgentConfig), in which case the route does not exist at all,
	// matching how every other resource above is conditionally mounted.
	Agent Agent
	// AgentRouteTimeout is the per-request context deadline for the agent
	// route only. A single turn may involve several model calls and tool
	// executions, so it is deliberately independent of defaultRouteTimeout
	// rather than a shared value. Falls back to minAgentRouteTimeout if unset.
	AgentRouteTimeout time.Duration
}

// NewRouter builds the HTTP routing tree used by the API server and tests.
func NewRouter(opts Options) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Logger)
	r.Use(newCORS(opts.CORSOrigins))

	r.Handle("/healthz", &healthHandler{})
	r.Handle("/readyz", &readyHandler{database: opts.Database})

	r.Route("/v1", func(v1 chi.Router) {
		if opts.AuthMiddleware != nil {
			v1.Use(opts.AuthMiddleware)
		}
		v1.Handle("/me", &meHandler{})

		v1.Group(func(std chi.Router) {
			std.Use(middleware.Timeout(defaultRouteTimeout))

			if opts.Categories != nil {
				h := &categoriesHandler{store: opts.Categories}
				std.Route("/categories", func(cats chi.Router) {
					cats.Get("/", h.list)
					cats.Post("/", h.create)
					cats.Route("/{id}", func(item chi.Router) {
						item.Patch("/", h.update)
						item.Delete("/", h.delete)
					})
				})
			}

			if opts.Accounts != nil || opts.CreditCardStatements != nil {
				std.Route("/accounts", func(accts chi.Router) {
					if opts.Accounts != nil {
						h := &accountsHandler{store: opts.Accounts}
						accts.Get("/", h.list)
						accts.Post("/", h.create)
					}
					accts.Route("/{id}", func(item chi.Router) {
						if opts.Accounts != nil {
							h := &accountsHandler{store: opts.Accounts}
							item.Post("/balance-tracking", h.enableBalanceTracking)
							item.Post("/reconcile-balance", h.reconcileBalance)
							item.Patch("/", h.update)
							item.Delete("/", h.delete)
						}
						if opts.CreditCardStatements != nil {
							h := &creditCardStatementsHandler{store: opts.CreditCardStatements}
							item.Get("/credit-card-statements", h.list)
							item.Post("/credit-card-statements", h.confirm)
						}
					})
				})
			}

			if opts.Transactions != nil {
				h := &transactionsHandler{store: opts.Transactions}
				std.Route("/transactions", func(txs chi.Router) {
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
				std.Route("/budgets", func(buds chi.Router) {
					buds.Get("/", h.list)
					buds.Post("/", h.create)
					buds.Route("/{id}", func(item chi.Router) {
						item.Patch("/", h.update)
						item.Delete("/", h.delete)
					})
				})
			}

			if opts.SavingsGoals != nil {
				h := &savingsGoalsHandler{store: opts.SavingsGoals}
				std.Route("/savings-goals", func(goals chi.Router) {
					goals.Get("/", h.list)
					goals.Post("/", h.create)
					goals.Route("/{id}", func(item chi.Router) {
						item.Post("/contributions", h.contribute)
						item.Patch("/", h.update)
						item.Delete("/", h.delete)
					})
				})
			}

			if opts.Rules != nil {
				h := &rulesHandler{store: opts.Rules}
				std.Route("/rules", func(rules chi.Router) {
					rules.Get("/", h.list)
					rules.Post("/", h.create)
					rules.Route("/{id}", func(item chi.Router) {
						item.Post("/toggle", h.toggle)
						item.Delete("/", h.delete)
					})
				})
			}

			if opts.MSIPurchases != nil {
				h := &msiPurchasesHandler{store: opts.MSIPurchases}
				std.Route("/msi-purchases", func(msi chi.Router) {
					msi.Get("/", h.list)
					msi.Post("/", h.create)
				})
			}

			if opts.RecurringTransactions != nil {
				h := &recurringTransactionsHandler{store: opts.RecurringTransactions}
				std.Route("/recurring-transactions", func(recurring chi.Router) {
					recurring.Get("/", h.list)
					recurring.Post("/", h.create)
					recurring.Post("/process", h.process)
				})
			}
		})

		if opts.Agent != nil {
			timeout := opts.AgentRouteTimeout
			if timeout <= 0 {
				timeout = minAgentRouteTimeout
			}
			v1.Group(func(agentRouter chi.Router) {
				agentRouter.Use(middleware.Timeout(timeout))
				h := &agentHandler{service: opts.Agent}
				agentRouter.Post("/agent/chat", h.chat)
			})
		}
	})

	return r
}
