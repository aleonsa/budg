package store

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RecurringTransaction is an expense template that materializes normal
// transactions when Process finds a due occurrence.
type RecurringTransaction struct {
	ID          string    `json:"id"`
	UserID      string    `json:"-"`
	AccountID   string    `json:"accountId"`
	CategoryID  *string   `json:"categoryId"`
	Description string    `json:"description"`
	Merchant    *string   `json:"merchant,omitempty"`
	Amount      int64     `json:"amount"`
	Frequency   string    `json:"frequency"`
	StartDate   string    `json:"startDate"`
	NextDate    string    `json:"nextDate"`
	IsActive    bool      `json:"isActive"`
	CreatedAt   time.Time `json:"-"`
	UpdatedAt   time.Time `json:"-"`
}

// RecurringTransactionInput captures fields a user controls when creating a
// recurring expense. Future occurrences are calculated by Process.
type RecurringTransactionInput struct {
	AccountID   string  `json:"accountId"`
	CategoryID  *string `json:"categoryId"`
	Description string  `json:"description"`
	Merchant    *string `json:"merchant"`
	Amount      int64   `json:"amount"`
	Frequency   string  `json:"frequency"`
	StartDate   string  `json:"startDate"`
}

type dueRecurringTransaction struct {
	id          string
	accountID   string
	categoryID  *string
	description string
	merchant    *string
	amount      int64
	frequency   string
	startDate   string
	nextDate    string
	occurrences int
}

const recurringTransactionColumns = `id, user_id, account_id, category_id, description, merchant,
	amount, frequency, start_date::text, next_date::text, is_active, created_at, updated_at`

func scanRecurringTransaction(row pgx.Row, r *RecurringTransaction) error {
	return row.Scan(
		&r.ID, &r.UserID, &r.AccountID, &r.CategoryID, &r.Description, &r.Merchant,
		&r.Amount, &r.Frequency, &r.StartDate, &r.NextDate, &r.IsActive, &r.CreatedAt, &r.UpdatedAt,
	)
}

// RecurringTransactionRepository is the pgx implementation.
type RecurringTransactionRepository struct{ pool *pgxpool.Pool }

func NewRecurringTransactionRepository(pool *pgxpool.Pool) *RecurringTransactionRepository {
	return &RecurringTransactionRepository{pool: pool}
}

func (r *RecurringTransactionRepository) List(ctx context.Context, userID string) ([]RecurringTransaction, error) {
	out := make([]RecurringTransaction, 0)
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT `+recurringTransactionColumns+`
			FROM public.recurring_transactions
			WHERE user_id = $1
			ORDER BY is_active DESC, next_date ASC, id ASC
		`, userID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var recurring RecurringTransaction
			if err := scanRecurringTransaction(rows, &recurring); err != nil {
				return err
			}
			out = append(out, recurring)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, fmt.Errorf("list recurring transactions: %w", err)
	}
	return out, nil
}

func (r *RecurringTransactionRepository) Create(ctx context.Context, userID string, in RecurringTransactionInput) (RecurringTransaction, error) {
	var recurring RecurringTransaction
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		return scanRecurringTransaction(tx.QueryRow(ctx, `
			INSERT INTO public.recurring_transactions (
				user_id, account_id, category_id, description, merchant, amount,
				frequency, start_date, next_date
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
			RETURNING `+recurringTransactionColumns,
			userID, in.AccountID, in.CategoryID, in.Description, in.Merchant, in.Amount,
			in.Frequency, in.StartDate,
		), &recurring)
	})
	if err != nil {
		return RecurringTransaction{}, fmt.Errorf("create recurring transaction: %w", err)
	}
	return recurring, nil
}

// Process atomically materializes every due occurrence for userID. FOR UPDATE
// serializes concurrent app opens, so React StrictMode or multiple browser
// tabs cannot create duplicate transactions.
func (r *RecurringTransactionRepository) Process(ctx context.Context, userID string) (int, error) {
	created := 0
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id, account_id, category_id, description, merchant, amount,
				frequency, start_date::text, next_date::text, occurrences_generated
			FROM public.recurring_transactions
			WHERE user_id = $1 AND is_active AND next_date <= current_date
			ORDER BY next_date ASC, id ASC
			FOR UPDATE
		`, userID)
		if err != nil {
			return err
		}
		dueRows := make([]dueRecurringTransaction, 0)
		for rows.Next() {
			var due dueRecurringTransaction
			if err := rows.Scan(&due.id, &due.accountID, &due.categoryID, &due.description, &due.merchant, &due.amount, &due.frequency, &due.startDate, &due.nextDate, &due.occurrences); err != nil {
				rows.Close()
				return err
			}
			dueRows = append(dueRows, due)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()

		today := time.Now().UTC().Truncate(24 * time.Hour)
		accountIDs := make([]string, 0, len(dueRows))
		for _, recurring := range dueRows {
			accountIDs = append(accountIDs, recurring.accountID)
		}
		accounts, err := lockTransactionAccounts(ctx, tx, userID, accountIDs)
		if err != nil {
			return err
		}
		affectsBalance := true
		for _, recurring := range dueRows {
			due, err := time.Parse("2006-01-02", recurring.nextDate)
			if err != nil {
				return fmt.Errorf("parse recurring next date %q: %w", recurring.nextDate, err)
			}
			for !due.After(today) {
				_, inserted, err := createTransactionWithLockedAccounts(ctx, tx, userID, TransactionInput{
					AccountID: recurring.accountID, Type: "expense", Amount: recurring.amount,
					CategoryID: recurring.categoryID, Date: due.Format("2006-01-02"),
					Description: recurring.description, Merchant: recurring.merchant,
					AffectsBalance: &affectsBalance,
				}, accounts)
				if err != nil {
					return err
				}
				if inserted {
					created++
				}
				recurring.occurrences++
				var calculated string
				if err := tx.QueryRow(ctx, `
					SELECT CASE $2
						WHEN 'monthly' THEN ($1::date + ($3 * interval '1 month'))::date::text
						ELSE ($1::date + ($3 * interval '1 year'))::date::text
					END
				`, recurring.startDate, recurring.frequency, recurring.occurrences).Scan(&calculated); err != nil {
					return err
				}
				recurring.nextDate = calculated
				due, err = time.Parse("2006-01-02", recurring.nextDate)
				if err != nil {
					return err
				}
			}
			if _, err := tx.Exec(ctx, `
				UPDATE public.recurring_transactions
				SET occurrences_generated = $3, next_date = $4, updated_at = now()
				WHERE user_id = $1 AND id = $2
			`, userID, recurring.id, recurring.occurrences, recurring.nextDate); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("process recurring transactions: %w", err)
	}
	return created, nil
}
