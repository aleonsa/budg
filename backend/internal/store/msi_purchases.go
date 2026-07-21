package store

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MSIPurchase mirrors the public.msi_purchases table. JSON tags use the
// camelCase contract the frontend already depends on. There is currently no
// create/update/delete API for this resource (see
// migrations/00008_create_msi_purchases.sql) -- it is read-only end to end.
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
