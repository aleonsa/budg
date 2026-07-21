package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SavingsGoal mirrors the public.savings_goals table. JSON tags use the camelCase
// contract the frontend already depends on.
type SavingsGoal struct {
	ID            string    `json:"id"`
	UserID        string    `json:"-"`
	Name          string    `json:"name"`
	TargetAmount  int64     `json:"targetAmount"`
	CurrentAmount int64     `json:"currentAmount"`
	AccountID     *string   `json:"accountId"`
	IsCompleted   bool      `json:"isCompleted"`
	SortOrder     int       `json:"order"`
	CreatedAt     time.Time `json:"-"`
	UpdatedAt     time.Time `json:"-"`
}

// SavingsGoalInput captures user-controlled fields on create.
type SavingsGoalInput struct {
	Name          string  `json:"name"`
	TargetAmount  int64   `json:"targetAmount"`
	CurrentAmount int64   `json:"currentAmount"`
	AccountID     *string `json:"accountId"`
	SortOrder     int     `json:"order"`
}

// SavingsGoalPatch describes a partial update. AccountID uses Field[string]
// so callers can distinguish "omitted" from "explicitly cleared to null".
type SavingsGoalPatch struct {
	Name          *string       `json:"name"`
	TargetAmount  *int64        `json:"targetAmount"`
	CurrentAmount *int64        `json:"currentAmount"`
	AccountID     Field[string] `json:"accountId"`
	IsCompleted   *bool         `json:"isCompleted"`
	SortOrder     *int          `json:"order"`
}

const savingsGoalColumns = `id, user_id, name, target_amount, current_amount, account_id, is_completed, sort_order, created_at, updated_at`

func scanSavingsGoal(row pgx.Row, g *SavingsGoal) error {
	return row.Scan(
		&g.ID, &g.UserID, &g.Name, &g.TargetAmount, &g.CurrentAmount,
		&g.AccountID, &g.IsCompleted, &g.SortOrder, &g.CreatedAt, &g.UpdatedAt,
	)
}

// SavingsGoalRepository is the concrete pgx implementation.
type SavingsGoalRepository struct {
	pool *pgxpool.Pool
}

// NewSavingsGoalRepository builds a SavingsGoalRepository bound to the pool.
func NewSavingsGoalRepository(pool *pgxpool.Pool) *SavingsGoalRepository {
	return &SavingsGoalRepository{pool: pool}
}

// List returns every savings goal owned by the user, ordered by sort order.
func (r *SavingsGoalRepository) List(ctx context.Context, userID string) ([]SavingsGoal, error) {
	out := make([]SavingsGoal, 0)
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT `+savingsGoalColumns+`
			FROM public.savings_goals
			WHERE user_id = $1
			ORDER BY sort_order ASC, name ASC
		`, userID)
		if err != nil {
			return fmt.Errorf("list savings goals: %w", err)
		}
		defer rows.Close()

		for rows.Next() {
			var g SavingsGoal
			if err := scanSavingsGoal(rows, &g); err != nil {
				return fmt.Errorf("scan savings goal: %w", err)
			}
			out = append(out, g)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// Create inserts a new user-scoped savings goal and returns the stored row.
func (r *SavingsGoalRepository) Create(ctx context.Context, userID string, in SavingsGoalInput) (SavingsGoal, error) {
	var g SavingsGoal
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			INSERT INTO public.savings_goals (user_id, name, target_amount, current_amount, account_id, sort_order)
			VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING `+savingsGoalColumns,
			userID, in.Name, in.TargetAmount, in.CurrentAmount, in.AccountID, in.SortOrder,
		).Scan(
			&g.ID, &g.UserID, &g.Name, &g.TargetAmount, &g.CurrentAmount,
			&g.AccountID, &g.IsCompleted, &g.SortOrder, &g.CreatedAt, &g.UpdatedAt,
		)
	})
	if err != nil {
		return SavingsGoal{}, fmt.Errorf("create savings goal: %w", err)
	}
	return g, nil
}

// Update applies a partial update to a savings goal owned by userID.
func (r *SavingsGoalRepository) Update(ctx context.Context, userID, id string, patch SavingsGoalPatch) (SavingsGoal, error) {
	accPresent, accVal := patch.AccountID.Set, patch.AccountID.Value

	var g SavingsGoal
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			UPDATE public.savings_goals SET
				name           = COALESCE($3, name),
				target_amount  = COALESCE($4, target_amount),
				current_amount = COALESCE($5, current_amount),
				account_id     = CASE WHEN $6::boolean THEN $7 ELSE account_id END,
				is_completed   = COALESCE($8, is_completed),
				sort_order     = COALESCE($9, sort_order),
				updated_at     = now()
			WHERE user_id = $1 AND id = $2
			RETURNING `+savingsGoalColumns,
			userID, id,
			patch.Name, patch.TargetAmount, patch.CurrentAmount,
			accPresent, accVal,
			patch.IsCompleted, patch.SortOrder,
		).Scan(
			&g.ID, &g.UserID, &g.Name, &g.TargetAmount, &g.CurrentAmount,
			&g.AccountID, &g.IsCompleted, &g.SortOrder, &g.CreatedAt, &g.UpdatedAt,
		)
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return SavingsGoal{}, ErrNotFound
		}
		return SavingsGoal{}, fmt.Errorf("update savings goal: %w", err)
	}
	return g, nil
}

// Delete removes a savings goal owned by userID.
func (r *SavingsGoalRepository) Delete(ctx context.Context, userID, id string) error {
	var rowsAffected int64
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			DELETE FROM public.savings_goals
			WHERE user_id = $1 AND id = $2
		`, userID, id)
		if err != nil {
			return err
		}
		rowsAffected = tag.RowsAffected()
		return nil
	})
	if err != nil {
		return fmt.Errorf("delete savings goal: %w", err)
	}
	if rowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}
