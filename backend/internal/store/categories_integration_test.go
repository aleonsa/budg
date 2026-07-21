package store_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/aleonsa/budg/backend/internal/store"
)

// These tests exercise the real SQL against an ephemeral database. They skip
// when TEST_DATABASE_URL is unset (the default unit-test run).
//
// The CI migrations job sets TEST_DATABASE_URL to a fresh Postgres with all
// Goose migrations applied and creates a test user in auth.users so that the
// foreign key on categories.user_id resolves.

func setupPool(t *testing.T) (*pgxpool.Pool, string) {
	t.Helper()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := store.NewPostgresPool(ctx, databaseURL)
	if err != nil {
		t.Fatalf("new postgres pool: %v", err)
	}
	t.Cleanup(pool.Close)

	userID := seedTestUser(t, ctx, pool)
	return pool, userID
}

func seedTestUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	// auth.users is created by Supabase's auth schema migration; for local
	// tests we insert a deterministic row. The id is a stable uuidv4 literal
	// so multiple test runs do not collide.
	const id = "11111111-1111-1111-1111-111111111111"
	_, err := pool.Exec(ctx, `
		INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
		VALUES ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
			'test-category@budg.local', '', now(), now(), now())
		ON CONFLICT (id) DO NOTHING
	`, id)
	if err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	return id
}

func TestCategoryRepositoryCRUD(t *testing.T) {
	pool, userID := setupPool(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Clean any leftover rows from a previous run so the test is idempotent.
	if _, err := pool.Exec(ctx, `DELETE FROM public.categories WHERE user_id = $1`, userID); err != nil {
		t.Fatalf("cleanup: %v", err)
	}

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
	pool, userID := setupPool(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer ctxWithCancel(ctx, cancel)
	defer cancel()

	if _, err := pool.Exec(ctx, `DELETE FROM public.categories WHERE user_id = $1`, userID); err != nil {
		t.Fatalf("cleanup: %v", err)
	}

	repo := store.NewCategoryRepository(pool)
	if _, err := repo.Create(ctx, userID, store.CategoryInput{
		Name: "Solo", Kind: "expense", Color: "red", Icon: "X", SortOrder: 0,
	}); err != nil {
		t.Fatalf("create: %v", err)
	}

	// Another user cannot see the row.
	otherID := seedTestUserAlt(t, ctx, pool)
	otherList, err := repo.List(ctx, otherID)
	if err != nil {
		t.Fatalf("list as other user: %v", err)
	}
	if len(otherList) != 0 {
		t.Fatalf("other user saw %d rows, want 0", len(otherList))
	}
}

func seedTestUserAlt(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	const id = "22222222-2222-2222-2222-222222222222"
	_, err := pool.Exec(ctx, `
		INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
		VALUES ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
			'test-category-alt@budg.local', '', now(), now(), now())
		ON CONFLICT (id) DO NOTHING
	`, id)
	if err != nil {
		t.Fatalf("seed auth.users alt: %v", err)
	}
	return id
}

// ctxWithCancel is a no-op kept so the defer order in callers is explicit
// without juggling imports.
func ctxWithCancel(_ context.Context, _ context.CancelFunc) {}
