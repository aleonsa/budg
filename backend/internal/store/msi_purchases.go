package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrMSIRequiresCreditAccount prevents callers outside the frontend from
// scheduling an MSI purchase on a debit account.
var ErrMSIRequiresCreditAccount = errors.New("msi purchase requires a credit account")

// MSIPurchase mirrors the public.msi_purchases table. JSON tags use the
// camelCase contract the frontend already depends on.
type MSIPurchase struct {
	ID                  string    `json:"id"`
	UserID              string    `json:"-"`
	AccountID           string    `json:"accountId"`
	CategoryID          *string   `json:"categoryId"`
	Description         string    `json:"description"`
	Merchant            *string   `json:"merchant,omitempty"`
	TotalAmount         int64     `json:"totalAmount"`
	InstallmentAmount   int64     `json:"installmentAmount"`
	InstallmentCount    int       `json:"installmentCount"`
	InstallmentsPaid    int       `json:"installmentsPaid"`
	StartDate           string    `json:"startDate"`
	NextInstallmentDate *string   `json:"nextInstallmentDate,omitempty"`
	Status              string    `json:"status"`
	CreatedAt           time.Time `json:"-"`
	UpdatedAt           time.Time `json:"-"`
}

// MSIPurchaseInput captures user-controlled fields when scheduling a new
// MSI purchase. Create expands it into one expense transaction per month.
type MSIPurchaseInput struct {
	AccountID        string  `json:"accountId"`
	CategoryID       *string `json:"categoryId"`
	Description      string  `json:"description"`
	Merchant         *string `json:"merchant"`
	TotalAmount      int64   `json:"totalAmount"`
	InstallmentCount int     `json:"installmentCount"`
	StartDate        string  `json:"startDate"`
}

const msiPurchaseColumns = `id, user_id, account_id, category_id, description, merchant,
	total_amount, installment_amount, installment_count, installments_paid,
	start_date::text, next_installment_date::text, status, created_at, updated_at`

func scanMSIPurchase(row pgx.Row, m *MSIPurchase) error {
	err := row.Scan(
		&m.ID, &m.UserID, &m.AccountID, &m.CategoryID, &m.Description, &m.Merchant,
		&m.TotalAmount, &m.InstallmentAmount, &m.InstallmentCount, &m.InstallmentsPaid,
		&m.StartDate, &m.NextInstallmentDate, &m.Status, &m.CreatedAt, &m.UpdatedAt,
	)
	if err != nil {
		return err
	}
	if len(m.StartDate) >= 10 {
		m.StartDate = m.StartDate[:10]
	}
	if m.NextInstallmentDate != nil && len(*m.NextInstallmentDate) >= 10 {
		truncated := (*m.NextInstallmentDate)[:10]
		m.NextInstallmentDate = &truncated
	}
	return nil
}

// MSIPurchaseRepository is the concrete pgx implementation.
type MSIPurchaseRepository struct {
	pool *pgxpool.Pool
}

// NewMSIPurchaseRepository builds an MSIPurchaseRepository bound to the pool.
func NewMSIPurchaseRepository(pool *pgxpool.Pool) *MSIPurchaseRepository {
	return &MSIPurchaseRepository{pool: pool}
}

// List returns every MSI purchase owned by the user.
func (r *MSIPurchaseRepository) List(ctx context.Context, userID string) ([]MSIPurchase, error) {
	out := make([]MSIPurchase, 0)
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT `+msiPurchaseColumns+`
			FROM public.msi_purchases
			WHERE user_id = $1
			ORDER BY start_date DESC, id DESC
		`, userID)
		if err != nil {
			return fmt.Errorf("list msi purchases: %w", err)
		}
		defer rows.Close()

		for rows.Next() {
			var m MSIPurchase
			if err := scanMSIPurchase(rows, &m); err != nil {
				return fmt.Errorf("scan msi purchase: %w", err)
			}
			out = append(out, m)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// Create schedules an MSI purchase and all of its monthly expense
// transactions atomically. The final installment absorbs any remainder so
// the generated transaction amounts always sum to TotalAmount exactly.
func (r *MSIPurchaseRepository) Create(ctx context.Context, userID string, in MSIPurchaseInput) (MSIPurchase, error) {
	var m MSIPurchase
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		var accountType string
		if err := tx.QueryRow(ctx, `
			SELECT type
			FROM public.accounts
			WHERE user_id = $1 AND id = $2
		`, userID, in.AccountID).Scan(&accountType); err != nil {
			return err
		}
		if accountType != "credit" {
			return ErrMSIRequiresCreditAccount
		}

		installmentAmount := in.TotalAmount / int64(in.InstallmentCount)
		if err := tx.QueryRow(ctx, `
			INSERT INTO public.msi_purchases (
				user_id, account_id, category_id, description, merchant,
				total_amount, installment_amount, installment_count,
				start_date, next_installment_date
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
			RETURNING `+msiPurchaseColumns,
			userID, in.AccountID, in.CategoryID, in.Description, in.Merchant,
			in.TotalAmount, installmentAmount, in.InstallmentCount, in.StartDate,
		).Scan(
			&m.ID, &m.UserID, &m.AccountID, &m.CategoryID, &m.Description, &m.Merchant,
			&m.TotalAmount, &m.InstallmentAmount, &m.InstallmentCount, &m.InstallmentsPaid,
			&m.StartDate, &m.NextInstallmentDate, &m.Status, &m.CreatedAt, &m.UpdatedAt,
		); err != nil {
			return err
		}

		// Start-date-based interval math preserves month-end schedules: Jan 31
		// becomes Feb 28 then Mar 31, rather than drifting after February.
		tag, err := tx.Exec(ctx, `
			INSERT INTO public.transactions (
				user_id, account_id, type, amount, category_id, date,
				description, merchant, msi_purchase_id
			)
			SELECT
				$1,
				$2,
				'expense',
				CASE
					WHEN installment.number = $5
						THEN $4 - (($4 / $5) * ($5 - 1))
					ELSE $4 / $5
				END,
				$3,
				($6::date + ((installment.number - 1) * interval '1 month'))::date,
				$7 || ' (' || installment.number || '/' || $5 || ')',
				$8,
				$9
			FROM generate_series(1, $5) AS installment(number)
		`,
			userID, in.AccountID, in.CategoryID, in.TotalAmount, in.InstallmentCount,
			in.StartDate, in.Description, in.Merchant, m.ID,
		)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != int64(in.InstallmentCount) {
			return fmt.Errorf("create msi installments: inserted %d rows, want %d", tag.RowsAffected(), in.InstallmentCount)
		}
		return nil
	})
	if err != nil {
		return MSIPurchase{}, fmt.Errorf("create msi purchase: %w", err)
	}
	return m, nil
}
