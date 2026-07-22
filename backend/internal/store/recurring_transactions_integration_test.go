package store_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/aleonsa/budg/backend/internal/store"
)

func TestRecurringMaterializationAppliesBalanceExactlyOnce(t *testing.T) {
	pool, userID := setupPool(t, "public.recurring_transactions")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	admin := newAdminPool(t, ctx)
	defer admin.Close()

	balance := int64(10000)
	account, err := store.NewAccountRepository(pool).Create(ctx, userID, store.AccountInput{
		Name: "Recurring Account", Type: "debit", Institution: "Bank", Last4: "3001",
		Currency: "MXN", BalanceCents: &balance,
	})
	if err != nil {
		t.Fatalf("create account: %v", err)
	}
	if _, err := store.NewAccountRepository(pool).EnableBalanceTracking(ctx, userID, account.ID, balance); err != nil {
		t.Fatalf("enable balance tracking: %v", err)
	}
	repository := store.NewRecurringTransactionRepository(pool)
	today := time.Now().UTC().Format("2006-01-02")
	if _, err := repository.Create(ctx, userID, store.RecurringTransactionInput{
		AccountID: account.ID, Description: "Historical recurring test", Amount: 100,
		Frequency: "monthly", StartDate: today,
	}); err != nil {
		t.Fatalf("create recurring transaction: %v", err)
	}
	createdCounts := make(chan int, 2)
	errorsChannel := make(chan error, 2)
	var wait sync.WaitGroup
	for i := 0; i < 2; i++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			created, err := repository.Process(ctx, userID)
			createdCounts <- created
			errorsChannel <- err
		}()
	}
	wait.Wait()
	close(createdCounts)
	close(errorsChannel)
	totalCreated := 0
	for err := range errorsChannel {
		if err != nil {
			t.Fatalf("process recurring transaction: %v", err)
		}
	}
	for created := range createdCounts {
		totalCreated += created
	}
	if totalCreated != 1 {
		t.Fatalf("total created = %d, want 1", totalCreated)
	}

	var transactionID string
	var affectsBalance bool
	if err := admin.QueryRow(ctx, `
		SELECT id, affects_balance
		FROM public.transactions
		WHERE user_id = $1 AND account_id = $2 AND description = 'Historical recurring test'
	`, userID, account.ID).Scan(&transactionID, &affectsBalance); err != nil {
		t.Fatalf("query materialized transaction: %v", err)
	}
	if !affectsBalance {
		t.Fatal("recurring transaction affects_balance = false, want true")
	}
	assertAccountAmount(t, ctx, admin, account.ID, "balance_cents", 9900)
	assertTransactionLedger(t, ctx, admin, transactionID, map[string]int64{account.ID: -100})
}
