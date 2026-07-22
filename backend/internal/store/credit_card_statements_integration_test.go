package store_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/aleonsa/budg/backend/internal/store"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestCreditCardStatementRepositoryAndPaymentLinks(t *testing.T) {
	pool, userID := setupPool(t, "public.credit_card_statements")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	admin := newAdminPool(t, ctx)
	defer admin.Close()

	accounts := store.NewAccountRepository(pool)
	sourceBalance := int64(50000)
	source, err := accounts.Create(ctx, userID, store.AccountInput{
		Name: "Checking for statement", Type: "debit", Institution: "Bank",
		Last4: "1001", Currency: "MXN", BalanceCents: &sourceBalance,
	})
	if err != nil {
		t.Fatalf("create source account: %v", err)
	}
	creditLimit := int64(100000)
	availableCredit := int64(75000)
	credit, err := accounts.Create(ctx, userID, store.AccountInput{
		Name: "Card for statement", Type: "credit", Institution: "Bank",
		Last4: "2002", Currency: "MXN", CreditLimitCents: &creditLimit,
		AvailableCreditCents: &availableCredit,
	})
	if err != nil {
		t.Fatalf("create credit account: %v", err)
	}
	if _, err := accounts.EnableBalanceTracking(ctx, userID, source.ID, sourceBalance); err != nil {
		t.Fatalf("enable source tracking: %v", err)
	}
	if _, err := accounts.EnableBalanceTracking(ctx, userID, credit.ID, availableCredit); err != nil {
		t.Fatalf("enable credit tracking: %v", err)
	}

	statements := store.NewCreditCardStatementRepository(pool)
	minimum := int64(1000)
	confirmed, err := statements.Confirm(ctx, userID, credit.ID, store.CreditCardStatementInput{
		CycleStartDate: "2098-12-01", CycleEndDate: "2098-12-31",
		PaymentDueDate: "2099-01-20", StatementBalanceCents: 10000,
		MinimumPaymentCents: &minimum,
	})
	if err != nil {
		t.Fatalf("confirm statement: %v", err)
	}
	if confirmed.Status != "pending" || confirmed.PaidAmountCents != 0 {
		t.Fatalf("confirmed statement = %+v, want pending with zero paid", confirmed)
	}

	upserted, err := statements.Confirm(ctx, userID, credit.ID, store.CreditCardStatementInput{
		CycleStartDate: "2098-12-02", CycleEndDate: "2098-12-31",
		PaymentDueDate: "2099-01-21", StatementBalanceCents: 10000,
		MinimumPaymentCents: &minimum,
	})
	if err != nil {
		t.Fatalf("upsert statement: %v", err)
	}
	if upserted.ID != confirmed.ID || upserted.CycleStartDate != "2098-12-02" {
		t.Fatalf("upserted statement = %+v, want same id with updated dates", upserted)
	}

	transactions := store.NewTransactionRepository(pool)
	transfer, err := transactions.Create(ctx, userID, store.TransactionInput{
		AccountID: source.ID, Type: "transfer", Amount: 4000,
		Date: "2099-01-05", Description: "Card payment",
		TransferToAccount: &credit.ID, CreditCardStatementID: &confirmed.ID,
	})
	if err != nil {
		t.Fatalf("create linked payment: %v", err)
	}
	listed, err := statements.List(ctx, userID, credit.ID)
	if err != nil {
		t.Fatalf("list statement with future payment: %v", err)
	}
	if len(listed) != 1 || listed[0].Status != "pending" || listed[0].PaidAmountCents != 0 {
		t.Fatalf("future payment statement list = %+v, want pending with zero paid", listed)
	}
	paymentDate := time.Now().UTC().Format("2006-01-02")
	if _, err := transactions.Update(ctx, userID, transfer.ID, store.TransactionPatch{Date: &paymentDate}); err != nil {
		t.Fatalf("post linked payment: %v", err)
	}
	listed, err = statements.List(ctx, userID, credit.ID)
	if err != nil {
		t.Fatalf("list partial statement: %v", err)
	}
	if listed[0].Status != "partial" || listed[0].PaidAmountCents != 4000 {
		t.Fatalf("partial statement = %+v", listed[0])
	}

	paidAmount := int64(10000)
	if _, err := transactions.Update(ctx, userID, transfer.ID, store.TransactionPatch{Amount: &paidAmount}); err != nil {
		t.Fatalf("update linked payment: %v", err)
	}
	listed, err = statements.List(ctx, userID, credit.ID)
	if err != nil {
		t.Fatalf("list paid statement: %v", err)
	}
	if listed[0].Status != "paid" || listed[0].PaidAmountCents != 10000 {
		t.Fatalf("paid statement = %+v", listed[0])
	}

	var sourceBefore, creditBefore int64
	var entriesBefore int
	if err := admin.QueryRow(ctx, `SELECT balance_cents FROM public.accounts WHERE id = $1`, source.ID).Scan(&sourceBefore); err != nil {
		t.Fatalf("read source balance: %v", err)
	}
	if err := admin.QueryRow(ctx, `SELECT available_credit_cents FROM public.accounts WHERE id = $1`, credit.ID).Scan(&creditBefore); err != nil {
		t.Fatalf("read credit balance: %v", err)
	}
	if err := admin.QueryRow(ctx, `SELECT count(*) FROM public.account_balance_entries WHERE transaction_id = $1`, transfer.ID).Scan(&entriesBefore); err != nil {
		t.Fatalf("count balance entries: %v", err)
	}
	if _, err := admin.Exec(ctx, `DELETE FROM public.credit_card_statements WHERE id = $1`, confirmed.ID); err != nil {
		t.Fatalf("delete statement: %v", err)
	}

	allTransactions, err := transactions.List(ctx, userID)
	if err != nil {
		t.Fatalf("list transactions after statement delete: %v", err)
	}
	var transactionAfterDelete *store.Transaction
	for i := range allTransactions {
		if allTransactions[i].ID == transfer.ID {
			transactionAfterDelete = &allTransactions[i]
			break
		}
	}
	if transactionAfterDelete == nil || transactionAfterDelete.CreditCardStatementID != nil {
		t.Fatalf("transaction after statement delete = %+v, want linked transaction with nil statement link", transactionAfterDelete)
	}
	var sourceAfter, creditAfter int64
	var entriesAfter int
	if err := admin.QueryRow(ctx, `SELECT balance_cents FROM public.accounts WHERE id = $1`, source.ID).Scan(&sourceAfter); err != nil {
		t.Fatalf("read source balance after delete: %v", err)
	}
	if err := admin.QueryRow(ctx, `SELECT available_credit_cents FROM public.accounts WHERE id = $1`, credit.ID).Scan(&creditAfter); err != nil {
		t.Fatalf("read credit balance after delete: %v", err)
	}
	if err := admin.QueryRow(ctx, `SELECT count(*) FROM public.account_balance_entries WHERE transaction_id = $1`, transfer.ID).Scan(&entriesAfter); err != nil {
		t.Fatalf("count balance entries after delete: %v", err)
	}
	if sourceAfter != sourceBefore || creditAfter != creditBefore || entriesAfter != entriesBefore {
		t.Fatalf("statement delete changed ledger: balances (%d,%d) -> (%d,%d), entries %d -> %d",
			sourceBefore, creditBefore, sourceAfter, creditAfter, entriesBefore, entriesAfter)
	}
}

