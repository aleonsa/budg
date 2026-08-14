package store

import (
	"context"
	"errors"
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

// RecurringTransactionUpdateInput replaces every user-controlled template
// field. Existing materialized transactions are intentionally untouched.
type RecurringTransactionUpdateInput struct {
	AccountID   string  `json:"accountId"`
	CategoryID  *string `json:"categoryId"`
	Description string  `json:"description"`
	Merchant    *string `json:"merchant"`
	Amount      int64   `json:"amount"`
	Frequency   string  `json:"frequency"`
	StartDate   string  `json:"startDate"`
	IsActive    *bool   `json:"isActive"`
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

// Update replaces a recurring template. When its cadence changes or a paused
// template resumes, the schedule advances to its first future occurrence so
// already materialized transactions cannot be generated again.
func (r *RecurringTransactionRepository) Update(ctx context.Context, userID, id string, in RecurringTransactionUpdateInput) (RecurringTransaction, error) {
	if in.IsActive == nil {
		return RecurringTransaction{}, errors.New("isActive is required")
	}
	isActive := *in.IsActive
	var recurring RecurringTransaction
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		existing := dueRecurringTransaction{id: id}
		var existingActive bool
		if err := tx.QueryRow(ctx, `
			SELECT account_id, category_id, description, merchant, amount,
				frequency, start_date::text, next_date::text, occurrences_generated, is_active
			FROM public.recurring_transactions
			WHERE user_id = $1 AND id = $2
			FOR UPDATE
		`, userID, id).Scan(
			&existing.accountID, &existing.categoryID, &existing.description, &existing.merchant,
			&existing.amount, &existing.frequency, &existing.startDate, &existing.nextDate,
			&existing.occurrences, &existingActive,
		); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}

		today := time.Now().UTC().Truncate(24 * time.Hour)
		dueDate, err := time.Parse("2006-01-02", existing.nextDate)
		if err != nil {
			return fmt.Errorf("parse recurring next date %q: %w", existing.nextDate, err)
		}
		if existingActive && !dueDate.After(today) {
			accounts, err := lockTransactionAccounts(ctx, tx, userID, []string{existing.accountID})
			if err != nil {
				return err
			}
			if _, err := materializeRecurringTransaction(ctx, tx, userID, &existing, accounts, today); err != nil {
				return err
			}
		}

		var occurrences *int
		var nextDate *string
		if existing.frequency != in.Frequency || existing.startDate != in.StartDate || (!existingActive && isActive) {
			alignedOccurrences, alignedNextDate, err := alignRecurringSchedule(in.StartDate, in.Frequency, today)
			if err != nil {
				return err
			}
			occurrences = &alignedOccurrences
			nextDate = &alignedNextDate
		}

		return scanRecurringTransaction(tx.QueryRow(ctx, `
			UPDATE public.recurring_transactions SET
				account_id = $3,
				category_id = $4,
				description = $5,
				merchant = $6,
				amount = $7,
				frequency = $8,
				start_date = $9,
				is_active = $10,
				occurrences_generated = COALESCE($11, occurrences_generated),
				next_date = COALESCE($12::date, next_date),
				updated_at = now()
			WHERE user_id = $1 AND id = $2
			RETURNING `+recurringTransactionColumns,
			userID, id, in.AccountID, in.CategoryID, in.Description, in.Merchant,
			in.Amount, in.Frequency, in.StartDate, isActive, occurrences, nextDate,
		), &recurring)
	})
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return RecurringTransaction{}, ErrNotFound
		}
		return RecurringTransaction{}, fmt.Errorf("update recurring transaction: %w", err)
	}
	return recurring, nil
}

