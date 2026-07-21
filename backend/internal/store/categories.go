// Package store exposes typed repositories over the project's PostgreSQL
// schema. Each repository owns a single resource and is scoped to a user via
// the caller-supplied userID (resolved by the auth middleware from the
// verified JWT subject). Row-level security on the database is the second
// layer of defense: every query also filters by user_id.
package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned by repositories when a row does not exist for the
// caller's user. We never distinguish "no row" from "row belongs to another
// user" to avoid leaking existence across tenants.
var ErrNotFound = errors.New("not found")

// Category mirrors the public.categories table. JSON tags use the camelCase
// contract the frontend already depends on.
type Category struct {
	ID        string    `json:"id"`
	UserID    string    `json:"-"`
	Name      string    `json:"name"`
	Kind      string    `json:"kind"`
	Color     string    `json:"color"`
	Icon      string    `json:"icon"`
	ParentID  *string   `json:"parentId"`
	IsSystem  bool      `json:"isSystem"`
	SortOrder int       `json:"order"`
	CreatedAt time.Time `json:"-"`
	UpdatedAt time.Time `json:"-"`
}

// CategoryInput captures user-controlled fields on create.
type CategoryInput struct {
	Name      string  `json:"name"`
	Kind      string  `json:"kind"`
	Color     string  `json:"color"`
	Icon      string  `json:"icon"`
	ParentID  *string `json:"parentId"`
	SortOrder int     `json:"order"`
}

// CategoryPatch describes a partial update. nil pointers leave the column
// unchanged. ParentID uses Field[string] so callers can distinguish
// "omitted" from "explicitly cleared to null" -- see field.go for why a
// plain double pointer cannot actually express that with encoding/json.
type CategoryPatch struct {
	Name      *string       `json:"name"`
	Color     *string       `json:"color"`
	Icon      *string       `json:"icon"`
	ParentID  Field[string] `json:"parentId"`
	SortOrder *int          `json:"order"`
}

const categoryColumns = `id, user_id, name, kind, color, icon, parent_id, is_system, sort_order, created_at, updated_at`

func scanCategory(row pgx.Row, c *Category) error {
	return row.Scan(
		&c.ID, &c.UserID, &c.Name, &c.Kind, &c.Color, &c.Icon,
		&c.ParentID, &c.IsSystem, &c.SortOrder, &c.CreatedAt, &c.UpdatedAt,
	)
}

// CategoryRepository is the concrete pgx implementation.
type CategoryRepository struct {
	pool *pgxpool.Pool
}

// NewCategoryRepository builds a CategoryRepository bound to the given pool.
func NewCategoryRepository(pool *pgxpool.Pool) *CategoryRepository {
	return &CategoryRepository{pool: pool}
}

// List returns every category owned by the user, ordered for stable UI display.
func (r *CategoryRepository) List(ctx context.Context, userID string) ([]Category, error) {
	out := make([]Category, 0)
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT `+categoryColumns+`
			FROM public.categories
			WHERE user_id = $1
			ORDER BY sort_order ASC, name ASC
		`, userID)
		if err != nil {
			return fmt.Errorf("list categories: %w", err)
		}
		defer rows.Close()

		for rows.Next() {
			var c Category
			if err := scanCategory(rows, &c); err != nil {
				return fmt.Errorf("scan category: %w", err)
			}
			out = append(out, c)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// Create inserts a new user-scoped category and returns the stored row.
func (r *CategoryRepository) Create(ctx context.Context, userID string, in CategoryInput) (Category, error) {
	var c Category
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			INSERT INTO public.categories (user_id, name, kind, color, icon, parent_id, sort_order)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			RETURNING `+categoryColumns,
			userID, in.Name, in.Kind, in.Color, in.Icon, in.ParentID, in.SortOrder,
		).Scan(
			&c.ID, &c.UserID, &c.Name, &c.Kind, &c.Color, &c.Icon,
			&c.ParentID, &c.IsSystem, &c.SortOrder, &c.CreatedAt, &c.UpdatedAt,
		)
	})
	if err != nil {
		return Category{}, fmt.Errorf("create category: %w", err)
	}
	return c, nil
}

// Update applies a partial update to a category owned by userID.
func (r *CategoryRepository) Update(ctx context.Context, userID, id string, patch CategoryPatch) (Category, error) {
	var c Category
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			UPDATE public.categories SET
				name        = COALESCE($3, name),
				color       = COALESCE($4, color),
				icon        = COALESCE($5, icon),
				parent_id   = CASE WHEN $6::boolean THEN $7 ELSE parent_id END,
				sort_order  = COALESCE($8, sort_order),
				updated_at  = now()
			WHERE user_id = $1 AND id = $2
			RETURNING `+categoryColumns,
			userID, id, patch.Name, patch.Color, patch.Icon,
			patch.ParentID.Set, patch.ParentID.Value, patch.SortOrder,
		).Scan(
			&c.ID, &c.UserID, &c.Name, &c.Kind, &c.Color, &c.Icon,
			&c.ParentID, &c.IsSystem, &c.SortOrder, &c.CreatedAt, &c.UpdatedAt,
		)
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Category{}, ErrNotFound
		}
		return Category{}, fmt.Errorf("update category: %w", err)
	}
	return c, nil
}

// Delete removes a category owned by userID.
func (r *CategoryRepository) Delete(ctx context.Context, userID, id string) error {
	var rowsAffected int64
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			DELETE FROM public.categories
			WHERE user_id = $1 AND id = $2
		`, userID, id)
		if err != nil {
			return err
		}
		rowsAffected = tag.RowsAffected()
		return nil
	})
	if err != nil {
		return fmt.Errorf("delete category: %w", err)
	}
	if rowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}
