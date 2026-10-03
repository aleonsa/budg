package store_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/aleonsa/budg/backend/internal/store"
)

func TestYieldReconciliationLifecycle(t *testing.T) {
	pool, userID := setupPool(t, "public.account_yield_reconciliations")
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	admin := newAdminPool(t, ctx)
	t.Cleanup(admin.Close)
	cleanup := func() {
		for _, statement := range []string{
			`DELETE FROM public.account_yield_reconciliations WHERE user_id = $1`,
			`DELETE FROM public.savings_goal_allocations WHERE user_id = $1`,
			`DELETE FROM public.savings_goals WHERE user_id = $1`,
			`DELETE FROM public.create_idempotency_receipts WHERE user_id = $1`,
			`DELETE FROM public.transactions WHERE user_id = $1`,
			`DELETE FROM public.accounts WHERE user_id = $1`,
		} {
			if _, err := admin.Exec(context.Background(), statement, userID); err != nil {
				t.Fatalf("cleanup: %v", err)
			}
		}
	}
	cleanup()
	t.Cleanup(cleanup)

	accounts := store.NewAccountRepository(pool)
	goals := store.NewSavingsGoalRepository(pool)
	transactions := store.NewTransactionRepository(pool)
	yields := store.NewAccountYieldRepository(pool)

	balance := int64(100_000)
	bps := 1200
	account, err := accounts.Create(ctx, userID, store.AccountInput{
		Name: "Ahorro", Type: "debit", Institution: "Banco", Last4: "7777", Currency: "MXN",
		BalanceCents: &balance, AnnualYieldBps: &bps, TrackBalance: true,
	})
	if err != nil {
		t.Fatalf("create account: %v", err)
	}
	if account.AnnualYieldBps == nil || *account.AnnualYieldBps != 1200 || account.YieldReconciledOn != nil {
		t.Fatalf("created account yield fields = %v %v", account.AnnualYieldBps, account.YieldReconciledOn)
	}
	if _, err := accounts.Create(ctx, userID, store.AccountInput{
		Name: "Tarjeta", Type: "credit", Institution: "Banco", Last4: "8888", Currency: "MXN",
		CreditLimitCents: &balance, AvailableCreditCents: &balance, AnnualYieldBps: &bps,
	}); !errors.Is(err, store.ErrInvalidAccountShape) {
		t.Fatalf("credit account with yield err = %v, want ErrInvalidAccountShape", err)
	}

	// Tiered rates: 15% up to $25,000 then 7%; tiers take precedence.
	tiers := []store.YieldTier{
		{UpToCents: &[]int64{2_500_000}[0], AnnualYieldBps: 1500},
		{UpToCents: nil, AnnualYieldBps: 700},
	}
	if _, err := accounts.Create(ctx, userID, store.AccountInput{
		Name: "Inválida", Type: "debit", Institution: "Banco", Last4: "9090", Currency: "MXN",
		BalanceCents: &balance, AnnualYieldTiers: tiers[:1],
	}); !errors.Is(err, store.ErrInvalidAccountShape) {
		t.Fatalf("capped-only ladder err = %v, want ErrInvalidAccountShape", err)
	}
	tiered, err := accounts.Update(ctx, userID, account.ID, store.AccountPatch{
		AnnualYieldTiers: store.Field[[]store.YieldTier]{Set: true, Value: &tiers},
	})
	if err != nil {
		t.Fatalf("patch tiers: %v", err)
	}
	if len(tiered.AnnualYieldTiers) != 2 || *tiered.AnnualYieldTiers[0].UpToCents != 2_500_000 ||
		tiered.AnnualYieldTiers[1].UpToCents != nil {
		t.Fatalf("stored tiers = %+v", tiered.AnnualYieldTiers)
	}
	if _, err := accounts.Create(ctx, userID, store.AccountInput{
		Name: "Escalonada", Type: "debit", Institution: "Banco", Last4: "9091", Currency: "MXN",
		BalanceCents: &balance, AnnualYieldTiers: tiers, TrackBalance: true,
	}); err != nil {
		t.Fatalf("create tiered account: %v", err)
	}
	if _, err := admin.Exec(ctx, `
		UPDATE public.accounts
		SET annual_yield_tiers = '[{"upToCents": null}]'::jsonb
		WHERE id = $1
	`, account.ID); err == nil {
		t.Fatal("database accepted malformed yield tiers")
	}
	cleared, err := accounts.Update(ctx, userID, account.ID, store.AccountPatch{
		AnnualYieldTiers: store.Field[[]store.YieldTier]{Set: true},
	})
	if err != nil || len(cleared.AnnualYieldTiers) != 0 {
		t.Fatalf("clear tiers = %+v, %v", cleared.AnnualYieldTiers, err)
	}
	if _, err := accounts.Update(ctx, userID, account.ID, store.AccountPatch{
		AnnualYieldTiers: store.Field[[]store.YieldTier]{Set: true, Value: &tiers},
	}); err != nil {
		t.Fatalf("restore tiers: %v", err)
	}

	today := time.Now().UTC().Format(time.DateOnly)
	goalA, err := goals.Create(ctx, userID, store.SavingsGoalInput{Name: "Viaje", TargetAmount: 1_000_000})
	if err != nil {
		t.Fatalf("create goal A: %v", err)
	}
	goalB, err := goals.Create(ctx, userID, store.SavingsGoalInput{Name: "Emergencia", TargetAmount: 1_000_000, SortOrder: 1})
	if err != nil {
		t.Fatalf("create goal B: %v", err)
	}
	for _, allocation := range []struct {
		goal   string
		amount int64
		key    string
	}{{goalA.ID, 40_000, "alloc-a"}, {goalB.ID, 20_000, "alloc-b"}} {
		if _, err := goals.Allocate(ctx, userID, allocation.goal, store.SavingsAllocationInput{
			AccountID: account.ID, Amount: allocation.amount, Date: today, IdempotencyKey: allocation.key,
		}); err != nil {
			t.Fatalf("allocate: %v", err)
		}
	}

	key := "yield-1"
	first, err := yields.Reconcile(ctx, userID, account.ID, store.YieldReconciliationInput{
		CurrentBalanceCents: 101_500, YieldCents: 1_000, Date: today, IdempotencyKey: &key,
	})
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	rec := first.Reconciliation
	if rec.YieldCents != 1_000 || rec.AdjustmentCents != 500 || rec.BalanceBeforeCents != 100_000 ||
		rec.BalanceAfterCents != 101_500 || rec.TransactionID == nil || len(rec.AnnualYieldTiers) != 2 {
		t.Fatalf("reconciliation = %+v", rec)
	}
	if len(rec.Allocations) != 2 {
		t.Fatalf("allocations = %+v", rec.Allocations)
	}
	shares := map[string]int64{}
	for _, allocation := range rec.Allocations {
		shares[allocation.GoalID] = allocation.Amount
	}
	if shares[goalA.ID] != 400 || shares[goalB.ID] != 200 {
		t.Fatalf("shares = %+v", shares)
	}
	if first.Account.BalanceCents == nil || *first.Account.BalanceCents != 101_500 ||
		first.Account.YieldReconciledOn == nil || *first.Account.YieldReconciledOn != today {
		t.Fatalf("account after reconcile = %+v", first.Account)
	}
	assertGoalAmounts(t, ctx, goals, userID, map[string]int64{goalA.ID: 40_400, goalB.ID: 20_200})

	replayed, err := yields.Reconcile(ctx, userID, account.ID, store.YieldReconciliationInput{
		CurrentBalanceCents: 101_500, YieldCents: 1_000, Date: today, IdempotencyKey: &key,
	})
	if err != nil || replayed.Reconciliation.ID != rec.ID {
		t.Fatalf("replay = %+v, %v; want %s", replayed.Reconciliation, err, rec.ID)
	}
	assertAccountAmount(t, ctx, admin, account.ID, "balance_cents", 101_500)

	if err := transactions.Delete(ctx, userID, *rec.TransactionID); !errors.Is(err, store.ErrYieldTransactionManaged) {
		t.Fatalf("delete yield transaction err = %v, want ErrYieldTransactionManaged", err)
	}
	if _, err := yields.Reconcile(ctx, userID, account.ID, store.YieldReconciliationInput{
		CurrentBalanceCents: 90_000, YieldCents: 10, Date: today,
	}); !errors.Is(err, store.ErrInvalidTransactionShape) {
		t.Fatalf("yield on negative difference err = %v, want ErrInvalidTransactionShape", err)
	}
	yesterday := time.Now().UTC().AddDate(0, 0, -1).Format(time.DateOnly)
	if _, err := yields.Reconcile(ctx, userID, account.ID, store.YieldReconciliationInput{
		CurrentBalanceCents: 101_600, YieldCents: 100, Date: yesterday,
	}); !errors.Is(err, store.ErrYieldDateBeforeMovements) {
		t.Fatalf("backdated reconcile err = %v, want ErrYieldDateBeforeMovements", err)
	}
	future := time.Now().UTC().AddDate(0, 0, 3).Format(time.DateOnly)
	if _, err := yields.Reconcile(ctx, userID, account.ID, store.YieldReconciliationInput{
		CurrentBalanceCents: 101_600, YieldCents: 100, Date: future,
	}); !errors.Is(err, store.ErrInvalidTransactionShape) {
		t.Fatalf("future reconcile err = %v, want ErrInvalidTransactionShape", err)
	}

	second, err := yields.Reconcile(ctx, userID, account.ID, store.YieldReconciliationInput{
		CurrentBalanceCents: 101_000, Date: today,
	})
	if err != nil {
		t.Fatalf("second reconcile: %v", err)
	}
	if second.Reconciliation.AdjustmentCents != -500 || second.Reconciliation.TransactionID != nil ||
		len(second.Reconciliation.Allocations) != 0 {
		t.Fatalf("second reconciliation = %+v", second.Reconciliation)
	}

	list, err := yields.List(ctx, userID)
	if err != nil || len(list) != 2 || len(list[1].Allocations) != 2 {
		t.Fatalf("list = %+v, %v", list, err)
	}

	if _, err := yields.Undo(ctx, userID, account.ID, rec.ID); !errors.Is(err, store.ErrYieldReconciliationNotLatest) {
		t.Fatalf("undo older err = %v, want ErrYieldReconciliationNotLatest", err)
	}
	if _, err := yields.Undo(ctx, userID, account.ID, second.Reconciliation.ID); err != nil {
		t.Fatalf("undo second: %v", err)
	}
	restored, err := yields.Undo(ctx, userID, account.ID, rec.ID)
	if err != nil {
		t.Fatalf("undo first: %v", err)
	}
	if restored.BalanceCents == nil || *restored.BalanceCents != 100_000 || restored.YieldReconciledOn != nil {
		t.Fatalf("restored account = %+v", restored)
	}
	assertGoalAmounts(t, ctx, goals, userID, map[string]int64{goalA.ID: 40_000, goalB.ID: 20_000})
	var remaining int
	if err := admin.QueryRow(ctx, `SELECT count(*) FROM public.transactions WHERE id = $1`, *rec.TransactionID).Scan(&remaining); err != nil || remaining != 0 {
		t.Fatalf("yield transaction remaining = %d, %v", remaining, err)
	}
	if _, err := yields.Undo(ctx, userID, account.ID, rec.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("undo missing err = %v, want ErrNotFound", err)
	}

	zero := 0
	if _, err := accounts.Update(ctx, userID, account.ID, store.AccountPatch{
		AnnualYieldBps: store.Field[int]{Set: true, Value: &zero},
	}); err != nil {
		t.Fatalf("patch yield rate: %v", err)
	}
}

