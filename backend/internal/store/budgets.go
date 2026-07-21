package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Budget mirrors the public.budgets table. JSON tags use the camelCase contract
// the frontend already depends on.
type Budget struct {
	ID         string    `json:"id"`
	UserID     string    `json:"-"`
	CategoryID *string   `json:"categoryId"`
	Amount     int64     `json:"amount"`
	Period     string    `json:"period"`
	StartDate  string    `json:"startDate"`
	CreatedAt  time.Time `json:"-"`
	UpdatedAt  time.Time `json:"-"`
}

// BudgetInput captures user-controlled fields on create.
type BudgetInput struct {
	CategoryID *string `json:"categoryId"`
	Amount     int64   `json:"amount"`
	Period     string  `json:"period"`
	StartDate  string  `json:"startDate"`
}

// BudgetPatch describes a partial update. CategoryID uses Field[string] so
// callers can distinguish "omitted" from "explicitly cleared to null" (global budget).
type BudgetPatch struct {
	CategoryID Field[string] `json:"categoryId"`
	Amount     *int64        `json:"amount"`
	Period     *string       `json:"period"`
	StartDate  *string       `json:"startDate"`
}

const budgetColumns = `id, user_id, category_id, amount, period, start_date::text, created_at, updated_at`

func scanBudget(row pgx.Row, b *Budget) error {
	err := row.Scan(
		&b.ID, &b.UserID, &b.CategoryID, &b.Amount, &b.Period,
		&b.StartDate, &b.CreatedAt, &b.UpdatedAt,
	)
	if err != nil {
		return err
	}
	if len(b.StartDate) >= 10 {
		b.StartDate = b.StartDate[:10]
	}
	return nil
}

// BudgetRepository is the concrete pgx implementation.
type BudgetRepository struct {
	pool *pgxpool.Pool
}

// NewBudgetRepository builds a BudgetRepository bound to the pool.
func NewBudgetRepository(pool *pgxpool.Pool) *BudgetRepository {
	return &BudgetRepository{pool: pool}
}

// List returns every budget owned by the user.
func (r *BudgetRepository) List(ctx context.Context, userID string) ([]Budget, error) {
	out := make([]Budget, 0)
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT `+budgetColumns+`
			FROM public.budgets
			WHERE user_id = $1
			ORDER BY start_date DESC, id DESC
		`, userID)
		if err != nil {
			return fmt.Errorf("list budgets: %w", err)
		}
		defer rows.Close()

		for rows.Next() {
			var b Budget
			if err := scanBudget(rows, &b); err != nil {
				return fmt.Errorf("scan budget: %w", err)
			}
			out = append(out, b)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// Create inserts a new user-scoped budget and returns the stored row.
func (r *BudgetRepository) Create(ctx context.Context, userID string, in BudgetInput) (Budget, error) {
	var b Budget
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			INSERT INTO public.budgets (user_id, category_id, amount, period, start_date)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING `+budgetColumns,
			userID, in.CategoryID, in.Amount, in.Period, in.StartDate,
		).Scan(
			&b.ID, &b.UserID, &b.CategoryID, &b.Amount, &b.Period,
			&b.StartDate, &b.CreatedAt, &b.UpdatedAt,
		)
	})
	if err != nil {
		return Budget{}, fmt.Errorf("create budget: %w", err)
	}
	return b, nil
}

// Update applies a partial update to a budget owned by userID.
func (r *BudgetRepository) Update(ctx context.Context, userID, id string, patch BudgetPatch) (Budget, error) {
	catPresent, catVal := patch.CategoryID.Set, patch.CategoryID.Value

	var b Budget
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			UPDATE public.budgets SET
				category_id = CASE WHEN $3::boolean THEN $4 ELSE category_id END,
				amount      = COALESCE($5, amount),
				period      = COALESCE($6, period),
				start_date  = COALESCE($7, start_date),
				updated_at  = now()
			WHERE user_id = $1 AND id = $2
			RETURNING `+budgetColumns,
			userID, id,
			catPresent, catVal,
			patch.Amount, patch.Period, patch.StartDate,
		).Scan(
			&b.ID, &b.UserID, &b.CategoryID, &b.Amount, &b.Period,
			&b.StartDate, &b.CreatedAt, &b.UpdatedAt,
		)
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Budget{}, ErrNotFound
		}
		return Budget{}, fmt.Errorf("update budget: %w", err)
	}
	return b, nil
}

// Delete removes a budget owned by userID.
func (r *BudgetRepository) Delete(ctx context.Context, userID, id string) error {
	var rowsAffected int64
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			DELETE FROM public.budgets
			WHERE user_id = $1 AND id = $2
		`, userID, id)
		if err != nil {
			return err
		}
		rowsAffected = tag.RowsAffected()
		return nil
	})
	if err != nil {
		return fmt.Errorf("delete budget: %w", err)
	}
	if rowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}
