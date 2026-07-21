package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Transaction mirrors the public.transactions table. JSON tags use the
// camelCase contract the frontend already depends on.
type Transaction struct {
	ID                string    `json:"id"`
	UserID            string    `json:"-"`
	AccountID         string    `json:"accountId"`
	Type              string    `json:"type"`
	Amount            int64     `json:"amount"`
	CategoryID        *string   `json:"categoryId"`
	Date              string    `json:"date"`
	Description       string    `json:"description"`
	Merchant          *string   `json:"merchant,omitempty"`
	MSIPurchaseID     *string   `json:"msiPurchaseId,omitempty"`
	TransferToAccount *string   `json:"transferToAccountId,omitempty"`
	IsReconciled      bool      `json:"isReconciled"`
	CreatedAt         string    `json:"createdAt"`
	UpdatedAt         time.Time `json:"-"`
}

// TransactionInput captures user-controlled fields on create.
type TransactionInput struct {
	AccountID         string  `json:"accountId"`
	Type              string  `json:"type"`
	Amount            int64   `json:"amount"`
	CategoryID        *string `json:"categoryId"`
	Date              string  `json:"date"`
	Description       string  `json:"description"`
	Merchant          *string `json:"merchant"`
	MSIPurchaseID     *string `json:"msiPurchaseId"`
	TransferToAccount *string `json:"transferToAccountId"`
}

// TransactionPatch describes a partial update.
type TransactionPatch struct {
	AccountID         *string       `json:"accountId"`
	Type              *string       `json:"type"`
	Amount            *int64        `json:"amount"`
	CategoryID        Field[string] `json:"categoryId"`
	Date              *string       `json:"date"`
	Description       *string       `json:"description"`
	Merchant          Field[string] `json:"merchant"`
	MSIPurchaseID     Field[string] `json:"msiPurchaseId"`
	TransferToAccount Field[string] `json:"transferToAccountId"`
	IsReconciled      *bool         `json:"isReconciled"`
}

const transactionColumns = `id, user_id, account_id, type, amount, category_id,
	date::text, description, merchant, msi_purchase_id, transfer_to_account_id,
	is_reconciled, created_at::text, updated_at`

func scanTransaction(row pgx.Row, t *Transaction) error {
	var createdAtStr string
	var createdAtTime time.Time // fallback if scanned as time
	err := row.Scan(
		&t.ID, &t.UserID, &t.AccountID, &t.Type, &t.Amount, &t.CategoryID,
		&t.Date, &t.Description, &t.Merchant, &t.MSIPurchaseID, &t.TransferToAccount,
		&t.IsReconciled, &createdAtStr, &t.UpdatedAt,
	)
	if err != nil {
		return err
	}
	if len(createdAtStr) >= 10 {
		t.CreatedAt = createdAtStr[:10]
	} else {
		t.CreatedAt = createdAtTime.Format("2006-01-02")
	}
	if len(t.Date) >= 10 {
		t.Date = t.Date[:10]
	}
	return nil
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
			var t Transaction
			if err := scanTransaction(rows, &t); err != nil {
				return fmt.Errorf("scan transaction: %w", err)
			}
			out = append(out, t)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// Create inserts a new user-scoped transaction and returns the stored row.
func (r *TransactionRepository) Create(ctx context.Context, userID string, in TransactionInput) (Transaction, error) {
	var t Transaction
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			INSERT INTO public.transactions (
				user_id, account_id, type, amount, category_id, date,
				description, merchant, msi_purchase_id, transfer_to_account_id
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			RETURNING `+transactionColumns,
			userID, in.AccountID, in.Type, in.Amount, in.CategoryID, in.Date,
			in.Description, in.Merchant, in.MSIPurchaseID, in.TransferToAccount,
		).Scan(
			&t.ID, &t.UserID, &t.AccountID, &t.Type, &t.Amount, &t.CategoryID,
			&t.Date, &t.Description, &t.Merchant, &t.MSIPurchaseID, &t.TransferToAccount,
			&t.IsReconciled, &t.CreatedAt, &t.UpdatedAt,
		)
	})
	if err != nil {
		return Transaction{}, fmt.Errorf("create transaction: %w", err)
	}
	return t, nil
}

// Update applies a partial update to a transaction owned by userID.
func (r *TransactionRepository) Update(ctx context.Context, userID, id string, patch TransactionPatch) (Transaction, error) {
	catPresent, catVal := patch.CategoryID.Set, patch.CategoryID.Value
	merchantPresent, merchantVal := patch.Merchant.Set, patch.Merchant.Value
	msiPresent, msiVal := patch.MSIPurchaseID.Set, patch.MSIPurchaseID.Value
	transferPresent, transferVal := patch.TransferToAccount.Set, patch.TransferToAccount.Value

	var t Transaction
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
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
				is_reconciled          = COALESCE($16, is_reconciled),
				updated_at             = now()
			WHERE user_id = $1 AND id = $2
			RETURNING `+transactionColumns,
			userID, id, patch.AccountID, patch.Type, patch.Amount,
			catPresent, catVal, patch.Date, patch.Description,
			merchantPresent, merchantVal,
			msiPresent, msiVal,
			transferPresent, transferVal,
			patch.IsReconciled,
		).Scan(
			&t.ID, &t.UserID, &t.AccountID, &t.Type, &t.Amount, &t.CategoryID,
			&t.Date, &t.Description, &t.Merchant, &t.MSIPurchaseID, &t.TransferToAccount,
			&t.IsReconciled, &t.CreatedAt, &t.UpdatedAt,
		)
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Transaction{}, ErrNotFound
		}
		return Transaction{}, fmt.Errorf("update transaction: %w", err)
	}
	return t, nil
}

// Delete removes a transaction owned by userID.
func (r *TransactionRepository) Delete(ctx context.Context, userID, id string) error {
	var rowsAffected int64
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			DELETE FROM public.transactions
			WHERE user_id = $1 AND id = $2
		`, userID, id)
		if err != nil {
			return err
		}
		rowsAffected = tag.RowsAffected()
		return nil
	})
	if err != nil {
		return fmt.Errorf("delete transaction: %w", err)
	}
	if rowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}
