package store_test

import (
	"context"
	"testing"
	"time"
)

func TestTransactionMoneyIntegrityMigrationDefaults(t *testing.T) {
	_, _ = setupPool(t, "public.transactions")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	admin := newAdminPool(t, ctx)
	defer admin.Close()

	var defaultExpression string
	if err := admin.QueryRow(ctx, `
		SELECT column_default
		FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'affects_balance'
	`).Scan(&defaultExpression); err != nil {
		t.Fatalf("query affects_balance default: %v", err)
	}
	if defaultExpression != "false" {
		t.Fatalf("affects_balance default = %q, want false", defaultExpression)
	}

	var idempotencyNullable string
	if err := admin.QueryRow(ctx, `
		SELECT is_nullable
		FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'idempotency_key'
	`).Scan(&idempotencyNullable); err != nil {
		t.Fatalf("query idempotency_key column: %v", err)
	}
	if idempotencyNullable != "YES" {
		t.Fatalf("idempotency_key is_nullable = %q, want YES", idempotencyNullable)
	}
}
