package store_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/aleonsa/budg/backend/internal/store"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestBalanceAutomationLifecycle(t *testing.T) {
	pool, userID := setupPool(t, "public.transactions")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	admin := newAdminPool(t, ctx)
	defer admin.Close()

	accounts := store.NewAccountRepository(pool)
	transactions := store.NewTransactionRepository(pool)
	debitBalance := int64(10000)
	debit, err := accounts.Create(ctx, userID, store.AccountInput{
		Name: "Tracked Debit", Type: "debit", Institution: "Bank", Last4: "1001",
		Currency: "MXN", BalanceCents: &debitBalance,
	})
	if err != nil {
		t.Fatalf("create debit: %v", err)
	}
	creditLimit, availableCredit := int64(20000), int64(15000)
	credit, err := accounts.Create(ctx, userID, store.AccountInput{
		Name: "Tracked Credit", Type: "credit", Institution: "Bank", Last4: "1002",
		Currency: "MXN", CreditLimitCents: &creditLimit, AvailableCreditCents: &availableCredit,
	})
	if err != nil {
		t.Fatalf("create credit: %v", err)
	}
	untrackedBalance := int64(5000)
	untracked, err := accounts.Create(ctx, userID, store.AccountInput{
		Name: "Untracked", Type: "debit", Institution: "Bank", Last4: "1003",
		Currency: "MXN", BalanceCents: &untrackedBalance,
	})
	if err != nil {
		t.Fatalf("create untracked: %v", err)
	}
	usdBalance := int64(5000)
	usd, err := accounts.Create(ctx, userID, store.AccountInput{
		Name: "USD", Type: "debit", Institution: "Bank", Last4: "1004",
		Currency: "USD", BalanceCents: &usdBalance,
	})
	if err != nil {
		t.Fatalf("create USD: %v", err)
	}
	if _, err := accounts.EnableBalanceTracking(ctx, userID, debit.ID, debitBalance); err != nil {
		t.Fatalf("enable debit: %v", err)
	}
	if _, err := accounts.EnableBalanceTracking(ctx, userID, credit.ID, availableCredit); err != nil {
		t.Fatalf("enable credit: %v", err)
	}
	if _, err := accounts.EnableBalanceTracking(ctx, userID, debit.ID, debitBalance); !errors.Is(err, store.ErrBalanceTrackingAlreadyEnabled) {
		t.Fatalf("second enable error = %v, want ErrBalanceTrackingAlreadyEnabled", err)
	}
	if _, err := accounts.ReconcileBalance(ctx, userID, untracked.ID, untrackedBalance); !errors.Is(err, store.ErrBalanceTrackingNotEnabled) {
		t.Fatalf("untracked reconcile error = %v, want ErrBalanceTrackingNotEnabled", err)
	}
	newCreditLimit := int64(25000)
	updatedCredit, err := accounts.Update(ctx, userID, credit.ID, store.AccountPatch{
		CreditLimitCents: store.Field[int64]{Set: true, Value: &newCreditLimit},
	})
	if err != nil {
		t.Fatalf("update tracked credit limit: %v", err)
	}
	if updatedCredit.CreditLimitCents == nil || *updatedCredit.CreditLimitCents != newCreditLimit ||
		updatedCredit.AvailableCreditCents == nil || *updatedCredit.AvailableCreditCents != 20000 {
		t.Fatalf("updated tracked credit = %+v", updatedCredit)
	}
	tooLowLimit := int64(4000)
	overLimitCredit, err := accounts.Update(ctx, userID, credit.ID, store.AccountPatch{
		CreditLimitCents: store.Field[int64]{Set: true, Value: &tooLowLimit},
	})
	if err != nil {
		t.Fatalf("lower tracked credit limit below debt: %v", err)
	}
	if overLimitCredit.CreditLimitCents == nil || *overLimitCredit.CreditLimitCents != tooLowLimit ||
		overLimitCredit.AvailableCreditCents == nil || *overLimitCredit.AvailableCreditCents != -1000 {
		t.Fatalf("over-limit tracked credit = %+v, want limit 4000 and available -1000", overLimitCredit)
	}
	assertAccountAmount(t, ctx, admin, credit.ID, "available_credit_cents", -1000)
	restoredCredit, err := accounts.Update(ctx, userID, credit.ID, store.AccountPatch{
		CreditLimitCents: store.Field[int64]{Set: true, Value: &newCreditLimit},
	})
	if err != nil {
		t.Fatalf("restore tracked credit limit: %v", err)
	}
	if restoredCredit.AvailableCreditCents == nil || *restoredCredit.AvailableCreditCents != 20000 {
		t.Fatalf("restored tracked credit = %+v, want available 20000", restoredCredit)
	}
	if _, err := accounts.Update(ctx, userID, credit.ID, store.AccountPatch{
		AvailableCreditCents: store.Field[int64]{Set: true, Value: int64Pointer(123)},
	}); !errors.Is(err, store.ErrDirectBalancePatchForbidden) {
		t.Fatalf("direct tracked available-credit patch error = %v", err)
	}

	created, err := transactions.Create(ctx, userID, store.TransactionInput{
		AccountID: debit.ID, Type: "expense", Amount: 1500,
		Date: "2026-07-22", Description: "Purchase",
	})
	if err != nil {
		t.Fatalf("create expense: %v", err)
	}
	if !created.AffectsBalance {
		t.Fatal("omitted affectsBalance defaulted false, want true")
	}
	assertAccountAmount(t, ctx, admin, debit.ID, "balance_cents", 8500)
	assertTransactionLedger(t, ctx, admin, created.ID, map[string]int64{debit.ID: -1500})

	newAmount := int64(2000)
	if _, err := transactions.Update(ctx, userID, created.ID, store.TransactionPatch{Amount: &newAmount}); err != nil {
		t.Fatalf("update amount: %v", err)
	}
	assertAccountAmount(t, ctx, admin, debit.ID, "balance_cents", 8000)
	assertTransactionLedger(t, ctx, admin, created.ID, map[string]int64{debit.ID: -2000})

	if _, err := transactions.Update(ctx, userID, created.ID, store.TransactionPatch{AccountID: &credit.ID}); err != nil {
		t.Fatalf("move expense to credit: %v", err)
	}
	assertAccountAmount(t, ctx, admin, debit.ID, "balance_cents", 10000)
	assertAccountAmount(t, ctx, admin, credit.ID, "available_credit_cents", 18000)
	assertTransactionLedger(t, ctx, admin, created.ID, map[string]int64{credit.ID: -2000})

	falseValue := false
	if _, err := transactions.Update(ctx, userID, created.ID, store.TransactionPatch{AffectsBalance: &falseValue}); err != nil {
		t.Fatalf("disable balance effect: %v", err)
	}
	assertAccountAmount(t, ctx, admin, credit.ID, "available_credit_cents", 20000)
	assertTransactionLedger(t, ctx, admin, created.ID, nil)

	trueValue := true
	if _, err := transactions.Update(ctx, userID, created.ID, store.TransactionPatch{AffectsBalance: &trueValue}); err != nil {
		t.Fatalf("enable balance effect: %v", err)
	}
	assertAccountAmount(t, ctx, admin, credit.ID, "available_credit_cents", 18000)
	if err := transactions.Delete(ctx, userID, created.ID); err != nil {
		t.Fatalf("delete expense: %v", err)
	}
	assertAccountAmount(t, ctx, admin, credit.ID, "available_credit_cents", 20000)
	if err := transactions.Delete(ctx, userID, created.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("second delete error = %v, want ErrNotFound", err)
	}
	assertAccountAmount(t, ctx, admin, credit.ID, "available_credit_cents", 20000)

	transfer, err := transactions.Create(ctx, userID, store.TransactionInput{
		AccountID: debit.ID, Type: "transfer", Amount: 1000,
		Date: "2026-07-22", Description: "Card payment", TransferToAccount: &credit.ID,
	})
	if err != nil {
		t.Fatalf("create transfer: %v", err)
	}
	assertAccountAmount(t, ctx, admin, debit.ID, "balance_cents", 9000)
	assertAccountAmount(t, ctx, admin, credit.ID, "available_credit_cents", 21000)
	assertTransactionLedger(t, ctx, admin, transfer.ID, map[string]int64{debit.ID: -1000, credit.ID: 1000})
	if err := transactions.Delete(ctx, userID, transfer.ID); err != nil {
		t.Fatalf("delete transfer: %v", err)
	}

	oneSided, err := transactions.Create(ctx, userID, store.TransactionInput{
		AccountID: debit.ID, Type: "transfer", Amount: 500,
		Date: "2026-07-22", Description: "One-sided", TransferToAccount: &untracked.ID,
	})
	if err != nil {
		t.Fatalf("create one-sided transfer: %v", err)
	}
	assertAccountAmount(t, ctx, admin, debit.ID, "balance_cents", 9500)
	assertAccountAmount(t, ctx, admin, untracked.ID, "balance_cents", 5000)
	assertTransactionLedger(t, ctx, admin, oneSided.ID, map[string]int64{debit.ID: -500})

	historical := false
	before := 9500
	history, err := transactions.Create(ctx, userID, store.TransactionInput{
		AccountID: debit.ID, Type: "income", Amount: 999,
		Date: "2026-07-22", Description: "History", AffectsBalance: &historical,
	})
	if err != nil {
		t.Fatalf("create history: %v", err)
	}
	assertAccountAmount(t, ctx, admin, debit.ID, "balance_cents", int64(before))
	assertTransactionLedger(t, ctx, admin, history.ID, nil)

	if _, err := transactions.Create(ctx, userID, store.TransactionInput{
		AccountID: debit.ID, Type: "transfer", Amount: 100,
		Date: "2026-07-22", Description: "Cross currency", TransferToAccount: &usd.ID,
	}); !errors.Is(err, store.ErrTransferCurrencyMismatch) {
		t.Fatalf("cross-currency error = %v, want ErrTransferCurrencyMismatch", err)
	}
	var crossCurrencyRows int
	if err := admin.QueryRow(ctx, `SELECT count(*) FROM public.transactions WHERE user_id = $1 AND description = 'Cross currency'`, userID).Scan(&crossCurrencyRows); err != nil {
		t.Fatalf("count cross-currency transactions: %v", err)
	}
	if crossCurrencyRows != 0 {
		t.Fatalf("cross-currency transaction count = %d, want 0", crossCurrencyRows)
	}

	if _, err := accounts.Update(ctx, userID, debit.ID, store.AccountPatch{
		BalanceCents: store.Field[int64]{Set: true, Value: int64Pointer(123)},
	}); !errors.Is(err, store.ErrDirectBalancePatchForbidden) {
		t.Fatalf("direct tracked balance patch error = %v", err)
	}
	reconciled, err := accounts.ReconcileBalance(ctx, userID, debit.ID, 12000)
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if reconciled.BalanceCents == nil || *reconciled.BalanceCents != 12000 {
		t.Fatalf("reconciled balance = %+v, want 12000", reconciled.BalanceCents)
	}
}

