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

func TestAccountRepositoryCRUD(t *testing.T) {
	pool, userID := setupPool(t, "public.accounts") // already cleaned leftover rows (as admin)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	repo := store.NewAccountRepository(pool)

	// Empty list to start.
	initial, err := repo.List(ctx, userID)
	if err != nil {
		t.Fatalf("list (initial): %v", err)
	}
	if len(initial) != 0 {
		t.Fatalf("expected empty list, got %d", len(initial))
	}

	// Create a debit account.
	balance := int64(1845000)
	created, err := repo.Create(ctx, userID, store.AccountInput{
		Name: "Nómina", Type: "debit", Institution: "BBVA", Last4: "4521",
		Currency: "MXN", BalanceCents: &balance,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created.ID == "" || created.UserID != userID || !created.IsActive {
		t.Fatalf("created row = %+v", created)
	}
	if created.BalanceCents == nil || *created.BalanceCents != balance {
		t.Fatalf("created balance = %+v, want %d", created.BalanceCents, balance)
	}
	if created.CreditLimitCents != nil {
		t.Fatalf("created credit limit = %+v, want nil for debit account", created.CreditLimitCents)
	}

	// List reflects the new row.
	got, err := repo.List(ctx, userID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(got) != 1 || got[0].ID != created.ID {
		t.Fatalf("list = %+v, want [%s]", got, created.ID)
	}

	// Update: rename and deactivate.
	newName := "Nómina BBVA"
	inactive := false
	updated, err := repo.Update(ctx, userID, created.ID, store.AccountPatch{
		Name: &newName, IsActive: &inactive,
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.Name != "Nómina BBVA" || updated.IsActive {
		t.Fatalf("updated = %+v, want name=Nómina BBVA isActive=false", updated)
	}
	// Balance untouched since the patch didn't mention it.
	if updated.BalanceCents == nil || *updated.BalanceCents != balance {
		t.Fatalf("updated balance = %+v, want unchanged %d", updated.BalanceCents, balance)
	}

	// Update missing row -> ErrNotFound.
	if _, err := repo.Update(ctx, userID, "00000000-0000-0000-0000-000000000000", store.AccountPatch{Name: &newName}); !errors.Is(err, store.ErrNotFound) {
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

func TestAccountRepositoryCreditAccountAndNullableClear(t *testing.T) {
	pool, userID := setupPool(t, "public.accounts") // already cleaned leftover rows (as admin)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	repo := store.NewAccountRepository(pool)

	creditLimit := int64(8000000)
	available := int64(5340000)
	cutDay, dueDay := 15, 5
	created, err := repo.Create(ctx, userID, store.AccountInput{
		Name: "Cred Platino", Type: "credit", Institution: "Santander", Last4: "1093",
		Currency: "MXN", CreditLimitCents: &creditLimit, AvailableCreditCents: &available,
		StatementCutDay: &cutDay, PaymentDueDay: &dueDay,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created.BalanceCents != nil {
		t.Fatalf("created balance = %+v, want nil for credit account", created.BalanceCents)
	}
	if created.StatementCutDay == nil || *created.StatementCutDay != cutDay {
		t.Fatalf("created statementCutDay = %+v, want %d", created.StatementCutDay, cutDay)
	}

	// Explicitly clear statementCutDay via Field[T]; leave paymentDueDay
	// untouched (omitted from the patch).
	updated, err := repo.Update(ctx, userID, created.ID, store.AccountPatch{
		StatementCutDay: store.Field[int]{Set: true, Value: nil},
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.StatementCutDay != nil {
		t.Fatalf("statementCutDay = %+v, want nil after explicit clear", updated.StatementCutDay)
	}
	if updated.PaymentDueDay == nil || *updated.PaymentDueDay != dueDay {
		t.Fatalf("paymentDueDay = %+v, want unchanged %d (patch omitted it)", updated.PaymentDueDay, dueDay)
	}
}

func TestAccountRepositoryIsolatesByUser(t *testing.T) {
	pool, userID := setupPool(t, "public.accounts") // already cleaned leftover rows (as admin)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	repo := store.NewAccountRepository(pool)
	if _, err := repo.Create(ctx, userID, store.AccountInput{
		Name: "Solo", Type: "debit", Institution: "Nu", Last4: "8830", Currency: "MXN",
	}); err != nil {
		t.Fatalf("create: %v", err)
	}

	// Another user cannot see the row.
	admin := newAdminPool(t, ctx)
	defer admin.Close()
	otherID := seedAuthUser(t, ctx, admin, "33333333-3333-3333-3333-333333333333", "test-account-alt@budg.local")

	otherList, err := repo.List(ctx, otherID)
	if err != nil {
		t.Fatalf("list as other user: %v", err)
	}
	if len(otherList) != 0 {
		t.Fatalf("other user saw %d rows, want 0", len(otherList))
	}
}

// TestAccountsRLSDeniesUnscopedAccess proves row-level security is a real,
// independent enforcement layer for accounts too: a raw query against the
// pool (bypassing store.RunScoped, so "app.user_id" is never set) must see
// zero rows even though the row exists and the connection authenticates as
// budg_api.
func TestAccountsRLSDeniesUnscopedAccess(t *testing.T) {
	pool, userID := setupPool(t, "public.accounts") // already cleaned leftover rows (as admin)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	repo := store.NewAccountRepository(pool)
	if _, err := repo.Create(ctx, userID, store.AccountInput{
		Name: "Unscoped", Type: "debit", Institution: "Nu", Last4: "0001", Currency: "MXN",
	}); err != nil {
		t.Fatalf("create: %v", err)
	}

	// Deliberately bypass RunScoped: no "app.user_id" is set on this
	// connection/transaction, so RLS must deny visibility by default.
	rows, err := pool.Query(ctx, `SELECT id FROM public.accounts WHERE user_id = $1`, userID)
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
