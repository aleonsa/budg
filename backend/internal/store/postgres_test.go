package store_test

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/aleonsa/budg/backend/internal/store"
)

func TestNewPostgresPoolUsesServerlessLimits(t *testing.T) {
	t.Parallel()

	pool, err := store.NewPostgresPool(
		context.Background(),
		"postgresql://budg_api:secret@127.0.0.1:54329/postgres?sslmode=disable",
	)
	if err != nil {
		t.Fatalf("new postgres pool: %v", err)
	}
	defer pool.Close()

	cfg := pool.Config()
	if cfg.MinConns != 0 {
		t.Fatalf("min conns = %d, want 0", cfg.MinConns)
	}
	if cfg.MaxConns != 4 {
		t.Fatalf("max conns = %d, want 4", cfg.MaxConns)
	}
	if cfg.MaxConnIdleTime != 5*time.Minute {
		t.Fatalf("max idle time = %s, want 5m", cfg.MaxConnIdleTime)
	}
	if cfg.ConnConfig.ConnectTimeout != 5*time.Second {
		t.Fatalf("connect timeout = %s, want 5s", cfg.ConnConfig.ConnectTimeout)
	}
	if cfg.ConnConfig.DefaultQueryExecMode != pgx.QueryExecModeSimpleProtocol {
		t.Fatalf("query mode = %v, want simple protocol", cfg.ConnConfig.DefaultQueryExecMode)
	}
}

func TestNewPostgresPoolRejectsInvalidURL(t *testing.T) {
	t.Parallel()

	if _, err := store.NewPostgresPool(context.Background(), "://invalid"); err == nil {
		t.Fatal("new postgres pool accepted invalid URL")
	}
}
