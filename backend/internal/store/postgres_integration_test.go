package store_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/aleonsa/budg/backend/internal/store"
)

func TestPostgresPoolIntegration(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	pool, err := store.NewPostgresPool(ctx, databaseURL)
	if err != nil {
		t.Fatalf("new postgres pool: %v", err)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("ping postgres: %v", err)
	}

	var currentUser string
	if err := pool.QueryRow(ctx, "select current_user").Scan(&currentUser); err != nil {
		t.Fatalf("query current user: %v", err)
	}
	if currentUser != "budg_api" {
		t.Fatalf("current user = %q, want budg_api", currentUser)
	}
}
