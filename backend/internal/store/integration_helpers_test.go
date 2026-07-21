package store_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/aleonsa/budg/backend/internal/store"
)

// Shared fixtures for the *_integration_test.go files. These tests exercise
// the real SQL against an ephemeral database, connected as budg_api (see
// postgres_integration_test.go), so row-level security policies are
// actually in effect. They skip when TEST_DATABASE_URL is unset (the
// default unit-test run, and the default in CI: the migrations job
// validates schema reconstructibility but does not run Go tests against
// it). Point TEST_DATABASE_URL at a local Supabase stack's budg_api role
// (postgresql://budg_api:<password>@127.0.0.1:54322/postgres?sslmode=disable)
// to run these locally.
//
// budg_api has no grant on the auth schema (it never touches auth.users in
// production — Supabase Auth owns that table), so seeding/cleanup that needs
// superuser access goes through a separate admin connection.
// TEST_ADMIN_DATABASE_URL defaults to the local Supabase stack's
// well-known local superuser (matches the literal already used by
// .github/workflows/ci.yml's goose steps).

const defaultAdminDatabaseURL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable"

func adminDatabaseURL() string {
	if v := os.Getenv("TEST_ADMIN_DATABASE_URL"); v != "" {
		return v
	}
	return defaultAdminDatabaseURL
}

// setupPool opens a pool authenticated as TEST_DATABASE_URL's role (skips
// the test if unset), seeds a deterministic test user in auth.users, and
// cleans any leftover rows from a previous run in cleanupTable so tests are
// idempotent. Cleanup must run as admin: budg_api's RLS policy denies
// unscoped deletes by design (see TestCategoriesRLSDeniesUnscopedAccess /
// TestAccountsRLSDeniesUnscopedAccess), so app-role cleanup would silently
// delete 0 rows.
func setupPool(t *testing.T, cleanupTable string) (*pgxpool.Pool, string) {
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
	if _, err := admin.Exec(ctx, `DELETE FROM `+cleanupTable+` WHERE user_id = $1`, userID); err != nil {
		t.Fatalf("cleanup %s: %v", cleanupTable, err)
	}
	return pool, userID
}

func seedTestUser(t *testing.T, ctx context.Context, admin *pgxpool.Pool) string {
	t.Helper()
	// auth.users is created by Supabase's auth schema migration; for local
	// tests we insert a deterministic row. The id is a stable uuidv4 literal
	// so multiple test runs do not collide.
	const id = "11111111-1111-1111-1111-111111111111"
	return seedAuthUser(t, ctx, admin, id, "test-user@budg.local")
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
