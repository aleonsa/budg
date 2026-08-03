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
	IdempotencyKey   *string `json:"-"`
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

// Create charges the full principal against tracked available credit and
// schedules historical-only monthly expenses. This avoids charging the card
// again when future installments appear in reports.
func (r *MSIPurchaseRepository) Create(ctx context.Context, userID string, in MSIPurchaseInput) (MSIPurchase, error) {
	var m MSIPurchase
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		accounts, err := lockTransactionAccounts(ctx, tx, userID, []string{in.AccountID})
		if err != nil {
			return err
		}
		account := accounts[in.AccountID]
		if account.typeName != "credit" {
			return ErrMSIRequiresCreditAccount
		}
		if !account.trackingEnabled {
			return ErrBalanceTrackingNotEnabled
		}

		installmentAmount := in.TotalAmount / int64(in.InstallmentCount)
		inserted := true
		err = tx.QueryRow(ctx, `
			INSERT INTO public.msi_purchases (
				user_id, account_id, category_id, description, merchant,
				total_amount, installment_amount, installment_count,
				start_date, next_installment_date, idempotency_key
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10)
			ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
			RETURNING `+msiPurchaseColumns,
			userID, in.AccountID, in.CategoryID, in.Description, in.Merchant,
			in.TotalAmount, installmentAmount, in.InstallmentCount, in.StartDate, in.IdempotencyKey,
		).Scan(
			&m.ID, &m.UserID, &m.AccountID, &m.CategoryID, &m.Description, &m.Merchant,
			&m.TotalAmount, &m.InstallmentAmount, &m.InstallmentCount, &m.InstallmentsPaid,
			&m.StartDate, &m.NextInstallmentDate, &m.Status, &m.CreatedAt, &m.UpdatedAt,
		)
		if errors.Is(err, pgx.ErrNoRows) && in.IdempotencyKey != nil {
			inserted = false
			if err := scanMSIPurchase(tx.QueryRow(ctx, `
				SELECT `+msiPurchaseColumns+`
				FROM public.msi_purchases
				WHERE user_id = $1 AND idempotency_key = $2
			`, userID, *in.IdempotencyKey), &m); err != nil {
				return err
			}
			if !sameMaterialMSIPurchase(m, in) {
				return ErrIdempotencyConflict
			}
		} else if err != nil {
			return err
		}
		if !inserted {
			return nil
		}

		if err := applyMSIPurchaseBalance(ctx, tx, userID, m.ID, in.TotalAmount, account); err != nil {
			return err
		}
		return insertMSIInstallments(ctx, tx, userID, m.ID, in)
	})
	if err != nil {
		return MSIPurchase{}, fmt.Errorf("create msi purchase: %w", err)
	}
	return m, nil
}