func TestCreditCardStatementRepositoryValidation(t *testing.T) {
	pool, userID := setupPool(t, "public.credit_card_statements")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	invalidDates := store.CreditCardStatementInput{
		CycleStartDate: "2026-02-30", CycleEndDate: "2026-03-31",
		PaymentDueDate: "2026-04-20", StatementBalanceCents: 1,
	}
	repo := store.NewCreditCardStatementRepository(pool)
	if _, err := repo.Confirm(ctx, userID, "missing", invalidDates); !errors.Is(err, store.ErrInvalidCreditCardStatement) {
		t.Fatalf("invalid dates error = %v, want ErrInvalidCreditCardStatement", err)
	}

	balance := int64(100)
	debit, err := store.NewAccountRepository(pool).Create(ctx, userID, store.AccountInput{
		Name: "Not a card", Type: "debit", Institution: "Bank", Last4: "3003",
		Currency: "MXN", BalanceCents: &balance,
	})
	if err != nil {
		t.Fatalf("create debit account: %v", err)
	}
	valid := store.CreditCardStatementInput{
		CycleStartDate: "2026-02-01", CycleEndDate: "2026-02-28",
		PaymentDueDate: "2026-03-20", StatementBalanceCents: 1,
	}
	if _, err := repo.Confirm(ctx, userID, debit.ID, valid); !errors.Is(err, store.ErrInvalidAccountShape) {
		t.Fatalf("debit account error = %v, want ErrInvalidAccountShape", err)
	}

	creditLimit := int64(1000)
	availableCredit := int64(1000)
	cardOne, err := store.NewAccountRepository(pool).Create(ctx, userID, store.AccountInput{
		Name: "First card", Type: "credit", Institution: "Bank", Last4: "4004",
		Currency: "MXN", CreditLimitCents: &creditLimit, AvailableCreditCents: &availableCredit,
	})
	if err != nil {
		t.Fatalf("create first credit account: %v", err)
	}
	cardTwo, err := store.NewAccountRepository(pool).Create(ctx, userID, store.AccountInput{
		Name: "Second card", Type: "credit", Institution: "Bank", Last4: "5005",
		Currency: "MXN", CreditLimitCents: &creditLimit, AvailableCreditCents: &availableCredit,
	})
	if err != nil {
		t.Fatalf("create second credit account: %v", err)
	}
	statement, err := repo.Confirm(ctx, userID, cardOne.ID, valid)
	if err != nil {
		t.Fatalf("confirm first card statement: %v", err)
	}
	if _, err := store.NewTransactionRepository(pool).Create(ctx, userID, store.TransactionInput{
		AccountID: debit.ID, Type: "transfer", Amount: 1, Date: "2026-03-01",
		Description: "Wrong card link", TransferToAccount: &cardTwo.ID,
		CreditCardStatementID: &statement.ID,
	}); !errors.Is(err, store.ErrInvalidTransactionShape) {
		t.Fatalf("mismatched destination error = %v, want ErrInvalidTransactionShape", err)
	}
	affectsBalance := false
	if _, err := store.NewTransactionRepository(pool).Create(ctx, userID, store.TransactionInput{
		AccountID: debit.ID, Type: "transfer", Amount: 1, Date: "2026-03-01",
		Description: "Historical statement payment", TransferToAccount: &cardOne.ID,
		CreditCardStatementID: &statement.ID, AffectsBalance: &affectsBalance,
	}); !errors.Is(err, store.ErrInvalidTransactionShape) {
		t.Fatalf("historical statement payment error = %v, want ErrInvalidTransactionShape", err)
	}
	historical, err := store.NewTransactionRepository(pool).Create(ctx, userID, store.TransactionInput{
		AccountID: debit.ID, Type: "transfer", Amount: 1, Date: "2026-03-01",
		Description: "Historical transfer", TransferToAccount: &cardOne.ID,
		AffectsBalance: &affectsBalance,
	})
	if err != nil {
		t.Fatalf("create historical transfer: %v", err)
	}
	if _, err := store.NewTransactionRepository(pool).Update(ctx, userID, historical.ID, store.TransactionPatch{
		CreditCardStatementID: store.Field[string]{Set: true, Value: &statement.ID},
	}); !errors.Is(err, store.ErrInvalidTransactionShape) {
		t.Fatalf("link historical transfer error = %v, want ErrInvalidTransactionShape", err)
	}
}

