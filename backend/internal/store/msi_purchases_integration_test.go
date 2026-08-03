package store_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/aleonsa/budg/backend/internal/store"
)

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

func TestMSIPurchaseRepositoryCreateSchedulesExactInstallments(t *testing.T) {
	pool, userID := setupPool(t, "public.msi_purchases")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	admin := newAdminPool(t, ctx)
	defer admin.Close()

	accounts := store.NewAccountRepository(pool)
	creditLimit, availableCredit := int64(200000), int64(200000)
	account, err := accounts.Create(ctx, userID, store.AccountInput{
		Name:                 "MSI Card",
		Type:                 "credit",
		Institution:          "BBVA",
		Last4:                "7890",
		Currency:             "MXN",
		CreditLimitCents:     &creditLimit,
		AvailableCreditCents: &availableCredit,
	})
	if err != nil {
		t.Fatalf("create account: %v", err)
	}
	if _, err := accounts.EnableBalanceTracking(ctx, userID, account.ID, availableCredit); err != nil {
		t.Fatalf("enable balance tracking: %v", err)
	}
	categories := store.NewCategoryRepository(pool)
	category, err := categories.Create(ctx, userID, store.CategoryInput{
		Name:  "Technology",
		Kind:  "expense",
		Color: "blue",
		Icon:  "Laptop",
	})
	if err != nil {
		t.Fatalf("create category: %v", err)
	}

	repo := store.NewMSIPurchaseRepository(pool)
	idempotencyKey := "msi-create-1"
	createInput := store.MSIPurchaseInput{
		AccountID:        account.ID,
		CategoryID:       &category.ID,
		Description:      "Laptop",
		TotalAmount:      100000,
		InstallmentCount: 3,
		StartDate:        "2026-01-31",
		IdempotencyKey:   &idempotencyKey,
	}
	created, err := repo.Create(ctx, userID, createInput)
	if err != nil {
		t.Fatalf("create msi purchase: %v", err)
	}
	if created.TotalAmount != 100000 || created.InstallmentAmount != 33333 || created.InstallmentCount != 3 {
		t.Fatalf("created purchase = %+v", created)
	}
	if created.NextInstallmentDate == nil || *created.NextInstallmentDate != "2026-01-31" {
		t.Fatalf("next installment date = %+v, want 2026-01-31", created.NextInstallmentDate)
	}

	var amounts []int64
	var dates []string
	rows, err := admin.Query(ctx, `
		SELECT amount, date::text, affects_balance
		FROM public.transactions
		WHERE user_id = $1 AND msi_purchase_id = $2
		ORDER BY date ASC
	`, userID, created.ID)
	if err != nil {
		t.Fatalf("query installments: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var amount int64
		var date string
		var affectsBalance bool
		if err := rows.Scan(&amount, &date, &affectsBalance); err != nil {
			t.Fatalf("scan installment: %v", err)
		}
		if affectsBalance {
			t.Fatal("MSI installment affects_balance = true, want false until lifecycle integration exists")
		}
		amounts = append(amounts, amount)
		dates = append(dates, date)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate installments: %v", err)
	}
	if got, want := len(amounts), 3; got != want {
		t.Fatalf("installment count = %d, want %d", got, want)
	}
	if amounts[0]+amounts[1]+amounts[2] != 100000 || amounts[0] != 33333 || amounts[1] != 33333 || amounts[2] != 33334 {
		t.Fatalf("amounts = %v, want [33333 33333 33334]", amounts)
	}
	if got, want := dates, []string{"2026-01-31", "2026-02-28", "2026-03-31"}; got[0] != want[0] || got[1] != want[1] || got[2] != want[2] {
		t.Fatalf("dates = %v, want %v", got, want)
	}

	assertAccountAmount(t, ctx, admin, account.ID, "available_credit_cents", 100000)
	replayed, err := repo.Create(ctx, userID, createInput)
	if err != nil {
		t.Fatalf("replay msi purchase: %v", err)
	}
	if replayed.ID != created.ID {
		t.Fatalf("replayed id = %q, want %q", replayed.ID, created.ID)
	}
	assertAccountAmount(t, ctx, admin, account.ID, "available_credit_cents", 100000)
	conflictingInput := createInput
	conflictingInput.TotalAmount = 110000
	if _, err := repo.Create(ctx, userID, conflictingInput); !errors.Is(err, store.ErrIdempotencyConflict) {
		t.Fatalf("idempotency conflict error = %v", err)
	}

	var entryKind string
	var entryDelta int64
	if err := admin.QueryRow(ctx, `
		SELECT kind, delta_cents
		FROM public.account_balance_entries
		WHERE user_id = $1 AND msi_purchase_id = $2
	`, userID, created.ID).Scan(&entryKind, &entryDelta); err != nil {
		t.Fatalf("query MSI balance entry: %v", err)
	}
	if entryKind != "msi_purchase" || entryDelta != -100000 {
		t.Fatalf("MSI balance entry = (%q, %d), want (msi_purchase, -100000)", entryKind, entryDelta)
	}

	var installmentID string
	if err := admin.QueryRow(ctx, `
		SELECT id
		FROM public.transactions
		WHERE user_id = $1 AND msi_purchase_id = $2
		ORDER BY date
		LIMIT 1
	`, userID, created.ID).Scan(&installmentID); err != nil {
		t.Fatalf("query installment id: %v", err)
	}
	transactions := store.NewTransactionRepository(pool)
	changedDescription := "Direct edit"
	if _, err := transactions.Update(ctx, userID, installmentID, store.TransactionPatch{Description: &changedDescription}); !errors.Is(err, store.ErrMSIInstallmentManaged) {
		t.Fatalf("direct installment update error = %v", err)
	}
	if err := transactions.Delete(ctx, userID, installmentID); !errors.Is(err, store.ErrMSIInstallmentManaged) {
		t.Fatalf("direct installment delete error = %v", err)
	}

	updated, err := repo.Update(ctx, userID, created.ID, store.MSIPurchaseInput{
		AccountID:        account.ID,
		CategoryID:       &category.ID,
		Description:      "Laptop Pro",
		TotalAmount:      120000,
		InstallmentCount: 4,
		StartDate:        "2026-02-28",
	})
	if err != nil {
		t.Fatalf("update msi purchase: %v", err)
	}
	if updated.Description != "Laptop Pro" || updated.InstallmentAmount != 30000 || updated.InstallmentCount != 4 {
		t.Fatalf("updated purchase = %+v", updated)
	}
	assertAccountAmount(t, ctx, admin, account.ID, "available_credit_cents", 80000)
	var installmentCount int
	var installmentTotal int64
	if err := admin.QueryRow(ctx, `
		SELECT count(*), COALESCE(sum(amount), 0)
		FROM public.transactions
		WHERE user_id = $1 AND msi_purchase_id = $2
	`, userID, created.ID).Scan(&installmentCount, &installmentTotal); err != nil {
		t.Fatalf("query updated installments: %v", err)
	}
	if installmentCount != 4 || installmentTotal != 120000 {
		t.Fatalf("updated installments = (%d, %d), want (4, 120000)", installmentCount, installmentTotal)
	}

	if err := repo.Delete(ctx, userID, created.ID); err != nil {
		t.Fatalf("delete msi purchase: %v", err)
	}
	assertAccountAmount(t, ctx, admin, account.ID, "available_credit_cents", 200000)
	if err := admin.QueryRow(ctx, `
		SELECT count(*)
		FROM public.transactions
		WHERE user_id = $1 AND msi_purchase_id = $2
	`, userID, created.ID).Scan(&installmentCount); err != nil {
		t.Fatalf("query deleted installments: %v", err)
	}
	if installmentCount != 0 {
		t.Fatalf("installments after delete = %d, want 0", installmentCount)
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