func TestTransactionMetadataPatchDoesNotApplyOrChurnBalances(t *testing.T) {
	pool, userID := setupPool(t, "public.transactions")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	admin := newAdminPool(t, ctx)
	defer admin.Close()

	accounts := store.NewAccountRepository(pool)
	transactions := store.NewTransactionRepository(pool)
	untrackedAmount := int64(10000)
	untracked, err := accounts.Create(ctx, userID, store.AccountInput{
		Name: "Late activation metadata", Type: "debit", Institution: "Bank", Last4: "4001",
		Currency: "MXN", BalanceCents: &untrackedAmount,
	})
	if err != nil {
		t.Fatalf("create untracked account: %v", err)
	}
	createdWhileUntracked, err := transactions.Create(ctx, userID, store.TransactionInput{
		AccountID: untracked.ID, Type: "expense", Amount: 1200,
		Date: "2026-07-22", Description: "Before tracking",
	})
	if err != nil {
		t.Fatalf("create before tracking: %v", err)
	}
	assertTransactionLedger(t, ctx, admin, createdWhileUntracked.ID, nil)
	if _, err := accounts.EnableBalanceTracking(ctx, userID, untracked.ID, untrackedAmount); err != nil {
		t.Fatalf("enable tracking: %v", err)
	}
	newDescription := "Edited after tracking"
	if _, err := transactions.Update(ctx, userID, createdWhileUntracked.ID, store.TransactionPatch{Description: &newDescription}); err != nil {
		t.Fatalf("metadata update after tracking: %v", err)
	}
	assertAccountAmount(t, ctx, admin, untracked.ID, "balance_cents", untrackedAmount)
	assertTransactionLedger(t, ctx, admin, createdWhileUntracked.ID, nil)

	trackedTransaction, err := transactions.Create(ctx, userID, store.TransactionInput{
		AccountID: untracked.ID, Type: "expense", Amount: 300,
		Date: "2026-07-22", Description: "Tracked expense",
	})
	if err != nil {
		t.Fatalf("create tracked transaction: %v", err)
	}
	assertAccountAmount(t, ctx, admin, untracked.ID, "balance_cents", 9700)
	assertTransactionLedger(t, ctx, admin, trackedTransaction.ID, map[string]int64{untracked.ID: -300})
	trackedDescription := "Tracked expense renamed"
	if _, err := transactions.Update(ctx, userID, trackedTransaction.ID, store.TransactionPatch{Description: &trackedDescription}); err != nil {
		t.Fatalf("tracked metadata update: %v", err)
	}
	assertAccountAmount(t, ctx, admin, untracked.ID, "balance_cents", 9700)
	assertTransactionLedger(t, ctx, admin, trackedTransaction.ID, map[string]int64{untracked.ID: -300})
}