func TestStatementPaymentRequiresTrackingOnBothAccounts(t *testing.T) {
	pool, userID := setupPool(t, "public.credit_card_statements")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	admin := newAdminPool(t, ctx)
	defer admin.Close()

	accounts := store.NewAccountRepository(pool)
	transactions := store.NewTransactionRepository(pool)
	statements := store.NewCreditCardStatementRepository(pool)
	sourceBalance := int64(10000)
	source, err := accounts.Create(ctx, userID, store.AccountInput{
		Name: "Statement tracking source", Type: "debit", Institution: "Bank",
		Last4: "7001", Currency: "MXN", BalanceCents: &sourceBalance,
	})
	if err != nil {
		t.Fatalf("create source: %v", err)
	}
	limit, available := int64(20000), int64(15000)
	trackedCard, err := accounts.Create(ctx, userID, store.AccountInput{
		Name: "Tracked statement card", Type: "credit", Institution: "Bank",
		Last4: "7002", Currency: "MXN", CreditLimitCents: &limit, AvailableCreditCents: &available,
	})
	if err != nil {
		t.Fatalf("create tracked card: %v", err)
	}
	if _, err := accounts.EnableBalanceTracking(ctx, userID, trackedCard.ID, available); err != nil {
		t.Fatalf("enable card tracking: %v", err)
	}
	trackedStatement, err := statements.Confirm(ctx, userID, trackedCard.ID, store.CreditCardStatementInput{
		CycleStartDate: "2026-06-01", CycleEndDate: "2026-06-30",
		PaymentDueDate: "2026-07-20", StatementBalanceCents: 3000,
	})
	if err != nil {
		t.Fatalf("confirm tracked card statement: %v", err)
	}
	paymentDate := time.Now().UTC().Format("2006-01-02")
	payment := store.TransactionInput{
		AccountID: source.ID, Type: "transfer", Amount: 1000, Date: paymentDate,
		Description: "Statement tracking payment", TransferToAccount: &trackedCard.ID,
		CreditCardStatementID: &trackedStatement.ID,
	}
	if _, err := transactions.Create(ctx, userID, payment); !errors.Is(err, store.ErrBalanceTrackingNotEnabled) {
		t.Fatalf("untracked source error = %v, want ErrBalanceTrackingNotEnabled", err)
	}
	if _, err := accounts.EnableBalanceTracking(ctx, userID, source.ID, sourceBalance); err != nil {
		t.Fatalf("enable source tracking: %v", err)
	}
	created, err := transactions.Create(ctx, userID, payment)
	if err != nil {
		t.Fatalf("create tracked statement payment: %v", err)
	}
	assertAccountAmount(t, ctx, admin, source.ID, "balance_cents", 9000)
	assertAccountAmount(t, ctx, admin, trackedCard.ID, "available_credit_cents", 16000)
	assertTransactionLedger(t, ctx, admin, created.ID, map[string]int64{source.ID: -1000, trackedCard.ID: 1000})
	listed, err := statements.List(ctx, userID, trackedCard.ID)
	if err != nil {
		t.Fatalf("list tracked statement: %v", err)
	}
	if len(listed) != 1 || listed[0].PaidAmountCents != 1000 {
		t.Fatalf("tracked statement = %+v, want paidAmountCents 1000", listed)
	}

	untrackedCard, err := accounts.Create(ctx, userID, store.AccountInput{
		Name: "Untracked statement card", Type: "credit", Institution: "Bank",
		Last4: "7003", Currency: "MXN", CreditLimitCents: &limit, AvailableCreditCents: &available,
	})
	if err != nil {
		t.Fatalf("create untracked card: %v", err)
	}
	untrackedStatement, err := statements.Confirm(ctx, userID, untrackedCard.ID, store.CreditCardStatementInput{
		CycleStartDate: "2026-05-01", CycleEndDate: "2026-05-31",
		PaymentDueDate: "2026-06-20", StatementBalanceCents: 1000,
	})
	if err != nil {
		t.Fatalf("confirm untracked card statement: %v", err)
	}
	payment.TransferToAccount = &untrackedCard.ID
	payment.CreditCardStatementID = &untrackedStatement.ID
	if _, err := transactions.Create(ctx, userID, payment); !errors.Is(err, store.ErrBalanceTrackingNotEnabled) {
		t.Fatalf("untracked destination error = %v, want ErrBalanceTrackingNotEnabled", err)
	}
}

