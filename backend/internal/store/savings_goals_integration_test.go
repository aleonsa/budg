package store_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/aleonsa/budg/backend/internal/store"
)

func TestSavingsGoalRepositoryCRUD(t *testing.T) {
	pool, userID := setupPool(t, "public.savings_goals")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	repo := store.NewSavingsGoalRepository(pool)
	targetDate := "2027-01-15"

	initial, err := repo.List(ctx, userID)
	if err != nil {
		t.Fatalf("list (initial): %v", err)
	}
	if len(initial) != 0 {
		t.Fatalf("expected empty list, got %d", len(initial))
	}

	created, err := repo.Create(ctx, userID, store.SavingsGoalInput{
		Name:          "Trip",
		TargetAmount:  50000,
		CurrentAmount: 0,
		TargetDate:    &targetDate,
		SortOrder:     0,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created.ID == "" || created.UserID != userID || created.TargetAmount != 50000 || created.TargetDate == nil || *created.TargetDate != targetDate {
		t.Fatalf("created row = %+v", created)
	}

	got, err := repo.List(ctx, userID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(got) != 1 || got[0].ID != created.ID {
		t.Fatalf("list = %+v, want [%s]", got, created.ID)
	}

	newName := "Long Trip"
	accountRepo := store.NewAccountRepository(pool)
	account, err := accountRepo.Create(ctx, userID, store.AccountInput{
		Name: "Goal savings", Type: "debit", Institution: "Test", Last4: "1234", Currency: "MXN",
	})
	if err != nil {
		t.Fatalf("create linked account: %v", err)
	}
	updated, err := repo.Update(ctx, userID, created.ID, store.SavingsGoalPatch{
		Name:       &newName,
		AccountID:  store.Field[string]{Set: true, Value: &account.ID},
		TargetDate: store.Field[string]{Set: true},
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.Name != "Long Trip" || updated.AccountID == nil || *updated.AccountID != account.ID || updated.TargetDate != nil {
		t.Fatalf("updated row = %+v", updated)
	}

	if err := repo.Delete(ctx, userID, created.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if err := accountRepo.Delete(ctx, userID, account.ID); err != nil {
		t.Fatalf("delete linked account: %v", err)
	}
	if err := repo.Delete(ctx, userID, created.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("delete missing err = %v, want ErrNotFound", err)
	}
}

func TestSavingsGoalsRLSDeniesUnscopedAccess(t *testing.T) {
	pool, userID := setupPool(t, "public.savings_goals")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	repo := store.NewSavingsGoalRepository(pool)
	_, err := repo.Create(ctx, userID, store.SavingsGoalInput{
		Name:          "Unscoped",
		TargetAmount:  1000,
		CurrentAmount: 0,
		SortOrder:     0,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	rows, err := pool.Query(ctx, `SELECT id FROM public.savings_goals WHERE user_id = $1`, userID)
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

func TestSavingsGoalRepositoryAllocationWorkflow(t *testing.T) {
	pool, userID := setupPool(t, "public.savings_goals")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	accounts := store.NewAccountRepository(pool)
	goals := store.NewSavingsGoalRepository(pool)
	transactions := store.NewTransactionRepository(pool)
	sourceBalance := int64(100000)
	savingsBalance := int64(20000)
	source, err := accounts.Create(ctx, userID, store.AccountInput{
		Name: "Checking", Type: "debit", Institution: "Test", Last4: "1111", Currency: "MXN",
		BalanceCents: &sourceBalance, TrackBalance: true,
	})
	if err != nil {
		t.Fatalf("create source account: %v", err)
	}
	savings, err := accounts.Create(ctx, userID, store.AccountInput{
		Name: "Savings", Type: "debit", Institution: "Test", Last4: "2222", Currency: "MXN",
		BalanceCents: &savingsBalance, TrackBalance: true,
	})
	if err != nil {
		t.Fatalf("create savings account: %v", err)
	}
	trip, err := goals.Create(ctx, userID, store.SavingsGoalInput{
		Name: "Trip", TargetAmount: 100000, AccountID: &savings.ID,
	})
	if err != nil {
		t.Fatalf("create trip goal: %v", err)
	}
	emergency, err := goals.Create(ctx, userID, store.SavingsGoalInput{
		Name: "Emergency", TargetAmount: 50000, AccountID: &savings.ID,
	})
	if err != nil {
		t.Fatalf("create emergency goal: %v", err)
	}

	trip, err = goals.Allocate(ctx, userID, trip.ID, store.SavingsAllocationInput{
		AccountID: savings.ID, Amount: 5000, Date: "2026-08-16", IdempotencyKey: "allocate-existing-1",
	})
	if err != nil {
		t.Fatalf("allocate existing savings: %v", err)
	}
	if trip.CurrentAmount != 5000 {
		t.Fatalf("trip current = %d, want 5000", trip.CurrentAmount)
	}
	replayedAllocation, err := goals.Allocate(ctx, userID, trip.ID, store.SavingsAllocationInput{
		AccountID: savings.ID, Amount: 5000, Date: "2026-08-16", IdempotencyKey: "allocate-existing-1",
	})
	if err != nil || replayedAllocation.CurrentAmount != 5000 {
		t.Fatalf("replayed allocation = %+v, err=%v", replayedAllocation, err)
	}

	key := "save-" + time.Now().UTC().Format("20060102150405.000000000")
	saved, err := goals.Save(ctx, userID, trip.ID, store.SaveToGoalInput{
		SourceAccountID:      source.ID,
		DestinationAccountID: savings.ID,
		Amount:               10000,
		Date:                 "2026-08-16",
		Description:          "Ahorro para viaje",
		IdempotencyKey:       key,
	})
	if err != nil {
		t.Fatalf("save to goal: %v", err)
	}
	if saved.Goal.CurrentAmount != 15000 || saved.Transaction.Amount != 10000 {
		t.Fatalf("save result = %+v", saved)
	}
	replayed, err := goals.Save(ctx, userID, trip.ID, store.SaveToGoalInput{
		SourceAccountID:      source.ID,
		DestinationAccountID: savings.ID,
		Amount:               10000,
		Date:                 "2026-08-16",
		Description:          "Ahorro para viaje",
		IdempotencyKey:       key,
	})
	if err != nil {
		t.Fatalf("replay save: %v", err)
	}
	if replayed.Transaction.ID != saved.Transaction.ID || replayed.Goal.CurrentAmount != 15000 {
		t.Fatalf("replayed result = %+v, want same transaction and amount", replayed)
	}

	reallocated, err := goals.Reallocate(ctx, userID, trip.ID, store.SavingsReallocationInput{
		ToGoalID: emergency.ID, AccountID: savings.ID, Amount: 4000, Date: "2026-08-16", IdempotencyKey: "reallocate-1",
	})
	if err != nil {
		t.Fatalf("reallocate savings: %v", err)
	}
	if reallocated.FromGoal.CurrentAmount != 11000 || reallocated.ToGoal.CurrentAmount != 4000 {
		t.Fatalf("reallocation result = %+v", reallocated)
	}
	replayedReallocation, err := goals.Reallocate(ctx, userID, trip.ID, store.SavingsReallocationInput{
		ToGoalID: emergency.ID, AccountID: savings.ID, Amount: 4000, Date: "2026-08-16", IdempotencyKey: "reallocate-1",
	})
	if err != nil || replayedReallocation.FromGoal.CurrentAmount != 11000 || replayedReallocation.ToGoal.CurrentAmount != 4000 {
		t.Fatalf("replayed reallocation = %+v, err=%v", replayedReallocation, err)
	}

	emergency, err = goals.Allocate(ctx, userID, emergency.ID, store.SavingsAllocationInput{
		AccountID: savings.ID, Amount: -1000, Date: "2026-08-16", IdempotencyKey: "release-1",
	})
	if err != nil {
		t.Fatalf("release savings: %v", err)
	}
	if emergency.CurrentAmount != 3000 {
		t.Fatalf("emergency current = %d, want 3000", emergency.CurrentAmount)
	}

	overview, err := goals.Overview(ctx, userID)
	if err != nil {
		t.Fatalf("overview: %v", err)
	}
	if overview.TotalAllocated != 14000 || overview.TotalAccountBalance != 30000 || overview.TotalUnallocated != 16000 {
		t.Fatalf("overview = %+v, want allocated=14000 balance=30000 unallocated=16000", overview)
	}
	if len(overview.Accounts) != 1 || overview.Accounts[0].AccountID != savings.ID || overview.Accounts[0].AllocatedAmount != 14000 {
		t.Fatalf("overview accounts = %+v", overview.Accounts)
	}

	if _, err := goals.Allocate(ctx, userID, trip.ID, store.SavingsAllocationInput{
		AccountID: savings.ID, Amount: 16001, Date: "2026-08-16", IdempotencyKey: "overallocate-1",
	}); !errors.Is(err, store.ErrInsufficientUnallocatedSavings) {
		t.Fatalf("over-allocation error = %v, want ErrInsufficientUnallocatedSavings", err)
	}
	if _, err := transactions.Update(ctx, userID, saved.Transaction.ID, store.TransactionPatch{}); !errors.Is(err, store.ErrSavingsTransactionManaged) {
		t.Fatalf("update linked transaction error = %v, want ErrSavingsTransactionManaged", err)
	}
	if err := transactions.Delete(ctx, userID, saved.Transaction.ID); !errors.Is(err, store.ErrSavingsTransactionManaged) {
		t.Fatalf("delete linked transaction error = %v, want ErrSavingsTransactionManaged", err)
	}
	if err := goals.Delete(ctx, userID, trip.ID); err != nil {
		t.Fatalf("delete trip goal: %v", err)
	}
	if err := goals.Delete(ctx, userID, emergency.ID); err != nil {
		t.Fatalf("delete emergency goal: %v", err)
	}
	if err := transactions.Delete(ctx, userID, saved.Transaction.ID); err != nil {
		t.Fatalf("delete released savings transaction: %v", err)
	}
	if err := accounts.Delete(ctx, userID, source.ID); err != nil {
		t.Fatalf("delete source account: %v", err)
	}
	if err := accounts.Delete(ctx, userID, savings.ID); err != nil {
		t.Fatalf("delete savings account: %v", err)
	}
}