func TestTransactionCreateIdempotency(t *testing.T) {
	pool, userID := setupPool(t, "public.transactions")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	admin := newAdminPool(t, ctx)
	defer admin.Close()

	initial := int64(10000)
	accounts := store.NewAccountRepository(pool)
	account, err := accounts.Create(ctx, userID, store.AccountInput{
		Name: "Idempotent payments", Type: "debit", Institution: "Bank", Last4: "4002",
		Currency: "MXN", BalanceCents: &initial,
	})
	if err != nil {
		t.Fatalf("create account: %v", err)
	}
	if _, err := accounts.EnableBalanceTracking(ctx, userID, account.ID, initial); err != nil {
		t.Fatalf("enable tracking: %v", err)
	}
	repository := store.NewTransactionRepository(pool)
	sequentialKey := "sequential-payment"
	input := store.TransactionInput{
		AccountID: account.ID, Type: "expense", Amount: 700,
		Date: "2026-07-22", Description: "Sequential payment", IdempotencyKey: &sequentialKey,
	}
	first, err := repository.Create(ctx, userID, input)
	if err != nil {
		t.Fatalf("first create: %v", err)
	}
	second, err := repository.Create(ctx, userID, input)
	if err != nil {
		t.Fatalf("sequential retry: %v", err)
	}
	if second.ID != first.ID {
		t.Fatalf("sequential retry id = %s, want %s", second.ID, first.ID)
	}
	assertAccountAmount(t, ctx, admin, account.ID, "balance_cents", 9300)
	assertTransactionLedger(t, ctx, admin, first.ID, map[string]int64{account.ID: -700})
	otherUserID := seedAuthUser(t, ctx, admin, "55555555-5555-5555-5555-555555555555", "idempotency-other@budg.local")
	otherAccount, err := accounts.Create(ctx, otherUserID, store.AccountInput{
		Name: "Other idempotent payments", Type: "debit", Institution: "Bank", Last4: "4003",
		Currency: "MXN", BalanceCents: &initial,
	})
	if err != nil {
		t.Fatalf("create other user account: %v", err)
	}
	if _, err := accounts.EnableBalanceTracking(ctx, otherUserID, otherAccount.ID, initial); err != nil {
		t.Fatalf("enable other user tracking: %v", err)
	}
	otherInput := input
	otherInput.AccountID = otherAccount.ID
	otherTransaction, err := repository.Create(ctx, otherUserID, otherInput)
	if err != nil {
		t.Fatalf("reuse key for other user: %v", err)
	}
	if otherTransaction.ID == first.ID {
		t.Fatalf("other user transaction reused id %s", first.ID)
	}
	assertAccountAmount(t, ctx, admin, otherAccount.ID, "balance_cents", 9300)
	different := input
	different.Amount = 701
	if _, err := repository.Create(ctx, userID, different); !errors.Is(err, store.ErrIdempotencyConflict) {
		t.Fatalf("different retry error = %v, want ErrIdempotencyConflict", err)
	}
	assertAccountAmount(t, ctx, admin, account.ID, "balance_cents", 9300)

	concurrentKey := "concurrent-payment"
	concurrentInput := store.TransactionInput{
		AccountID: account.ID, Type: "expense", Amount: 300,
		Date: "2026-07-22", Description: "Concurrent payment", IdempotencyKey: &concurrentKey,
	}
	ids := make(chan string, 2)
	errs := make(chan error, 2)
	var wait sync.WaitGroup
	for i := 0; i < 2; i++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			created, err := repository.Create(ctx, userID, concurrentInput)
			if err == nil {
				ids <- created.ID
			}
			errs <- err
		}()
	}
	wait.Wait()
	close(ids)
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent retry: %v", err)
		}
	}
	var concurrentID string
	for id := range ids {
		if concurrentID == "" {
			concurrentID = id
		} else if id != concurrentID {
			t.Fatalf("concurrent retry ids differ: %s and %s", concurrentID, id)
		}
	}
	assertAccountAmount(t, ctx, admin, account.ID, "balance_cents", 9000)
	assertTransactionLedger(t, ctx, admin, concurrentID, map[string]int64{account.ID: -300})
}