func TestCreditCardStatementForeignKeyRejectsCrossUserLink(t *testing.T) {
	pool, userID := setupPool(t, "public.credit_card_statements")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	admin := newAdminPool(t, ctx)
	defer admin.Close()

	accounts := store.NewAccountRepository(pool)
	limit, available := int64(1000), int64(1000)
	ownerCard, err := accounts.Create(ctx, userID, store.AccountInput{
		Name: "Owner card", Type: "credit", Institution: "Bank", Last4: "6001",
		Currency: "MXN", CreditLimitCents: &limit, AvailableCreditCents: &available,
	})
	if err != nil {
		t.Fatalf("create owner card: %v", err)
	}
	statement, err := store.NewCreditCardStatementRepository(pool).Confirm(ctx, userID, ownerCard.ID, store.CreditCardStatementInput{
		CycleStartDate: "2026-01-01", CycleEndDate: "2026-01-31",
		PaymentDueDate: "2026-02-20", StatementBalanceCents: 100,
	})
	if err != nil {
		t.Fatalf("confirm owner statement: %v", err)
	}
	otherID := seedAuthUser(t, ctx, admin, "44444444-4444-4444-4444-444444444444", "statement-other@budg.local")
	otherBalance := int64(1000)
	otherSource, err := accounts.Create(ctx, otherID, store.AccountInput{
		Name: "Other source", Type: "debit", Institution: "Bank", Last4: "6002",
		Currency: "MXN", BalanceCents: &otherBalance,
	})
	if err != nil {
		t.Fatalf("create other source: %v", err)
	}
	otherCard, err := accounts.Create(ctx, otherID, store.AccountInput{
		Name: "Other card", Type: "credit", Institution: "Bank", Last4: "6003",
		Currency: "MXN", CreditLimitCents: &limit, AvailableCreditCents: &available,
	})
	if err != nil {
		t.Fatalf("create other card: %v", err)
	}
	_, err = admin.Exec(ctx, `
		INSERT INTO public.transactions (
			user_id, account_id, type, amount, date, description,
			transfer_to_account_id, credit_card_statement_id, affects_balance
		)
		VALUES ($1, $2, 'transfer', 100, CURRENT_DATE, 'Cross-user statement', $3, $4, true)
	`, otherID, otherSource.ID, otherCard.ID, statement.ID)
	if err == nil {
		t.Fatal("cross-user statement link succeeded, want foreign key violation")
	}
	var pgError *pgconn.PgError
	if !errors.As(err, &pgError) || pgError.Code != "23503" || pgError.ConstraintName != "transactions_credit_card_statement_same_user" {
		t.Fatalf("cross-user statement link error = %v, want foreign key violation", err)
	}
}
