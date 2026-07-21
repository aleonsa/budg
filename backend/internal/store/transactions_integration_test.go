package store_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/aleonsa/budg/backend/internal/store"
)

func TestTransactionRepositoryCRUD(t *testing.T) {
	pool, userID := setupPool(t, "public.transactions")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Seed an account required by transaction FK.
	admin := newAdminPool(t, ctx)
	defer admin.Close()
	_, err := admin.Exec(ctx, `
		INSERT INTO public.accounts (id, user_id, name, type, institution, last4, currency, balance_cents)
		VALUES ('11111111-2222-3333-4444-555555555555', $1, 'Checking', 'debit', 'BBVA', '4521', 'MXN', 10000)
		ON CONFLICT DO NOTHING
	`, userID)
	if err != nil {
		t.Fatalf("seed account for tx test: %v", err)
	}

	repo := store.NewTransactionRepository(pool)

	initial, err := repo.List(ctx, userID)
	if err != nil {
		t.Fatalf("list (initial): %v", err)
	}
	if len(initial) != 0 {
		t.Fatalf("expected empty list, got %d", len(initial))
	}

	created, err := repo.Create(ctx, userID, store.TransactionInput{
		AccountID:   "11111111-2222-3333-4444-555555555555",
		Type:        "expense",
		Amount:      2500,
		Date:        "2026-07-21",
		Description: "Tacos",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created.ID == "" || created.UserID != userID || created.Amount != 2500 {
		t.Fatalf("created row = %+v", created)
	}

	got, err := repo.List(ctx, userID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(got) != 1 || got[0].ID != created.ID {
		t.Fatalf("list = %+v, want [%s]", got, created.ID)
	}

	newDesc := "Tacos al pastor"
	reconciled := true
	updated, err := repo.Update(ctx, userID, created.ID, store.TransactionPatch{
		Description:  &newDesc,
		IsReconciled: &reconciled,
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.Description != "Tacos al pastor" || !updated.IsReconciled {
		t.Fatalf("updated = %+v", updated)
	}

	if err := repo.Delete(ctx, userID, created.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if err := repo.Delete(ctx, userID, created.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("delete missing err = %v, want ErrNotFound", err)
	}
}

func TestTransactionsRLSDeniesUnscopedAccess(t *testing.T) {
	pool, userID := setupPool(t, "public.transactions")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	admin := newAdminPool(t, ctx)
	defer admin.Close()
	_, _ = admin.Exec(ctx, `
		INSERT INTO public.accounts (id, user_id, name, type, institution, last4, currency, balance_cents)
		VALUES ('22222222-3333-4444-5555-666666666666', $1, 'Checking', 'debit', 'BBVA', '4521', 'MXN', 10000)
		ON CONFLICT DO NOTHING
	`, userID)

	repo := store.NewTransactionRepository(pool)
	_, err := repo.Create(ctx, userID, store.TransactionInput{
		AccountID:   "22222222-3333-4444-5555-666666666666",
		Type:        "expense",
		Amount:      100,
		Date:        "2026-07-21",
		Description: "Unscoped",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	rows, err := pool.Query(ctx, `SELECT id FROM public.transactions WHERE user_id = $1`, userID)
	if err != nil {
		t.Fatalf("unscoped query: %v", err)
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		count++
	}
	if count != 0 {
		t.Fatalf("unscoped query saw %d rows, want 0 (RLS should deny without app.user_id set)", count)
	}
}
