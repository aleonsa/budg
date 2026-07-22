package store

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Transaction mirrors the public.transactions table. JSON tags use the
// camelCase contract the frontend already depends on.
type Transaction struct {
	ID                    string    `json:"id"`
	UserID                string    `json:"-"`
	AccountID             string    `json:"accountId"`
	Type                  string    `json:"type"`
	Amount                int64     `json:"amount"`
	CategoryID            *string   `json:"categoryId"`
	Date                  string    `json:"date"`
	Description           string    `json:"description"`
	Merchant              *string   `json:"merchant,omitempty"`
	MSIPurchaseID         *string   `json:"msiPurchaseId,omitempty"`
	TransferToAccount     *string   `json:"transferToAccountId,omitempty"`
	CreditCardStatementID *string   `json:"creditCardStatementId,omitempty"`
	AffectsBalance        bool      `json:"affectsBalance"`
	IdempotencyKey        *string   `json:"-"`
	IsReconciled          bool      `json:"isReconciled"`
	CreatedAt             string    `json:"createdAt"`
	UpdatedAt             time.Time `json:"-"`
}

// TransactionInput captures user-controlled fields on create. A nil
// AffectsBalance defaults to true.
type TransactionInput struct {
	AccountID             string  `json:"accountId"`
	Type                  string  `json:"type"`
	Amount                int64   `json:"amount"`
	CategoryID            *string `json:"categoryId"`
	Date                  string  `json:"date"`
	Description           string  `json:"description"`
	Merchant              *string `json:"merchant"`
	MSIPurchaseID         *string `json:"msiPurchaseId"`
	TransferToAccount     *string `json:"transferToAccountId"`
	CreditCardStatementID *string `json:"creditCardStatementId"`
	AffectsBalance        *bool   `json:"affectsBalance"`
	IdempotencyKey        *string `json:"-"`
}

// TransactionPatch describes a partial update.
type TransactionPatch struct {
	AccountID             *string       `json:"accountId"`
	Type                  *string       `json:"type"`
	Amount                *int64        `json:"amount"`
	CategoryID            Field[string] `json:"categoryId"`
	Date                  *string       `json:"date"`
	Description           *string       `json:"description"`
	Merchant              Field[string] `json:"merchant"`
	MSIPurchaseID         Field[string] `json:"msiPurchaseId"`
	TransferToAccount     Field[string] `json:"transferToAccountId"`
	CreditCardStatementID Field[string] `json:"creditCardStatementId"`
	AffectsBalance        *bool         `json:"affectsBalance"`
	IsReconciled          *bool         `json:"isReconciled"`
}

const transactionColumns = `id, user_id, account_id, type, amount, category_id,
	date::text, description, merchant, msi_purchase_id, transfer_to_account_id,
	credit_card_statement_id, affects_balance, idempotency_key, is_reconciled, created_at::text, updated_at`

func scanTransaction(row pgx.Row, transaction *Transaction) error {
	err := row.Scan(
		&transaction.ID, &transaction.UserID, &transaction.AccountID, &transaction.Type,
		&transaction.Amount, &transaction.CategoryID, &transaction.Date,
		&transaction.Description, &transaction.Merchant, &transaction.MSIPurchaseID,
		&transaction.TransferToAccount, &transaction.CreditCardStatementID, &transaction.AffectsBalance,
		&transaction.IdempotencyKey, &transaction.IsReconciled, &transaction.CreatedAt, &transaction.UpdatedAt,
	)
	if err != nil {
		return err
	}
	if len(transaction.Date) >= 10 {
		transaction.Date = transaction.Date[:10]
	}
	if len(transaction.CreatedAt) >= 10 {
		transaction.CreatedAt = transaction.CreatedAt[:10]
	}
	return nil
}

type lockedAccount struct {
	id                   string
	typeName             string
	currency             string
	trackingEnabled      bool
	balanceCents         *int64
	availableCreditCents *int64
}