// Update replaces an MSI purchase and its generated schedule atomically. A
// purchase that originally affected tracked credit keeps affecting it; legacy
// or pre-tracking purchases remain historical to avoid double charging.
func (r *MSIPurchaseRepository) Update(ctx context.Context, userID, id string, in MSIPurchaseInput) (MSIPurchase, error) {
	var m MSIPurchase
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		var existing MSIPurchase
		if err := scanMSIPurchase(tx.QueryRow(ctx, `
			SELECT `+msiPurchaseColumns+`
			FROM public.msi_purchases
			WHERE user_id = $1 AND id = $2
			FOR UPDATE
		`, userID, id), &existing); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if existing.InstallmentsPaid > 0 {
			return ErrMSIPurchaseHasPaidInstallments
		}

		if err := lockMSIInstallments(ctx, tx, userID, id); err != nil {
			return err
		}
		entries, hadPurchaseEntry, err := loadMSIRelatedBalanceEntries(ctx, tx, userID, id)
		if err != nil {
			return err
		}
		accountIDs := []string{existing.AccountID, in.AccountID}
		for _, entry := range entries {
			accountIDs = append(accountIDs, entry.accountID)
		}
		accounts, err := lockTransactionAccounts(ctx, tx, userID, accountIDs)
		if err != nil {
			return err
		}
		newAccount := accounts[in.AccountID]
		if newAccount.typeName != "credit" {
			return ErrMSIRequiresCreditAccount
		}
		if hadPurchaseEntry && !newAccount.trackingEnabled {
			return ErrBalanceTrackingNotEnabled
		}
		if !hadPurchaseEntry &&
			(existing.AccountID != in.AccountID || existing.TotalAmount != in.TotalAmount ||
				existing.InstallmentCount != in.InstallmentCount || existing.StartDate != in.StartDate) {
			return ErrMSILegacyBalanceChange
		}
		if err := reverseTransactionBalanceEntries(ctx, tx, userID, entries, accounts); err != nil {
			return err
		}
		if err := deleteMSIInstallmentsAndEntries(ctx, tx, userID, id); err != nil {
			return err
		}

		installmentAmount := in.TotalAmount / int64(in.InstallmentCount)
		if err := tx.QueryRow(ctx, `
			UPDATE public.msi_purchases SET
				account_id = $3,
				category_id = $4,
				description = $5,
				merchant = $6,
				total_amount = $7,
				installment_amount = $8,
				installment_count = $9,
				installments_paid = LEAST(installments_paid, $9),
				start_date = $10,
				next_installment_date = $10,
				status = CASE WHEN installments_paid >= $9 THEN 'completed' ELSE 'active' END,
				updated_at = now()
			WHERE user_id = $1 AND id = $2
			RETURNING `+msiPurchaseColumns,
			userID, id, in.AccountID, in.CategoryID, in.Description, in.Merchant,
			in.TotalAmount, installmentAmount, in.InstallmentCount, in.StartDate,
		).Scan(
			&m.ID, &m.UserID, &m.AccountID, &m.CategoryID, &m.Description, &m.Merchant,
			&m.TotalAmount, &m.InstallmentAmount, &m.InstallmentCount, &m.InstallmentsPaid,
			&m.StartDate, &m.NextInstallmentDate, &m.Status, &m.CreatedAt, &m.UpdatedAt,
		); err != nil {
			return err
		}
		if hadPurchaseEntry {
			if err := applyMSIPurchaseBalance(ctx, tx, userID, id, in.TotalAmount, newAccount); err != nil {
				return err
			}
		}
		return insertMSIInstallments(ctx, tx, userID, id, in)
	})
	if err != nil {
		return MSIPurchase{}, fmt.Errorf("update msi purchase: %w", err)
	}
	return m, nil
}

// Delete reverses any tracked principal charge before removing the purchase
// and every generated installment.
func (r *MSIPurchaseRepository) Delete(ctx context.Context, userID, id string) error {
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		var accountID string
		if err := tx.QueryRow(ctx, `
			SELECT account_id
			FROM public.msi_purchases
			WHERE user_id = $1 AND id = $2
			FOR UPDATE
		`, userID, id).Scan(&accountID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if err := lockMSIInstallments(ctx, tx, userID, id); err != nil {
			return err
		}
		entries, _, err := loadMSIRelatedBalanceEntries(ctx, tx, userID, id)
		if err != nil {
			return err
		}
		accountIDs := []string{accountID}
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
		if err := deleteMSIInstallmentsAndEntries(ctx, tx, userID, id); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `DELETE FROM public.msi_purchases WHERE user_id = $1 AND id = $2`, userID, id)
		return err
	})
	if err != nil {
		return fmt.Errorf("delete msi purchase: %w", err)
	}
	return nil
}

