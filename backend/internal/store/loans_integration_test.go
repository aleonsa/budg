package store_test

import (
	"context"
	"errors"
	"github.com/aleonsa/budg/backend/internal/store"
	"testing"
)

func TestLoanLifecycle(t *testing.T) {
	pool, user := setupPool(t, "public.loans")
	ctx := context.Background()
	admin := newAdminPool(t, ctx)
	defer admin.Close()
	defer func() {
		if _, err := admin.Exec(ctx, `DELETE FROM public.loans WHERE user_id=$1`, user); err != nil {
			t.Error(err)
		}
	}()
	accounts := store.NewAccountRepository(pool)
	initial := int64(50_000_000)
	account, err := accounts.Create(ctx, user, store.AccountInput{Name: "Loan checking", Type: "debit", Institution: "Test", Last4: "1234", Currency: "MXN", BalanceCents: &initial})
	if err != nil {
		t.Fatal(err)
	}
	if !account.BalanceTrackingEnabled {
		if _, err := accounts.EnableBalanceTracking(ctx, user, account.ID, initial); err != nil {
			t.Fatal(err)
		}
	}
	repo := store.NewLoanRepository(pool)
	key := "create-car"
	input := store.LoanInput{AccountID: account.ID, Description: "Car", PrincipalCents: 27_690_000, AnnualRateBps: 1373, TermMonths: 60, MonthlyPaymentCents: 640428, StartDate: "2026-12-13", DayOfMonth: 13, IdempotencyKey: &key}
	loan, err := repo.Create(ctx, user, input)
	if err != nil {
		t.Fatal(err)
	}
	again, err := repo.Create(ctx, user, input)
	if err != nil || again.ID != loan.ID {
		t.Fatalf("create replay: %+v %v", again, err)
	}
	all, err := repo.List(ctx, user)
	if err != nil || len(all) != 1 || all[0].RemainingCents != input.PrincipalCents {
		t.Fatalf("list: %+v %v", all, err)
	}
	_, payments, err := repo.Get(ctx, user, loan.ID)
	if err != nil || len(payments) != 60 {
		t.Fatalf("schedule: %d %v", len(payments), err)
	}
	if _, _, err := repo.Get(ctx, "22222222-2222-2222-2222-222222222222", loan.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("RLS get: %v", err)
	}
	if _, err := repo.Pay(ctx, user, loan.ID, payments[1].ID, store.PayLoanPaymentInput{Date: "2026-12-14"}); !errors.Is(err, store.ErrLoanInvalid) {
		t.Fatalf("out of order: %v", err)
	}
	total := int64(674118)
	paid, err := repo.Pay(ctx, user, loan.ID, payments[0].ID, store.PayLoanPaymentInput{Date: "2026-12-14", PaidTotalCents: &total})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.Pay(ctx, user, loan.ID, payments[0].ID, store.PayLoanPaymentInput{Date: "2026-12-14", PaidTotalCents: &total}); err != nil {
		t.Fatalf("payment replay: %v", err)
	}
	bank, err := accounts.List(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range bank {
		if a.ID == account.ID && *a.BalanceCents != initial-total {
			t.Fatalf("charged twice: %d", *a.BalanceCents)
		}
	}
	txRepo := store.NewTransactionRepository(pool)
	if err := txRepo.Delete(ctx, user, *paid.TransactionID); !errors.Is(err, store.ErrLoanPaymentManaged) {
		t.Fatalf("managed delete: %v", err)
	}
	desc := "wrong"
	if _, err := txRepo.Update(ctx, user, *paid.TransactionID, store.TransactionPatch{Description: &desc}); !errors.Is(err, store.ErrLoanPaymentManaged) {
		t.Fatalf("managed update: %v", err)
	}
	extraKey := "extra-1"
	extraIn := store.ExtraLoanPaymentInput{AmountCents: 1_000_000, Date: "2026-12-15", IdempotencyKey: &extraKey}
	extra, _, err := repo.AddExtraPayment(ctx, user, loan.ID, extraIn)
	if err != nil {
		t.Fatal(err)
	}
	replay, _, err := repo.AddExtraPayment(ctx, user, loan.ID, extraIn)
	if err != nil || extra.ID != replay.ID {
		t.Fatalf("extra replay: %v", err)
	}
	extraKey2 := "extra-2"
	extraIn.IdempotencyKey = &extraKey2
	extraIn.AmountCents = 500_000
	latest, _, err := repo.AddExtraPayment(ctx, user, loan.ID, extraIn)
	if err != nil {
		t.Fatal(err)
	}
	got, ps, err := repo.Get(ctx, user, loan.ID)
	if err != nil {
		t.Fatal(err)
	}
	expected := input.PrincipalCents - paid.PrincipalCents - 1_500_000
	if got.RemainingCents != expected {
		t.Fatalf("extra principal balance=%d want=%d", got.RemainingCents, expected)
	}
	for _, p := range ps {
		if p.Status == "pending" {
			if p.DueDate != "2027-01-13" || p.InterestCents >= payments[1].InterestCents {
				t.Fatalf("new next payment %+v", p)
			}
			break
		}
	}
	if err := repo.Undo(ctx, user, loan.ID, extra.ID); !errors.Is(err, store.ErrLoanInvalid) {
		t.Fatalf("old undo: %v", err)
	}
	if err := repo.Undo(ctx, user, loan.ID, latest.ID); err != nil {
		t.Fatal(err)
	}
	got, _, err = repo.Get(ctx, user, loan.ID)
	if err != nil || got.RemainingCents != expected+500_000 {
		t.Fatalf("undo extra balance %d %v", got.RemainingCents, err)
	}
	actual := got.RemainingCents + 12345
	adjustment, err := repo.Reconcile(ctx, user, loan.ID, store.ReconcileLoanInput{ActualBalanceCents: actual, AsOfDate: "2026-12-16"})
	if err != nil {
		t.Fatal(err)
	}
	got, _, err = repo.Get(ctx, user, loan.ID)
	if err != nil || got.RemainingCents != actual {
		t.Fatalf("signed reconciliation %d %v", got.RemainingCents, err)
	}
	if err := repo.Undo(ctx, user, loan.ID, adjustment.ID); err != nil {
		t.Fatal(err)
	}
	got, _, err = repo.Get(ctx, user, loan.ID)
	if err != nil {
		t.Fatal(err)
	}
	payoffKey := "payoff"
	payoff, remaining, err := repo.AddExtraPayment(ctx, user, loan.ID, store.ExtraLoanPaymentInput{AmountCents: got.RemainingCents, Date: "2026-12-17", IdempotencyKey: &payoffKey})
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range remaining {
		if p.Status == "pending" {
			t.Fatal("full payoff left pending installments")
		}
	}
	got, _, err = repo.Get(ctx, user, loan.ID)
	if err != nil || got.Status != "paid_off" || got.RemainingCents != 0 {
		t.Fatalf("payoff: %+v %v", got, err)
	}
	if err := repo.Undo(ctx, user, loan.ID, payoff.ID); err != nil {
		t.Fatal(err)
	}
	if err := repo.Delete(ctx, user, loan.ID); !errors.Is(err, store.ErrLoanInvalid) {
		t.Fatalf("delete history: %v", err)
	}
	if err := repo.Undo(ctx, user, loan.ID, extra.ID); err != nil {
		t.Fatal(err)
	}
	extraIn.IdempotencyKey = &extraKey
	extraIn.AmountCents = 1_000_000
	if _, _, err := repo.AddExtraPayment(ctx, user, loan.ID, extraIn); !errors.Is(err, store.ErrIdempotencyReplayDeleted) {
		t.Fatalf("undone extra replay must not charge again: %v", err)
	}
	if err := repo.Undo(ctx, user, loan.ID, paid.ID); err != nil {
		t.Fatal(err)
	}
	got, ps, err = repo.Get(ctx, user, loan.ID)
	if err != nil || got.RemainingCents != input.PrincipalCents || ps[0].DueDate != "2026-12-13" {
		t.Fatalf("restore first installment: %+v %v", got, err)
	}
	bank, err = accounts.List(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range bank {
		if a.ID == account.ID && *a.BalanceCents != initial {
			t.Fatalf("undo did not restore bank balance %d", *a.BalanceCents)
		}
	}
	if err := repo.Delete(ctx, user, loan.ID); err != nil {
		t.Fatal(err)
	}
}
