package store

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RunScoped runs fn inside a transaction whose Postgres session is scoped to
// userID via the "app.user_id" setting, then commits. Row-level security
// policies (see migrations/00002_categories_rls_policies.sql) check that
// setting as a second, independent enforcement layer beneath repositories'
// explicit `WHERE user_id = $1` filtering: even a query that forgets its
// user_id filter cannot read or write another user's rows, because the
// database role (budg_api) no longer has BYPASSRLS.
//
// set_config's third argument (is_local = true) scopes the setting to the
// current transaction only, equivalent to SET LOCAL but parameterizable.
// fn must perform all of its work through the supplied tx, not r.pool
// directly, or it will run outside the scoped transaction and RLS will deny
// it by default. Policies compare current_setting('app.user_id', true)
// against user_id as text (not uuid) -- see
// migrations/00002_categories_rls_policies.sql for why.
func RunScoped(ctx context.Context, pool *pgxpool.Pool, userID string, fn func(ctx context.Context, tx pgx.Tx) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin scoped transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }() // no-op once committed

	if _, err := tx.Exec(ctx, `SELECT set_config('app.user_id', $1, true)`, userID); err != nil {
		return fmt.Errorf("set session user scope: %w", err)
	}

	if err := fn(ctx, tx); err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit scoped transaction: %w", err)
	}
	return nil
}

func NewPostgresPool(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database config: %w", err)
	}

	cfg.MinConns = 0
	cfg.MaxConns = 4
	cfg.MaxConnIdleTime = 5 * time.Minute
	cfg.MaxConnLifetime = 30 * time.Minute
	cfg.HealthCheckPeriod = time.Minute
	cfg.ConnConfig.ConnectTimeout = 5 * time.Second
	cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create database pool: %w", err)
	}
	return pool, nil
}
