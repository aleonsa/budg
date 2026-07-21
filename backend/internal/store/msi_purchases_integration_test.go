package store_test

import (
	"context"
	"testing"
	"time"

	"github.com/aleonsa/budg/backend/internal/store"
)

// msi_purchases has no repository Create method -- it is read-only end to
// end (see migrations/00008_create_msi_purchases.sql) -- so rows are seeded
// directly via the admin pool, mirroring how other integration tests seed
// FK dependencies (e.g. transactions_integration_test.go seeding accounts).
func TestMSIPurchaseRepositoryList(t *testing.T) {
	pool, userID := setupPool(t, "public.msi_purchases")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	accounts := store.NewAccountRepository(pool)
	account, err := accounts.Create(ctx, userID, store.AccountInput{
		Name:        "Credit Card",
		Type:        "credit",
		Institution: "BBVA",
		Last4:       "1234",
		Currency:    "MXN",
	})
	if err != nil {
		t.Fatalf("create account: %v", err)
	}

	repo := store.NewMSIPurchaseRepository(pool)

	initial, err := repo.List(ctx, userID)
	if err != nil {
		t.Fatalf("list (initial): %v", err)
	}
	if len(initial) != 0 {
		t.Fatalf("expected empty list, got %d", len(initial))
	}

	admin := newAdminPool(t, ctx)
	defer admin.Close()

	var seededID string
	err = admin.QueryRow(ctx, `
		INSERT INTO public.msi_purchases (
			user_id, account_id, description, merchant,
			total_amount, installment_amount, installment_count, installments_paid,
			start_date, next_installment_date, status
		)
		VALUES ($1, $2, 'Laptop', 'Apple Store', 120000, 10000, 12, 3, '2026-01-01', '2026-04-01', 'active')
		RETURNING id
	`, userID, account.ID).Scan(&seededID)
	if err != nil {
		t.Fatalf("seed msi purchase: %v", err)
	}

	got, err := repo.List(ctx, userID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(got) != 1 || got[0].ID != seededID {
		t.Fatalf("list = %+v, want [%s]", got, seededID)
	}
	if got[0].AccountID != account.ID {
		t.Fatalf("account id = %q, want %q", got[0].AccountID, account.ID)
	}
	if got[0].Description != "Laptop" || got[0].TotalAmount != 120000 {
		t.Fatalf("row = %+v", got[0])
	}
	if got[0].Merchant == nil || *got[0].Merchant != "Apple Store" {
		t.Fatalf("merchant = %+v, want Apple Store", got[0].Merchant)
	}
	if got[0].NextInstallmentDate == nil || *got[0].NextInstallmentDate != "2026-04-01" {
		t.Fatalf("nextInstallmentDate = %+v, want 2026-04-01", got[0].NextInstallmentDate)
	}
	if got[0].CategoryID != nil {
		t.Fatalf("categoryId = %+v, want nil", got[0].CategoryID)
	}
}

func TestMSIPurchasesRLSDeniesUnscopedAccess(t *testing.T) {
	pool, userID := setupPool(t, "public.msi_purchases")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	accounts := store.NewAccountRepository(pool)
	account, err := accounts.Create(ctx, userID, store.AccountInput{
		Name:        "Credit Card",
		Type:        "credit",
		Institution: "BBVA",
		Last4:       "5678",
		Currency:    "MXN",
	})
	if err != nil {
		t.Fatalf("create account: %v", err)
	}

	admin := newAdminPool(t, ctx)
	defer admin.Close()
	_, err = admin.Exec(ctx, `
		INSERT INTO public.msi_purchases (
			user_id, account_id, description,
			total_amount, installment_amount, installment_count, installments_paid,
			start_date, status
		)
		VALUES ($1, $2, 'Unscoped', 1200, 100, 12, 0, '2026-01-01', 'active')
	`, userID, account.ID)
	if err != nil {
		t.Fatalf("seed msi purchase: %v", err)
	}

	rows, err := pool.Query(ctx, `SELECT id FROM public.msi_purchases WHERE user_id = $1`, userID)
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
