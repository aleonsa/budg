package store_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/aleonsa/budg/backend/internal/store"
)

func TestSavingsGoalRepositoryCRUD(t *testing.T) {
	pool, userID := setupPool(t, "public.savings_goals")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	repo := store.NewSavingsGoalRepository(pool)

	initial, err := repo.List(ctx, userID)
	if err != nil {
		t.Fatalf("list (initial): %v", err)
	}
	if len(initial) != 0 {
		t.Fatalf("expected empty list, got %d", len(initial))
	}

	created, err := repo.Create(ctx, userID, store.SavingsGoalInput{
		Name:          "Trip",
		TargetAmount:  50000,
		CurrentAmount: 5000,
		SortOrder:     0,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created.ID == "" || created.UserID != userID || created.TargetAmount != 50000 {
		t.Fatalf("created row = %+v", created)
	}

	got, err := repo.List(ctx, userID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(got) != 1 || got[0].ID != created.ID {
		t.Fatalf("list = %+v, want [%s]", got, created.ID)
	}

	newName := "Long Trip"
	updated, err := repo.Update(ctx, userID, created.ID, store.SavingsGoalPatch{
		Name: &newName,
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.Name != "Long Trip" {
		t.Fatalf("updated name = %q, want Long Trip", updated.Name)
	}

	if err := repo.Delete(ctx, userID, created.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if err := repo.Delete(ctx, userID, created.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("delete missing err = %v, want ErrNotFound", err)
	}
}

func TestSavingsGoalsRLSDeniesUnscopedAccess(t *testing.T) {
	pool, userID := setupPool(t, "public.savings_goals")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	repo := store.NewSavingsGoalRepository(pool)
	_, err := repo.Create(ctx, userID, store.SavingsGoalInput{
		Name:          "Unscoped",
		TargetAmount:  1000,
		CurrentAmount: 0,
		SortOrder:     0,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	rows, err := pool.Query(ctx, `SELECT id FROM public.savings_goals WHERE user_id = $1`, userID)
	if err != nil {
		t.Fatalf("unscoped query: %v", err)
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		count++
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate: %v", err)
	}
	if count != 0 {
		t.Fatalf("unscoped query saw %d rows, want 0 (RLS should deny without app.user_id set)", count)
	}
}
