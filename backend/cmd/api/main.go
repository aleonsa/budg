package main

import (
	"context"
	"crypto/rand"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"

	"github.com/aleonsa/budg/backend/internal/agent"
	"github.com/aleonsa/budg/backend/internal/auth"
	"github.com/aleonsa/budg/backend/internal/config"
	"github.com/aleonsa/budg/backend/internal/httpapi"
	"github.com/aleonsa/budg/backend/internal/store"
)

// agentStore composes the repository methods the agent's tools depend on
// (see internal/agent.Store). It exists only because AccountRepository,
// CategoryRepository, and TransactionRepository each expose same-named
// List/Create/Update/Delete methods: one struct embedding all three could not
// satisfy an interface requiring distinctly named methods without this small
// adapter. It carries no logic of its own.
type agentStore struct {
	accounts     *store.AccountRepository
	categories   *store.CategoryRepository
	transactions *store.TransactionRepository
}

func (s *agentStore) ListAccounts(ctx context.Context, userID string) ([]store.Account, error) {
	return s.accounts.List(ctx, userID)
}

func (s *agentStore) ListCategories(ctx context.Context, userID string) ([]store.Category, error) {
	return s.categories.List(ctx, userID)
}

func (s *agentStore) ListTransactions(ctx context.Context, userID string) ([]store.Transaction, error) {
	return s.transactions.List(ctx, userID)
}

func (s *agentStore) CreateTransaction(ctx context.Context, userID string, in store.TransactionInput) (store.Transaction, error) {
	return s.transactions.Create(ctx, userID, in)
}

func (s *agentStore) UpdateTransaction(ctx context.Context, userID, id string, patch store.TransactionPatch) (store.Transaction, error) {
	return s.transactions.Update(ctx, userID, id, patch)
}

func (s *agentStore) DeleteTransaction(ctx context.Context, userID, id string) error {
	return s.transactions.Delete(ctx, userID, id)
}

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("configuration is invalid", "error", err)
		os.Exit(1)
	}

	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel}))
	if err := run(cfg, logger); err != nil {
		logger.Error("server failed", "error", err)
		os.Exit(1)
	}
}

func run(cfg config.Config, logger *slog.Logger) error {
	keyOption, err := auth.NewCachedKeyOption(context.Background(), cfg.JWKSURL)
	if err != nil {
		return err
	}
	verifier := auth.NewVerifier(keyOption, auth.Config{
		Issuer:   cfg.JWTIssuer,
		Audience: cfg.JWTAudience,
	})

	pool, err := store.NewPostgresPool(context.Background(), cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	// The agent is entirely optional: absent OPENAI_API_KEY, agentService
	// stays nil and httpapi.NewRouter simply does not mount the route (the
	// same pattern every other resource above already follows).
	var agentService *agent.Service
	if cfg.Agent.Enabled {
		confirmationSecret := cfg.Agent.ConfirmationSecret
		if len(confirmationSecret) == 0 {
			confirmationSecret = make([]byte, 32)
			if _, err := rand.Read(confirmationSecret); err != nil {
				return err
			}
			logger.Warn("AGENT_CONFIRMATION_SECRET is unset; generated an ephemeral secret for this process. " +
				"Pending mutation confirmations will not survive a restart or land on a different instance. " +
				"Set AGENT_CONFIRMATION_SECRET explicitly in production.")
		}
		confirmer, err := agent.NewConfirmer(confirmationSecret, cfg.Agent.ConfirmationTTL)
		if err != nil {
			return err
		}

		client := openai.NewClient(option.WithAPIKey(cfg.Agent.APIKey))
		provider := agent.NewOpenAIProvider(&client, cfg.Agent.Model)
		combinedStore := &agentStore{
			accounts:     store.NewAccountRepository(pool),
			categories:   store.NewCategoryRepository(pool),
			transactions: store.NewTransactionRepository(pool),
		}
		agentService, err = agent.NewService(provider, combinedStore, confirmer, cfg.Agent)
		if err != nil {
			return err
		}
	}

	// WriteTimeout must never be tighter than the agent's own configured
	// deadline (bounded 5-120s, see config.AgentConfig), or the HTTP server
	// itself would cut off a legitimately slow-but-within-budget agent
	// response before the router's own agent-specific timeout even fires.
	// Raising it only loosens the ceiling for every other route; it never
	// tightens one, so this is safe regardless of whether the agent is
	// enabled.
	writeTimeout := 30 * time.Second
	if agentTimeoutMargin := cfg.Agent.Timeout + 10*time.Second; agentTimeoutMargin > writeTimeout {
		writeTimeout = agentTimeoutMargin
	}

	routerOptions := httpapi.Options{
		Database:              pool,
		AuthMiddleware:        verifier.Middleware,
		CORSOrigins:           cfg.CORSOrigins,
		Categories:            store.NewCategoryRepository(pool),
		Accounts:              store.NewAccountRepository(pool),
		Transactions:          store.NewTransactionRepository(pool),
		CreditCardStatements:  store.NewCreditCardStatementRepository(pool),
		Budgets:               store.NewBudgetRepository(pool),
		SavingsGoals:          store.NewSavingsGoalRepository(pool),
		Rules:                 store.NewRuleRepository(pool),
		MSIPurchases:          store.NewMSIPurchaseRepository(pool),
		RecurringTransactions: store.NewRecurringTransactionRepository(pool),
	}
	// Assigning agentService to the Agent interface field only when it is
	// genuinely non-nil avoids Go's classic typed-nil-in-interface trap: a
	// nil *agent.Service boxed into the interface unconditionally would make
	// `opts.Agent != nil` true in httpapi's router, wrongly mounting the
	// route (and then panicking on first use) whenever the agent is disabled.
	if agentService != nil {
		routerOptions.Agent = agentService
		routerOptions.AgentRouteTimeout = cfg.Agent.Timeout
	}

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           httpapi.NewRouter(routerOptions),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       120 * time.Second,
	}

	serverErr := make(chan error, 1)
	go func() {
		logger.Info("server starting", "addr", srv.Addr, "environment", cfg.Environment)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-serverErr:
		return err
	case sig := <-stop:
		logger.Info("shutdown signal received", "signal", sig.String())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		return err
	}
	logger.Info("server stopped cleanly")
	return nil
}