func TestYieldUndoRefusesWhenFundsWereAllocatedOrReleased(t *testing.T) {
	pool, userID := setupPool(t, "public.account_yield_reconciliations")
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	admin := newAdminPool(t, ctx)
	t.Cleanup(admin.Close)
	cleanup := func() {
		for _, statement := range []string{
			`DELETE FROM public.account_yield_reconciliations WHERE user_id = $1`,
			`DELETE FROM public.savings_goal_allocations WHERE user_id = $1`,
			`DELETE FROM public.savings_goals WHERE user_id = $1`,
			`DELETE FROM public.create_idempotency_receipts WHERE user_id = $1`,
			`DELETE FROM public.transactions WHERE user_id = $1`,
			`DELETE FROM public.accounts WHERE user_id = $1`,
		} {
			if _, err := admin.Exec(context.Background(), statement, userID); err != nil {
				t.Fatalf("cleanup: %v", err)
			}
		}
	}
	cleanup()
	t.Cleanup(cleanup)

	accounts := store.NewAccountRepository(pool)
	goals := store.NewSavingsGoalRepository(pool)
	yields := store.NewAccountYieldRepository(pool)
	balance := int64(100_000)
	account, err := accounts.Create(ctx, userID, store.AccountInput{
		Name: "Ahorro guard", Type: "debit", Institution: "Banco", Last4: "7070", Currency: "MXN",
		BalanceCents: &balance, TrackBalance: true,
	})
	if err != nil {
		t.Fatalf("create account: %v", err)
	}
	today := time.Now().UTC().Format(time.DateOnly)
	goal, err := goals.Create(ctx, userID, store.SavingsGoalInput{Name: "Meta guard", TargetAmount: 1_000_000})
	if err != nil {
		t.Fatalf("create goal: %v", err)
	}
	if _, err := goals.Allocate(ctx, userID, goal.ID, store.SavingsAllocationInput{
		AccountID: account.ID, Amount: 50_000, Date: today, IdempotencyKey: "guard-a",
	}); err != nil {
		t.Fatalf("allocate: %v", err)
	}
	result, err := yields.Reconcile(ctx, userID, account.ID, store.YieldReconciliationInput{
		CurrentBalanceCents: 102_000, YieldCents: 2_000, Date: today,
	})
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if len(result.Reconciliation.Allocations) != 1 || result.Reconciliation.Allocations[0].Amount != 1_000 {
		t.Fatalf("allocations = %+v", result.Reconciliation.Allocations)
	}

	// Assigning the free share of the yield means undo would over-allocate.
	if _, err := goals.Allocate(ctx, userID, goal.ID, store.SavingsAllocationInput{
		AccountID: account.ID, Amount: 51_000, Date: today, IdempotencyKey: "guard-b",
	}); err != nil {
		t.Fatalf("allocate rest: %v", err)
	}
	if _, err := yields.Undo(ctx, userID, account.ID, result.Reconciliation.ID); !errors.Is(err, store.ErrInsufficientUnallocatedSavings) {
		t.Fatalf("undo over-allocated err = %v, want ErrInsufficientUnallocatedSavings", err)
	}

	// Releasing more than the non-yield allocation means the goal no longer holds its share.
	if _, err := goals.Allocate(ctx, userID, goal.ID, store.SavingsAllocationInput{
		AccountID: account.ID, Amount: -101_500, Date: today, IdempotencyKey: "guard-c",
	}); err != nil {
		t.Fatalf("release: %v", err)
	}
	if _, err := yields.Undo(ctx, userID, account.ID, result.Reconciliation.ID); !errors.Is(err, store.ErrInsufficientGoalAllocation) {
		t.Fatalf("undo released err = %v, want ErrInsufficientGoalAllocation", err)
	}
}

