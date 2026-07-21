package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Rule mirrors the public.rules table. JSON tags use the camelCase contract
// the frontend already depends on.
type Rule struct {
	ID         string    `json:"id"`
	UserID     string    `json:"-"`
	Field      string    `json:"field"`
	Operator   string    `json:"operator"`
	Value      string    `json:"value"`
	CategoryID string    `json:"categoryId"`
	IsActive   bool      `json:"isActive"`
	Priority   int       `json:"priority"`
	CreatedAt  time.Time `json:"-"`
	UpdatedAt  time.Time `json:"-"`
}

// RuleInput captures user-controlled fields on create. Priority is assigned
// by the database default to preserve the frontend's existing API signature.
type RuleInput struct {
	Field      string `json:"field"`
	Operator   string `json:"operator"`
	Value      string `json:"value"`
	CategoryID string `json:"categoryId"`
	IsActive   bool   `json:"isActive"`
}

const ruleColumns = `id, user_id, field, operator, value, category_id, is_active, priority, created_at, updated_at`

func scanRule(row pgx.Row, rule *Rule) error {
	return row.Scan(
		&rule.ID, &rule.UserID, &rule.Field, &rule.Operator, &rule.Value,
		&rule.CategoryID, &rule.IsActive, &rule.Priority, &rule.CreatedAt, &rule.UpdatedAt,
	)
}

// RuleRepository is concrete pgx implementation.
type RuleRepository struct {
	pool *pgxpool.Pool
}

// NewRuleRepository builds a RuleRepository bound to pool.
func NewRuleRepository(pool *pgxpool.Pool) *RuleRepository {
	return &RuleRepository{pool: pool}
}

// List returns every rule owned by user, ordered by priority.
func (r *RuleRepository) List(ctx context.Context, userID string) ([]Rule, error) {
	out := make([]Rule, 0)
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT `+ruleColumns+`
			FROM public.rules
			WHERE user_id = $1
			ORDER BY priority ASC, id ASC
		`, userID)
		if err != nil {
			return fmt.Errorf("list rules: %w", err)
		}
		defer rows.Close()

		for rows.Next() {
			var rule Rule
			if err := scanRule(rows, &rule); err != nil {
				return fmt.Errorf("scan rule: %w", err)
			}
			out = append(out, rule)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// Create inserts a new user-scoped rule and returns stored row.
func (r *RuleRepository) Create(ctx context.Context, userID string, in RuleInput) (Rule, error) {
	var rule Rule
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			INSERT INTO public.rules (user_id, field, operator, value, category_id, is_active)
			VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING `+ruleColumns,
			userID, in.Field, in.Operator, in.Value, in.CategoryID, in.IsActive,
		).Scan(
			&rule.ID, &rule.UserID, &rule.Field, &rule.Operator, &rule.Value,
			&rule.CategoryID, &rule.IsActive, &rule.Priority, &rule.CreatedAt, &rule.UpdatedAt,
		)
	})
	if err != nil {
		return Rule{}, fmt.Errorf("create rule: %w", err)
	}
	return rule, nil
}

// Toggle atomically flips a rule's active state and returns updated row.
func (r *RuleRepository) Toggle(ctx context.Context, userID, id string) (Rule, error) {
	var rule Rule
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			UPDATE public.rules SET
				is_active = NOT is_active,
				updated_at = now()
			WHERE user_id = $1 AND id = $2
			RETURNING `+ruleColumns,
			userID, id,
		).Scan(
			&rule.ID, &rule.UserID, &rule.Field, &rule.Operator, &rule.Value,
			&rule.CategoryID, &rule.IsActive, &rule.Priority, &rule.CreatedAt, &rule.UpdatedAt,
		)
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Rule{}, ErrNotFound
		}
		return Rule{}, fmt.Errorf("toggle rule: %w", err)
	}
	return rule, nil
}

// Delete removes a rule owned by userID.
func (r *RuleRepository) Delete(ctx context.Context, userID, id string) error {
	var rowsAffected int64
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			DELETE FROM public.rules
			WHERE user_id = $1 AND id = $2
		`, userID, id)
		if err != nil {
			return err
		}
		rowsAffected = tag.RowsAffected()
		return nil
	})
	if err != nil {
		return fmt.Errorf("delete rule: %w", err)
	}
	if rowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}