func TestConcurrentOppositeTransfers(t *testing.T) {
	pool, userID := setupPool(t, "public.transactions")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	admin := newAdminPool(t, ctx)
	defer admin.Close()
	accounts := store.NewAccountRepository(pool)
	transactions := store.NewTransactionRepository(pool)
	initial := int64(10000)
	first, err := accounts.Create(ctx, userID, store.AccountInput{
		Name: "Concurrent A", Type: "debit", Institution: "Bank", Last4: "2001", Currency: "MXN", BalanceCents: &initial,
	})
	if err != nil {
		t.Fatalf("create first: %v", err)
	}
	second, err := accounts.Create(ctx, userID, store.AccountInput{
		Name: "Concurrent B", Type: "debit", Institution: "Bank", Last4: "2002", Currency: "MXN", BalanceCents: &initial,
	})
	if err != nil {
		t.Fatalf("create second: %v", err)
	}
	if _, err := accounts.EnableBalanceTracking(ctx, userID, first.ID, initial); err != nil {
		t.Fatalf("enable first: %v", err)
	}
	if _, err := accounts.EnableBalanceTracking(ctx, userID, second.ID, initial); err != nil {
		t.Fatalf("enable second: %v", err)
	}

	inputs := []store.TransactionInput{
		{AccountID: first.ID, Type: "transfer", Amount: 100, Date: "2026-07-22", Description: "A to B", TransferToAccount: &second.ID},
		{AccountID: second.ID, Type: "transfer", Amount: 100, Date: "2026-07-22", Description: "B to A", TransferToAccount: &first.ID},
	}
	var wait sync.WaitGroup
	errorsChannel := make(chan error, len(inputs))
	for _, input := range inputs {
		input := input
		wait.Add(1)
		go func() {
			defer wait.Done()
			_, err := transactions.Create(ctx, userID, input)
			errorsChannel <- err
		}()
	}
	wait.Wait()
	close(errorsChannel)
	for err := range errorsChannel {
		if err != nil {
			t.Fatalf("concurrent transfer: %v", err)
		}
	}
	assertAccountAmount(t, ctx, admin, first.ID, "balance_cents", initial)
	assertAccountAmount(t, ctx, admin, second.ID, "balance_cents", initial)
}