func assertGoalAmounts(t *testing.T, ctx context.Context, goals *store.SavingsGoalRepository, userID string, want map[string]int64) {
	t.Helper()
	list, err := goals.List(ctx, userID)
	if err != nil {
		t.Fatalf("list goals: %v", err)
	}
	for _, goal := range list {
		if amount, ok := want[goal.ID]; ok && goal.CurrentAmount != amount {
			t.Fatalf("goal %s current = %d, want %d", goal.Name, goal.CurrentAmount, amount)
		}
	}
}

func TestDeletingAccountClearsLinkedGoalAccount(t *testing.T) {
	pool, userID := setupPool(t, "public.savings_goals")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	accounts := store.NewAccountRepository(pool)
	goals := store.NewSavingsGoalRepository(pool)
	balance := int64(0)
	account, err := accounts.Create(ctx, userID, store.AccountInput{
		Name: "Cuenta meta", Type: "debit", Institution: "Banco", Last4: "6060", Currency: "MXN", BalanceCents: &balance,
	})
	if err != nil {
		t.Fatalf("create account: %v", err)
	}
	goal, err := goals.Create(ctx, userID, store.SavingsGoalInput{Name: "Meta ligada", TargetAmount: 1_000, AccountID: &account.ID})
	if err != nil {
		t.Fatalf("create goal: %v", err)
	}
	if err := accounts.Delete(ctx, userID, account.ID); err != nil {
		t.Fatalf("delete linked account: %v", err)
	}
	list, err := goals.List(ctx, userID)
	if err != nil {
		t.Fatalf("list goals: %v", err)
	}
	for _, g := range list {
		if g.ID == goal.ID && g.AccountID != nil {
			t.Fatalf("goal account = %v, want nil", *g.AccountID)
		}
	}
}
