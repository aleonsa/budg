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

// These tests exercise the real SQL against an ephemeral database, connected
// as budg_api (see postgres_integration_test.go), so row-level security
// policies are actually in effect. They skip when TEST_DATABASE_URL is unset
// (the default unit-test run, and the default in CI: the migrations job
// validates schema reconstructibility but does not run Go tests against it).
// Point TEST_DATABASE_URL at a local Supabase stack's budg_api role
// (postgresql://budg_api:<password>@127.0.0.1:54322/postgres?sslmode=disable)
// to run these locally.
//
// budg_api has no grant on the auth schema (it never touches auth.users in
// production — Supabase Auth owns that table), so seeding/cleanup that needs
// superuser access goes through a separate admin connection. TEST_ADMIN_DATABASE_URL
// defaults to the local Supabase stack's well-known local superuser
// (matches the literal already used by .github/workflows/ci.yml's goose steps).

const defaultAdminDatabaseURL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable"

func adminDatabaseURL() string {
	if v := os.Getenv("TEST_ADMIN_DATABASE_URL"); v != "" {
		return v
	}
	return defaultAdminDatabaseURL
}

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

	admin := newAdminPool(t, ctx)
	defer admin.Close()

	userID := seedTestUser(t, ctx, admin)
	// Clean any leftover rows from a previous run so tests are idempotent.
	// This must run as admin too: budg_api's RLS policy denies unscoped
	// deletes (see TestCategoriesRLSDeniesUnscopedAccess), which is exactly
	// the point of this PR, so app-role cleanup would silently delete 0 rows.
	if _, err := admin.Exec(ctx, `DELETE FROM public.categories WHERE user_id = $1`, userID); err != nil {
		t.Fatalf("cleanup: %v", err)
	}
	return pool, userID
}

func seedTestUser(t *testing.T, ctx context.Context, admin *pgxpool.Pool) string {
	t.Helper()
	// auth.users is created by Supabase's auth schema migration; for local
	// tests we insert a deterministic row. The id is a stable uuidv4 literal
	// so multiple test runs do not collide.
	const id = "11111111-1111-1111-1111-111111111111"
	return seedAuthUser(t, ctx, admin, id, "test-category@budg.local")
}

func seedAuthUser(t *testing.T, ctx context.Context, admin *pgxpool.Pool, id, email string) string {
	t.Helper()
	_, err := admin.Exec(ctx, `
		INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
		VALUES ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
			$2, '', now(), now(), now())
		ON CONFLICT (id) DO NOTHING
	`, id, email)
	if err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	return id
}

// newAdminPool opens a short-lived superuser connection for test setup that
// budg_api is not (and should not be) granted for, such as inserting rows
// into auth.users. Callers must close it when done.
func newAdminPool(t *testing.T, ctx context.Context) *pgxpool.Pool {
	t.Helper()
	admin, err := store.NewPostgresPool(ctx, adminDatabaseURL())
	if err != nil {
		t.Fatalf("new admin postgres pool: %v", err)
	}
	return admin
}

func TestCategoryRepositoryCRUD(t *testing.T) {
	pool, userID := setupPool(t) // setupPool already cleaned leftover rows (as admin)
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
	pool, userID := setupPool(t) // setupPool already cleaned leftover rows (as admin)
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
	pool, userID := setupPool(t) // setupPool already cleaned leftover rows (as admin)
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
