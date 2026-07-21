package store_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/aleonsa/budg/backend/internal/store"
)

func TestBudgetRepositoryCRUD(t *testing.T) {
	pool, userID := setupPool(t, "public.budgets")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	repo := store.NewBudgetRepository(pool)

	initial, err := repo.List(ctx, userID)
	if err != nil {
		t.Fatalf("list (initial): %v", err)
	}
	if len(initial) != 0 {
		t.Fatalf("expected empty list, got %d", len(initial))
	}

	created, err := repo.Create(ctx, userID, store.BudgetInput{
		Amount:    15000,
		Period:    "monthly",
		StartDate: "2026-07-01",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created.ID == "" || created.UserID != userID || created.Amount != 15000 {
		t.Fatalf("created row = %+v", created)
	}

	got, err := repo.List(ctx, userID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(got) != 1 || got[0].ID != created.ID {
		t.Fatalf("list = %+v, want [%s]", got, created.ID)
	}

	newAmt := int64(18000)
	updated, err := repo.Update(ctx, userID, created.ID, store.BudgetPatch{
		Amount: &newAmt,
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.Amount != 18000 {
		t.Fatalf("updated amount = %d, want 18000", updated.Amount)
	}

	if err := repo.Delete(ctx, userID, created.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if err := repo.Delete(ctx, userID, created.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("delete missing err = %v, want ErrNotFound", err)
	}
}

func TestBudgetsRLSDeniesUnscopedAccess(t *testing.T) {
	pool, userID := setupPool(t, "public.budgets")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	repo := store.NewBudgetRepository(pool)
	_, err := repo.Create(ctx, userID, store.BudgetInput{
		Amount:    1000,
		Period:    "monthly",
		StartDate: "2026-07-01",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	rows, err := pool.Query(ctx, `SELECT id FROM public.budgets WHERE user_id = $1`, userID)
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