func insertMSIInstallments(ctx context.Context, tx pgx.Tx, userID, purchaseID string, in MSIPurchaseInput) error {
	tag, err := tx.Exec(ctx, `
			INSERT INTO public.transactions (
				user_id, account_id, type, amount, category_id, date,
				description, merchant, msi_purchase_id, affects_balance
			)
			SELECT
				$1,
				$2,
				'expense',
				CASE
					WHEN installment.number = $5::int
						THEN $4::bigint - (($4::bigint / $5::int) * ($5::int - 1))
					ELSE $4::bigint / $5::int
				END,
				$3,
				($6::date + ((installment.number - 1) * interval '1 month'))::date,
				$7 || ' (' || installment.number || '/' || $5::text || ')',
				$8,
				$9,
				false
			FROM generate_series(1, $5::int) AS installment(number)
		`,
		userID, in.AccountID, in.CategoryID, in.TotalAmount, in.InstallmentCount,
		in.StartDate, in.Description, in.Merchant, purchaseID,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != int64(in.InstallmentCount) {
		return fmt.Errorf("create msi installments: inserted %d rows, want %d", tag.RowsAffected(), in.InstallmentCount)
	}
	return nil
}

func sameMaterialMSIPurchase(existing MSIPurchase, requested MSIPurchaseInput) bool {
	return existing.AccountID == requested.AccountID &&
		equalOptionalString(existing.CategoryID, requested.CategoryID) &&
		existing.Description == requested.Description &&
		equalOptionalString(existing.Merchant, requested.Merchant) &&
		existing.TotalAmount == requested.TotalAmount &&
		existing.InstallmentCount == requested.InstallmentCount &&
		existing.StartDate == requested.StartDate
}

func applyMSIPurchaseBalance(ctx context.Context, tx pgx.Tx, userID, purchaseID string, amount int64, account lockedAccount) error {
	if !account.trackingEnabled {
		return nil
	}
	if err := updateMaterializedBalance(ctx, tx, userID, account, -amount); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO public.account_balance_entries (
			user_id, account_id, msi_purchase_id, kind, delta_cents
		)
		VALUES ($1, $2, $3, 'msi_purchase', $4)
	`, userID, account.id, purchaseID, -amount)
	return err
}

func loadMSIRelatedBalanceEntries(ctx context.Context, tx pgx.Tx, userID, purchaseID string) ([]balanceEntry, bool, error) {
	rows, err := tx.Query(ctx, `
		SELECT entry.account_id, entry.delta_cents, entry.msi_purchase_id IS NOT NULL
		FROM public.account_balance_entries AS entry
		LEFT JOIN public.transactions AS transaction ON transaction.id = entry.transaction_id
		WHERE entry.user_id = $1
		  AND (entry.msi_purchase_id = $2 OR transaction.msi_purchase_id = $2)
		FOR UPDATE OF entry
	`, userID, purchaseID)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	entries := make([]balanceEntry, 0)
	hadPurchaseEntry := false
	for rows.Next() {
		var entry balanceEntry
		var isPurchaseEntry bool
		if err := rows.Scan(&entry.accountID, &entry.delta, &isPurchaseEntry); err != nil {
			return nil, false, err
		}
		entries = append(entries, entry)
		hadPurchaseEntry = hadPurchaseEntry || isPurchaseEntry
	}
	return entries, hadPurchaseEntry, rows.Err()
}

func lockMSIInstallments(ctx context.Context, tx pgx.Tx, userID, purchaseID string) error {
	rows, err := tx.Query(ctx, `
		SELECT id
		FROM public.transactions
		WHERE user_id = $1 AND msi_purchase_id = $2
		ORDER BY id
		FOR UPDATE
	`, userID, purchaseID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return err
		}
	}
	return rows.Err()
}

func deleteMSIInstallmentsAndEntries(ctx context.Context, tx pgx.Tx, userID, purchaseID string) error {
	if _, err := tx.Exec(ctx, `
		DELETE FROM public.transactions
		WHERE user_id = $1 AND msi_purchase_id = $2
	`, userID, purchaseID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `
		DELETE FROM public.account_balance_entries
		WHERE user_id = $1 AND msi_purchase_id = $2
	`, userID, purchaseID)
	return err
}