func assertAccountAmount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, accountID, column string, want int64) {
	t.Helper()
	var got int64
	query := "SELECT " + column + " FROM public.accounts WHERE id = $1"
	if err := pool.QueryRow(ctx, query, accountID).Scan(&got); err != nil {
		t.Fatalf("query %s for account %s: %v", column, accountID, err)
	}
	if got != want {
		t.Fatalf("%s for account %s = %d, want %d", column, accountID, got, want)
	}
}

func assertTransactionLedger(t *testing.T, ctx context.Context, pool *pgxpool.Pool, transactionID string, want map[string]int64) {
	t.Helper()
	rows, err := pool.Query(ctx, `
		SELECT account_id, delta_cents
		FROM public.account_balance_entries
		WHERE transaction_id = $1
	`, transactionID)
	if err != nil {
		t.Fatalf("query ledger: %v", err)
	}
	defer rows.Close()
	got := make(map[string]int64)
	for rows.Next() {
		var accountID string
		var delta int64
		if err := rows.Scan(&accountID, &delta); err != nil {
			t.Fatalf("scan ledger: %v", err)
		}
		got[accountID] = delta
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate ledger: %v", err)
	}
	if len(got) != len(want) {
		t.Fatalf("ledger = %v, want %v", got, want)
	}
	for accountID, delta := range want {
		if got[accountID] != delta {
			t.Fatalf("ledger = %v, want %v", got, want)
		}
	}
}

func int64Pointer(value int64) *int64 { return &value }