// Delete removes only the recurring template. Transactions generated by past
// Process calls remain part of the user's financial history.
func (r *RecurringTransactionRepository) Delete(ctx context.Context, userID, id string) error {
	var rowsAffected int64
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			DELETE FROM public.recurring_transactions
			WHERE user_id = $1 AND id = $2
		`, userID, id)
		if err != nil {
			return err
		}
		rowsAffected = tag.RowsAffected()
		return nil
	})
	if err != nil {
		return fmt.Errorf("delete recurring transaction: %w", err)
	}
	if rowsAffected == 0 {
		return ErrNotFound
	}
	return nil
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
		for i := range dueRows {
			materialized, err := materializeRecurringTransaction(ctx, tx, userID, &dueRows[i], accounts, today)
			if err != nil {
				return err
			}
			created += materialized
		}
		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("process recurring transactions: %w", err)
	}
	return created, nil
}

func materializeRecurringTransaction(
	ctx context.Context,
	tx pgx.Tx,
	userID string,
	recurring *dueRecurringTransaction,
	accounts map[string]lockedAccount,
	today time.Time,
) (int, error) {
	due, err := time.Parse("2006-01-02", recurring.nextDate)
	if err != nil {
		return 0, fmt.Errorf("parse recurring next date %q: %w", recurring.nextDate, err)
	}
	created := 0
	affectsBalance := true
	for !due.After(today) {
		_, inserted, err := createTransactionWithLockedAccounts(ctx, tx, userID, TransactionInput{
			AccountID: recurring.accountID, Type: "expense", Amount: recurring.amount,
			CategoryID: recurring.categoryID, Date: due.Format("2006-01-02"),
			Description: recurring.description, Merchant: recurring.merchant,
			AffectsBalance: &affectsBalance,
		}, accounts)
		if err != nil {
			return 0, err
		}
		if inserted {
			created++
		}
		recurring.occurrences++
		recurring.nextDate, err = recurringOccurrenceDate(recurring.startDate, recurring.frequency, recurring.occurrences)
		if err != nil {
			return 0, err
		}
		due, err = time.Parse("2006-01-02", recurring.nextDate)
		if err != nil {
			return 0, err
		}
	}
	if _, err := tx.Exec(ctx, `
		UPDATE public.recurring_transactions
		SET occurrences_generated = $3, next_date = $4, updated_at = now()
		WHERE user_id = $1 AND id = $2
	`, userID, recurring.id, recurring.occurrences, recurring.nextDate); err != nil {
		return 0, err
	}
	return created, nil
}

func alignRecurringSchedule(startDate, frequency string, today time.Time) (int, string, error) {
	start, err := time.Parse("2006-01-02", startDate)
	if err != nil {
		return 0, "", fmt.Errorf("parse recurring start date %q: %w", startDate, err)
	}
	today = today.UTC().Truncate(24 * time.Hour)
	occurrence := 0
	if frequency == "monthly" {
		occurrence = (today.Year()-start.Year())*12 + int(today.Month()-start.Month())
	} else if frequency == "yearly" {
		occurrence = today.Year() - start.Year()
	} else {
		return 0, "", fmt.Errorf("unsupported recurring frequency %q", frequency)
	}
	if occurrence < 0 {
		occurrence = 0
	}
	candidate, err := recurringOccurrenceDate(startDate, frequency, occurrence)
	if err != nil {
		return 0, "", err
	}
	candidateDate, err := time.Parse("2006-01-02", candidate)
	if err != nil {
		return 0, "", err
	}
	if !candidateDate.After(today) {
		occurrence++
		candidate, err = recurringOccurrenceDate(startDate, frequency, occurrence)
		if err != nil {
			return 0, "", err
		}
	}
	return occurrence, candidate, nil
}

func recurringOccurrenceDate(startDate, frequency string, occurrence int) (string, error) {
	start, err := time.Parse("2006-01-02", startDate)
	if err != nil {
		return "", fmt.Errorf("parse recurring start date %q: %w", startDate, err)
	}
	if occurrence < 0 {
		return "", errors.New("recurring occurrence must not be negative")
	}
	year, month := start.Year(), start.Month()
	switch frequency {
	case "monthly":
		monthIndex := int(month) - 1 + occurrence
		year += monthIndex / 12
		month = time.Month(monthIndex%12 + 1)
	case "yearly":
		year += occurrence
	default:
		return "", fmt.Errorf("unsupported recurring frequency %q", frequency)
	}
	lastDay := time.Date(year, month+1, 0, 0, 0, 0, 0, time.UTC).Day()
	day := start.Day()
	if day > lastDay {
		day = lastDay
	}
	return time.Date(year, month, day, 0, 0, 0, 0, time.UTC).Format("2006-01-02"), nil
}