type balanceEntry struct {
	accountID string
	delta     int64
}

// TransactionRepository is the concrete pgx implementation.
type TransactionRepository struct {
	pool *pgxpool.Pool
}

// NewTransactionRepository builds a TransactionRepository bound to the pool.
func NewTransactionRepository(pool *pgxpool.Pool) *TransactionRepository {
	return &TransactionRepository{pool: pool}
}

// List returns every transaction owned by the user, ordered descending by date.
func (r *TransactionRepository) List(ctx context.Context, userID string) ([]Transaction, error) {
	out := make([]Transaction, 0)
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT `+transactionColumns+`
			FROM public.transactions
			WHERE user_id = $1
			ORDER BY date DESC, id DESC
		`, userID)
		if err != nil {
			return fmt.Errorf("list transactions: %w", err)
		}
		defer rows.Close()

		for rows.Next() {
			var transaction Transaction
			if err := scanTransaction(rows, &transaction); err != nil {
				return fmt.Errorf("scan transaction: %w", err)
			}
			out = append(out, transaction)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// Create inserts a transaction and applies its tracked account effects in one
// database transaction.
func (r *TransactionRepository) Create(ctx context.Context, userID string, in TransactionInput) (Transaction, error) {
	transaction := transactionFromInput(in)
	if err := validateTransactionShape(transaction); err != nil {
		return Transaction{}, err
	}

	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		accounts, err := lockTransactionAccounts(ctx, tx, userID, transactionAccountIDs(transaction))
		if err != nil {
			return err
		}
		transaction, _, err = createTransactionWithLockedAccounts(ctx, tx, userID, in, accounts)
		return err
	})
	if err != nil {
		return Transaction{}, fmt.Errorf("create transaction: %w", err)
	}
	return transaction, nil
}

// Update reverses recorded ledger effects, applies the patch, and writes new
// effects atomically.
func (r *TransactionRepository) Update(ctx context.Context, userID, id string, patch TransactionPatch) (Transaction, error) {
	var updated Transaction
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		var existing Transaction
		if err := scanTransaction(tx.QueryRow(ctx, `
			SELECT `+transactionColumns+`
			FROM public.transactions
			WHERE user_id = $1 AND id = $2
			FOR UPDATE
		`, userID, id), &existing); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}

		updated = applyTransactionPatch(existing, patch)
		if err := validateTransactionShape(updated); err != nil {
			return err
		}
		statementLinkAdded := patch.CreditCardStatementID.Set && patch.CreditCardStatementID.Value != nil
		balanceShapePatched := patch.AccountID != nil || patch.Type != nil || patch.Amount != nil ||
			patch.TransferToAccount.Set || patch.AffectsBalance != nil || statementLinkAdded
		accountsNeedValidation := balanceShapePatched || updated.CreditCardStatementID != nil
		var accounts map[string]lockedAccount
		var entries []balanceEntry
		var err error
		if balanceShapePatched {
			entries, err = loadTransactionBalanceEntries(ctx, tx, userID, id)
			if err != nil {
				return err
			}
		}
		if accountsNeedValidation {
			accountIDs := append(transactionAccountIDs(existing), transactionAccountIDs(updated)...)
			for _, entry := range entries {
				accountIDs = append(accountIDs, entry.accountID)
			}
			accounts, err = lockTransactionAccounts(ctx, tx, userID, accountIDs)
			if err != nil {
				return err
			}
			if err := validateTransactionAccounts(updated, accounts); err != nil {
				return err
			}
		}
		if err := validateTransactionStatement(ctx, tx, userID, updated); err != nil {
			return err
		}
		if err := validateStatementBalanceTracking(updated, accounts); err != nil {
			return err
		}
		if balanceShapePatched {
			if err := reverseTransactionBalanceEntries(ctx, tx, userID, entries, accounts); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `
				DELETE FROM public.account_balance_entries
				WHERE user_id = $1 AND transaction_id = $2
			`, userID, id); err != nil {
				return err
			}
		}
		categoryPresent, categoryValue := patch.CategoryID.Set, patch.CategoryID.Value
		merchantPresent, merchantValue := patch.Merchant.Set, patch.Merchant.Value
		msiPresent, msiValue := patch.MSIPurchaseID.Set, patch.MSIPurchaseID.Value
		transferPresent, transferValue := patch.TransferToAccount.Set, patch.TransferToAccount.Value
		statementPresent, statementValue := patch.CreditCardStatementID.Set, patch.CreditCardStatementID.Value
		row := tx.QueryRow(ctx, `
			UPDATE public.transactions SET
				account_id             = COALESCE($3, account_id),
				type                   = COALESCE($4, type),
				amount                 = COALESCE($5, amount),
				category_id            = CASE WHEN $6::boolean THEN $7 ELSE category_id END,
				date                   = COALESCE($8, date),
				description            = COALESCE($9, description),
				merchant               = CASE WHEN $10::boolean THEN $11 ELSE merchant END,
				msi_purchase_id        = CASE WHEN $12::boolean THEN $13 ELSE msi_purchase_id END,
				transfer_to_account_id = CASE WHEN $14::boolean THEN $15 ELSE transfer_to_account_id END,
				credit_card_statement_id = CASE WHEN $16::boolean THEN $17 ELSE credit_card_statement_id END,
				is_reconciled          = COALESCE($18, is_reconciled),
				affects_balance        = COALESCE($19, affects_balance),
				updated_at             = now()
			WHERE user_id = $1 AND id = $2
			RETURNING `+transactionColumns,
			userID, id, patch.AccountID, patch.Type, patch.Amount,
			categoryPresent, categoryValue, patch.Date, patch.Description,
			merchantPresent, merchantValue, msiPresent, msiValue,
			transferPresent, transferValue, statementPresent, statementValue,
			patch.IsReconciled, patch.AffectsBalance,
		)
		if err := scanTransaction(row, &updated); err != nil {
			return err
		}
		if !balanceShapePatched {
			return nil
		}
		return applyTransactionEffects(ctx, tx, userID, updated, accounts)
	})
	if err != nil {
		return Transaction{}, fmt.Errorf("update transaction: %w", err)
	}
	return updated, nil
}

func transactionFromInput(in TransactionInput) Transaction {
	affectsBalance := true
	if in.AffectsBalance != nil {
		affectsBalance = *in.AffectsBalance
	}
	return Transaction{
		AccountID: in.AccountID, Type: in.Type, Amount: in.Amount,
		CategoryID: in.CategoryID, Date: in.Date, Description: in.Description,
		Merchant: in.Merchant, MSIPurchaseID: in.MSIPurchaseID,
		TransferToAccount: in.TransferToAccount, CreditCardStatementID: in.CreditCardStatementID,
		AffectsBalance: affectsBalance, IdempotencyKey: in.IdempotencyKey,
	}
}

func createTransactionWithLockedAccounts(
	ctx context.Context,
	tx pgx.Tx,
	userID string,
	in TransactionInput,
	accounts map[string]lockedAccount,
) (Transaction, bool, error) {
	transaction := transactionFromInput(in)
	if err := validateTransactionShape(transaction); err != nil {
		return Transaction{}, false, err
	}
	if err := validateTransactionAccounts(transaction, accounts); err != nil {
		return Transaction{}, false, err
	}
	if err := validateTransactionStatement(ctx, tx, userID, transaction); err != nil {
		return Transaction{}, false, err
	}
	if err := validateStatementBalanceTracking(transaction, accounts); err != nil {
		return Transaction{}, false, err
	}

	row := tx.QueryRow(ctx, `
		INSERT INTO public.transactions (
			user_id, account_id, type, amount, category_id, date,
			description, merchant, msi_purchase_id, transfer_to_account_id,
			credit_card_statement_id, affects_balance, idempotency_key
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
		ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
		RETURNING `+transactionColumns,
		userID, in.AccountID, in.Type, in.Amount, in.CategoryID, in.Date,
		in.Description, in.Merchant, in.MSIPurchaseID, in.TransferToAccount,
		in.CreditCardStatementID, transaction.AffectsBalance, in.IdempotencyKey,
	)
	if err := scanTransaction(row, &transaction); err != nil {
		if !errors.Is(err, pgx.ErrNoRows) || in.IdempotencyKey == nil {
			return Transaction{}, false, err
		}
		var existing Transaction
		if err := scanTransaction(tx.QueryRow(ctx, `
			SELECT `+transactionColumns+`
			FROM public.transactions
			WHERE user_id = $1 AND idempotency_key = $2
		`, userID, *in.IdempotencyKey), &existing); err != nil {
			return Transaction{}, false, err
		}
		if !sameMaterialTransaction(existing, transactionFromInput(in)) {
			return Transaction{}, false, ErrIdempotencyConflict
		}
		return existing, false, nil
	}
	if err := applyTransactionEffects(ctx, tx, userID, transaction, accounts); err != nil {
		return Transaction{}, false, err
	}
	return transaction, true, nil
}

func sameMaterialTransaction(existing, requested Transaction) bool {
	return existing.AccountID == requested.AccountID &&
		existing.Type == requested.Type &&
		existing.Amount == requested.Amount &&
		equalOptionalString(existing.CategoryID, requested.CategoryID) &&
		existing.Date == requested.Date &&
		existing.Description == requested.Description &&
		equalOptionalString(existing.Merchant, requested.Merchant) &&
		equalOptionalString(existing.MSIPurchaseID, requested.MSIPurchaseID) &&
		equalOptionalString(existing.TransferToAccount, requested.TransferToAccount) &&
		equalOptionalString(existing.CreditCardStatementID, requested.CreditCardStatementID) &&
		existing.AffectsBalance == requested.AffectsBalance
}

func equalOptionalString(first, second *string) bool {
	return first == nil && second == nil || first != nil && second != nil && *first == *second
}

// Delete reverses existing ledger entries exactly once before deleting the
// transaction and its cascading ledger rows.
func (r *TransactionRepository) Delete(ctx context.Context, userID, id string) error {
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		var existing Transaction
		if err := scanTransaction(tx.QueryRow(ctx, `
			SELECT `+transactionColumns+`
			FROM public.transactions
			WHERE user_id = $1 AND id = $2
			FOR UPDATE
		`, userID, id), &existing); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		entries, err := loadTransactionBalanceEntries(ctx, tx, userID, id)
		if err != nil {
			return err
		}
		accountIDs := transactionAccountIDs(existing)
		for _, entry := range entries {
			accountIDs = append(accountIDs, entry.accountID)
		}
		accounts, err := lockTransactionAccounts(ctx, tx, userID, accountIDs)
		if err != nil {
			return err
		}
		if err := reverseTransactionBalanceEntries(ctx, tx, userID, entries, accounts); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `DELETE FROM public.transactions WHERE user_id = $1 AND id = $2`, userID, id)
		return err
	})
	if err != nil {
		return fmt.Errorf("delete transaction: %w", err)
	}
	return nil
}

func applyTransactionPatch(transaction Transaction, patch TransactionPatch) Transaction {
	if patch.AccountID != nil {
		transaction.AccountID = *patch.AccountID
	}
	if patch.Type != nil {
		transaction.Type = *patch.Type
	}
	if patch.Amount != nil {
		transaction.Amount = *patch.Amount
	}
	if patch.CategoryID.Set {
		transaction.CategoryID = patch.CategoryID.Value
	}
	if patch.Date != nil {
		transaction.Date = *patch.Date
	}
	if patch.Description != nil {
		transaction.Description = *patch.Description
	}
	if patch.Merchant.Set {
		transaction.Merchant = patch.Merchant.Value
	}
	if patch.MSIPurchaseID.Set {
		transaction.MSIPurchaseID = patch.MSIPurchaseID.Value
	}
	if patch.TransferToAccount.Set {
		transaction.TransferToAccount = patch.TransferToAccount.Value
	}
	if patch.CreditCardStatementID.Set {
		transaction.CreditCardStatementID = patch.CreditCardStatementID.Value
	}
	if patch.AffectsBalance != nil {
		transaction.AffectsBalance = *patch.AffectsBalance
	}
	if patch.IsReconciled != nil {
		transaction.IsReconciled = *patch.IsReconciled
	}
	return transaction
}

func validateTransactionShape(transaction Transaction) error {
	if transaction.AccountID == "" || transaction.Amount <= 0 || strings.TrimSpace(transaction.Description) == "" {
		return ErrInvalidTransactionShape
	}
	switch transaction.Type {
	case "expense", "income":
		if transaction.TransferToAccount != nil || transaction.CreditCardStatementID != nil {
			return ErrInvalidTransactionShape
		}
	case "transfer":
		if transaction.TransferToAccount == nil || *transaction.TransferToAccount == "" ||
			*transaction.TransferToAccount == transaction.AccountID || transaction.CategoryID != nil {
			return ErrInvalidTransactionShape
		}
	default:
		return ErrInvalidTransactionShape
	}
	if transaction.CreditCardStatementID != nil && !transaction.AffectsBalance {
		return ErrInvalidTransactionShape
	}
	return nil
}

func validateTransactionStatement(ctx context.Context, tx pgx.Tx, userID string, transaction Transaction) error {
	if transaction.CreditCardStatementID == nil {
		return nil
	}
	if transaction.Type != "transfer" || transaction.TransferToAccount == nil {
		return ErrInvalidTransactionShape
	}
	var statementAccountID string
	err := tx.QueryRow(ctx, `
		SELECT account_id
		FROM public.credit_card_statements
		WHERE user_id = $1 AND id = $2
		FOR KEY SHARE
	`, userID, *transaction.CreditCardStatementID).Scan(&statementAccountID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if statementAccountID != *transaction.TransferToAccount {
		return ErrInvalidTransactionShape
	}
	return nil
}

func transactionAccountIDs(transaction Transaction) []string {
	ids := []string{transaction.AccountID}
	if transaction.TransferToAccount != nil {
		ids = append(ids, *transaction.TransferToAccount)
	}
	return ids
}

func lockTransactionAccounts(ctx context.Context, tx pgx.Tx, userID string, ids []string) (map[string]lockedAccount, error) {
	unique := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		if id != "" {
			unique[id] = struct{}{}
		}
	}
	sortedIDs := make([]string, 0, len(unique))
	for id := range unique {
		sortedIDs = append(sortedIDs, id)
	}
	sort.Strings(sortedIDs)

	accounts := make(map[string]lockedAccount, len(sortedIDs))
	for _, id := range sortedIDs {
		var account lockedAccount
		err := tx.QueryRow(ctx, `
			SELECT id, type, currency, balance_tracking_enabled,
				balance_cents, available_credit_cents
			FROM public.accounts
			WHERE user_id = $1 AND id = $2
			FOR UPDATE
		`, userID, id).Scan(
			&account.id, &account.typeName, &account.currency,
			&account.trackingEnabled, &account.balanceCents,
			&account.availableCreditCents,
		)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		if err != nil {
			return nil, err
		}
		accounts[id] = account
	}
	return accounts, nil
}

func validateTransactionAccounts(transaction Transaction, accounts map[string]lockedAccount) error {
	source, ok := accounts[transaction.AccountID]
	if !ok {
		return ErrNotFound
	}
	if source.typeName != "debit" && source.typeName != "credit" {
		return ErrInvalidAccountShape
	}
	if transaction.Type != "transfer" {
		return nil
	}
	destination, ok := accounts[*transaction.TransferToAccount]
	if !ok {
		return ErrNotFound
	}
	if destination.typeName != "debit" && destination.typeName != "credit" {
		return ErrInvalidAccountShape
	}
	if source.currency != destination.currency {
		return ErrTransferCurrencyMismatch
	}
	return nil
}

func validateStatementBalanceTracking(transaction Transaction, accounts map[string]lockedAccount) error {
	if transaction.CreditCardStatementID == nil {
		return nil
	}
	source, sourceExists := accounts[transaction.AccountID]
	destination, destinationExists := accounts[*transaction.TransferToAccount]
	if !sourceExists || !destinationExists {
		return ErrNotFound
	}
	if !source.trackingEnabled || !destination.trackingEnabled {
		return ErrBalanceTrackingNotEnabled
	}
	return nil
}

func loadTransactionBalanceEntries(ctx context.Context, tx pgx.Tx, userID, transactionID string) ([]balanceEntry, error) {
	rows, err := tx.Query(ctx, `
		SELECT account_id, delta_cents
		FROM public.account_balance_entries
		WHERE user_id = $1 AND transaction_id = $2
		ORDER BY account_id::text
		FOR UPDATE
	`, userID, transactionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	entries := make([]balanceEntry, 0, 2)
	for rows.Next() {
		var entry balanceEntry
		if err := rows.Scan(&entry.accountID, &entry.delta); err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

func applyTransactionEffects(ctx context.Context, tx pgx.Tx, userID string, transaction Transaction, accounts map[string]lockedAccount) error {
	if !transaction.AffectsBalance {
		return nil
	}
	source := accounts[transaction.AccountID]
	var destinationType *string
	if transaction.TransferToAccount != nil {
		destination := accounts[*transaction.TransferToAccount]
		destinationType = &destination.typeName
	}
	deltas, err := ComputeTransactionDeltas(
		transaction.Type, transaction.Amount, transaction.AccountID, source.typeName,
		transaction.TransferToAccount, destinationType,
	)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidTransactionShape, err)
	}
	for _, delta := range deltas {
		account := accounts[delta.AccountID]
		if !account.trackingEnabled {
			continue
		}
		if err := updateMaterializedBalance(ctx, tx, userID, account, delta.Delta); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO public.account_balance_entries (
				user_id, account_id, transaction_id, kind, delta_cents
			)
			VALUES ($1, $2, $3, 'transaction', $4)
		`, userID, delta.AccountID, transaction.ID, delta.Delta); err != nil {
			return err
		}
	}
	return nil
}

func reverseTransactionBalanceEntries(ctx context.Context, tx pgx.Tx, userID string, entries []balanceEntry, accounts map[string]lockedAccount) error {
	for _, entry := range entries {
		account, ok := accounts[entry.accountID]
		if !ok {
			return ErrInvalidAccountShape
		}
		if err := updateMaterializedBalance(ctx, tx, userID, account, -entry.delta); err != nil {
			return err
		}
	}
	return nil
}

func updateMaterializedBalance(ctx context.Context, tx pgx.Tx, userID string, account lockedAccount, delta int64) error {
	var query string
	switch account.typeName {
	case "debit":
		if account.balanceCents == nil {
			return ErrInvalidAccountShape
		}
		query = `UPDATE public.accounts SET balance_cents = balance_cents + $3, updated_at = now() WHERE user_id = $1 AND id = $2`
	case "credit":
		if account.availableCreditCents == nil {
			return ErrInvalidAccountShape
		}
		query = `UPDATE public.accounts SET available_credit_cents = available_credit_cents + $3, updated_at = now() WHERE user_id = $1 AND id = $2`
	default:
		return ErrInvalidAccountShape
	}
	tag, err := tx.Exec(ctx, query, userID, account.id, delta)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrNotFound
	}
	return nil
}
