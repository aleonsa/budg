package store_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/aleonsa/budg/backend/internal/store"
)

// Shared fixtures (setupPool, seedAuthUser, newAdminPool, ...) live in
// integration_helpers_test.go.

func TestCategoryRepositoryCRUD(t *testing.T) {
	pool, userID := setupPool(t, "public.categories") // already cleaned leftover rows (as admin)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	repo := store.NewCategoryRepository(pool)

	// Empty list to start.
	initial, err := repo.List(ctx, userID)
	if err != nil {
		t.Fatalf("list (initial): %v", err)
	}
	if len(initial) != 0 {
		t.Fatalf("expected empty list, got %d", len(initial))
	}

	// Create.
	created, err := repo.Create(ctx, userID, store.CategoryInput{
		Name: "Food", Kind: "expense", Color: "blue", Icon: "Utensils", SortOrder: 2,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created.ID == "" || created.UserID != userID || created.IsSystem {
		t.Fatalf("created row = %+v", created)
	}

	// List reflects the new row.
	got, err := repo.List(ctx, userID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(got) != 1 || got[0].ID != created.ID {
		t.Fatalf("list = %+v, want [%s]", got, created.ID)
	}

	// Update.
	newName := "Groceries"
	updated, err := repo.Update(ctx, userID, created.ID, store.CategoryPatch{Name: &newName, SortOrder: nil})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.Name != "Groceries" {
		t.Fatalf("updated name = %q, want Groceries", updated.Name)
	}

	// Update missing row -> ErrNotFound.
	if _, err := repo.Update(ctx, userID, "00000000-0000-0000-0000-000000000000", store.CategoryPatch{Name: &newName}); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("update missing err = %v, want ErrNotFound", err)
	}

	// Delete.
	if err := repo.Delete(ctx, userID, created.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if err := repo.Delete(ctx, userID, created.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("delete missing err = %v, want ErrNotFound", err)
	}
}

func TestCategoryRepositoryIsolatesByUser(t *testing.T) {
	pool, userID := setupPool(t, "public.categories") // already cleaned leftover rows (as admin)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	repo := store.NewCategoryRepository(pool)
	if _, err := repo.Create(ctx, userID, store.CategoryInput{
		Name: "Solo", Kind: "expense", Color: "red", Icon: "X", SortOrder: 0,
	}); err != nil {
		t.Fatalf("create: %v", err)
	}

	// Another user cannot see the row.
	admin := newAdminPool(t, ctx)
	defer admin.Close()
	otherID := seedAuthUser(t, ctx, admin, "22222222-2222-2222-2222-222222222222", "test-category-alt@budg.local")

	otherList, err := repo.List(ctx, otherID)
	if err != nil {
		t.Fatalf("list as other user: %v", err)
	}
	if len(otherList) != 0 {
		t.Fatalf("other user saw %d rows, want 0", len(otherList))
	}
}

// TestCategoriesRLSDeniesUnscopedAccess proves row-level security is a real,
// independent enforcement layer: a raw query against the pool (bypassing
// store.RunScoped, so "app.user_id" is never set) must see zero rows even
// though the row exists and the connection authenticates as budg_api. This
// is what distinguishes RLS from the app already filtering by user_id in
// its own WHERE clause — this query has no such filter.
func TestCategoriesRLSDeniesUnscopedAccess(t *testing.T) {
	pool, userID := setupPool(t, "public.categories") // already cleaned leftover rows (as admin)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	repo := store.NewCategoryRepository(pool)
	if _, err := repo.Create(ctx, userID, store.CategoryInput{
		Name: "Unscoped", Kind: "expense", Color: "gray", Icon: "X", SortOrder: 0,
	}); err != nil {
		t.Fatalf("create: %v", err)
	}

	// Deliberately bypass RunScoped: no "app.user_id" is set on this
	// connection/transaction, so RLS must deny visibility by default.
	rows, err := pool.Query(ctx, `SELECT id FROM public.categories WHERE user_id = $1`, userID)
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
