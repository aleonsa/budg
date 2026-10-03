package store

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Account mirrors the public.accounts table. JSON tags use the camelCase
// contract the frontend already depends on. Debit accounts populate
// BalanceCents and leave the credit fields nil; credit accounts do the
// reverse (see the accounts_type_fields CHECK constraint in
// migrations/00003_create_accounts.sql).
type Account struct {
	ID                       string      `json:"id"`
	UserID                   string      `json:"-"`
	Name                     string      `json:"name"`
	Type                     string      `json:"type"`
	Institution              string      `json:"institution"`
	Last4                    string      `json:"last4"`
	Currency                 string      `json:"currency"`
	BalanceCents             *int64      `json:"balance,omitempty"`
	CreditLimitCents         *int64      `json:"creditLimit,omitempty"`
	AvailableCreditCents     *int64      `json:"availableCredit,omitempty"`
	StatementCutDay          *int        `json:"statementCutDay,omitempty"`
	PaymentDueDay            *int        `json:"paymentDueDay,omitempty"`
	BalanceTrackingEnabled   bool        `json:"balanceTrackingEnabled"`
	BalanceTrackingStartedAt *time.Time  `json:"balanceTrackingStartedAt,omitempty"`
	AnnualYieldBps           *int        `json:"annualYieldBps"`
	AnnualYieldTiers         []YieldTier `json:"annualYieldTiers"`
	YieldReconciledOn        *string     `json:"yieldReconciledOn"`
	IsActive                 bool        `json:"isActive"`
	CreatedAt                time.Time   `json:"-"`
	UpdatedAt                time.Time   `json:"-"`
}

// AccountInput captures create fields. TrackBalance is server-controlled and
// omitted from JSON; IsActive always starts true.
type AccountInput struct {
	Name                 string      `json:"name"`
	Type                 string      `json:"type"`
	Institution          string      `json:"institution"`
	Last4                string      `json:"last4"`
	Currency             string      `json:"currency"`
	BalanceCents         *int64      `json:"balance"`
	CreditLimitCents     *int64      `json:"creditLimit"`
	AvailableCreditCents *int64      `json:"availableCredit"`
	StatementCutDay      *int        `json:"statementCutDay"`
	PaymentDueDay        *int        `json:"paymentDueDay"`
	AnnualYieldBps       *int        `json:"annualYieldBps"`
	AnnualYieldTiers     []YieldTier `json:"annualYieldTiers"`
	TrackBalance         bool        `json:"-"`
}

// AccountPatch describes a partial update. Type is intentionally not
// patchable: switching debit<->credit would also require clearing one
// shape's fields and populating the other's to satisfy
// accounts_type_fields; create a new account instead. The nullable numeric
// fields use Field[T] so callers can distinguish "omitted" from
// "explicitly cleared to null" -- see field.go for why a plain double
// pointer cannot actually express that with encoding/json.
type AccountPatch struct {
	Name                 *string            `json:"name"`
	Institution          *string            `json:"institution"`
	Last4                *string            `json:"last4"`
	Currency             *string            `json:"currency"`
	IsActive             *bool              `json:"isActive"`
	BalanceCents         Field[int64]       `json:"balance"`
	CreditLimitCents     Field[int64]       `json:"creditLimit"`
	AvailableCreditCents Field[int64]       `json:"availableCredit"`
	StatementCutDay      Field[int]         `json:"statementCutDay"`
	PaymentDueDay        Field[int]         `json:"paymentDueDay"`
	AnnualYieldBps       Field[int]         `json:"annualYieldBps"`
	AnnualYieldTiers     Field[[]YieldTier] `json:"annualYieldTiers"`
}

const accountColumns = `id, user_id, name, type, institution, last4, currency,
	balance_cents, credit_limit_cents, available_credit_cents,
	statement_cut_day, payment_due_day, balance_tracking_enabled,
	balance_tracking_started_at, annual_yield_bps, annual_yield_tiers, yield_reconciled_on::text,
	is_active, created_at, updated_at`

func scanAccount(row pgx.Row, a *Account) error {
	return row.Scan(
		&a.ID, &a.UserID, &a.Name, &a.Type, &a.Institution, &a.Last4, &a.Currency,
		&a.BalanceCents, &a.CreditLimitCents, &a.AvailableCreditCents,
		&a.StatementCutDay, &a.PaymentDueDay, &a.BalanceTrackingEnabled,
		&a.BalanceTrackingStartedAt, &a.AnnualYieldBps, &a.AnnualYieldTiers, &a.YieldReconciledOn,
		&a.IsActive, &a.CreatedAt, &a.UpdatedAt,
	)
}

// MaxAnnualYieldBps caps a configured annual yield at 100%.
const MaxAnnualYieldBps = 10_000

// YieldTier is one band of a tiered rate: the portion of the balance between
// the previous tier's cap and UpToCents earns AnnualYieldBps. The final tier
// has a nil cap.
type YieldTier struct {
	UpToCents      *int64 `json:"upToCents"`
	AnnualYieldBps int    `json:"annualYieldBps"`
}

func (tier *YieldTier) UnmarshalJSON(data []byte) error {
	var wire struct {
		UpToCents      json.RawMessage `json:"upToCents"`
		AnnualYieldBps *int            `json:"annualYieldBps"`
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&wire); err != nil {
		return err
	}
	if len(wire.UpToCents) == 0 {
		return errors.New("upToCents is required")
	}
	if wire.AnnualYieldBps == nil {
		return errors.New("annualYieldBps is required")
	}
	if string(wire.UpToCents) == "null" {
		tier.UpToCents = nil
	} else {
		var cap int64
		if err := json.Unmarshal(wire.UpToCents, &cap); err != nil {
			return fmt.Errorf("decode upToCents: %w", err)
		}
		tier.UpToCents = &cap
	}
	tier.AnnualYieldBps = *wire.AnnualYieldBps
	return nil
}

func validAnnualYield(accountType string, bps *int) bool {
	return bps == nil || (accountType == "debit" && *bps >= 0 && *bps <= MaxAnnualYieldBps)
}

// validYieldTiers reports whether tiers are absent or form a valid ladder: 1
// to 8 bands, strictly increasing positive caps, and one final uncapped band.
func validYieldTiers(accountType string, tiers []YieldTier) bool {
	if accountType != "debit" {
		return len(tiers) == 0
	}
	if len(tiers) == 0 {
		return true
	}
	if len(tiers) > 8 {
		return false
	}
	var previous int64
	for i, tier := range tiers {
		if tier.AnnualYieldBps < 0 || tier.AnnualYieldBps > MaxAnnualYieldBps {
			return false
		}
		if tier.UpToCents == nil {
			return i == len(tiers)-1 // only the last band may be uncapped
		}
		if *tier.UpToCents <= previous {
			return false
		}
		previous = *tier.UpToCents
	}
	return false // a ladder must end with an uncapped band
}

// yieldTiersDBValue serializes the ladder because this package uses pgx's
// simple protocol, which cannot infer how to encode a slice of structs.
func yieldTiersDBValue(tiers []YieldTier) (any, error) {
	if len(tiers) == 0 {
		return nil, nil
	}
	encoded, err := json.Marshal(tiers)
	if err != nil {
		return nil, fmt.Errorf("marshal annual yield tiers: %w", err)
	}
	return string(encoded), nil
}

// AccountRepository is the concrete pgx implementation.
type AccountRepository struct {
	pool *pgxpool.Pool
}

// NewAccountRepository builds an AccountRepository bound to the given pool.
func NewAccountRepository(pool *pgxpool.Pool) *AccountRepository {
	return &AccountRepository{pool: pool}
}

// List returns every account owned by the user, ordered for stable UI display.
func (r *AccountRepository) List(ctx context.Context, userID string) ([]Account, error) {
	out := make([]Account, 0)
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT `+accountColumns+`
			FROM public.accounts
			WHERE user_id = $1
			ORDER BY name ASC
		`, userID)
		if err != nil {
			return fmt.Errorf("list accounts: %w", err)
		}
		defer rows.Close()

		for rows.Next() {
			var a Account
			if err := scanAccount(rows, &a); err != nil {
				return fmt.Errorf("scan account: %w", err)
			}
			out = append(out, a)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// Create inserts a new user-scoped account and returns the stored row.
func (r *AccountRepository) Create(ctx context.Context, userID string, in AccountInput) (Account, error) {
	if !validAnnualYield(in.Type, in.AnnualYieldBps) ||
		!validYieldTiers(in.Type, in.AnnualYieldTiers) {
		return Account{}, ErrInvalidAccountShape
	}
	tiersDBValue, err := yieldTiersDBValue(in.AnnualYieldTiers)
	if err != nil {
		return Account{}, err
	}
	var openingAmount int64
	if in.TrackBalance {
		switch in.Type {
		case "debit":
			if in.BalanceCents == nil {
				return Account{}, ErrInvalidAccountShape
			}
			openingAmount = *in.BalanceCents
		case "credit":
			if in.CreditLimitCents == nil || in.AvailableCreditCents == nil {
				return Account{}, ErrInvalidAccountShape
			}
			openingAmount = *in.AvailableCreditCents
		default:
			return Account{}, ErrInvalidAccountShape
		}
	}

	var a Account
	err = RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		row := tx.QueryRow(ctx, `
			INSERT INTO public.accounts (
				user_id, name, type, institution, last4, currency,
				balance_cents, credit_limit_cents, available_credit_cents,
				statement_cut_day, payment_due_day,
				balance_tracking_enabled, balance_tracking_started_at, annual_yield_bps,
				annual_yield_tiers
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
				CASE WHEN $12 THEN now() ELSE NULL END, $13, $14::jsonb)
			RETURNING `+accountColumns,
			userID, in.Name, in.Type, in.Institution, in.Last4, in.Currency,
			in.BalanceCents, in.CreditLimitCents, in.AvailableCreditCents,
			in.StatementCutDay, in.PaymentDueDay, in.TrackBalance, in.AnnualYieldBps,
			tiersDBValue,
		)
		if err := scanAccount(row, &a); err != nil {
			return err
		}
		if !in.TrackBalance {
			return nil
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO public.account_balance_entries (user_id, account_id, kind, delta_cents)
			VALUES ($1, $2, 'opening', $3)
		`, userID, a.ID, openingAmount)
		return err
	})
	if err != nil {
		return Account{}, fmt.Errorf("create account: %w", err)
	}
	return a, nil
}

// Update applies a partial update to an account owned by userID.
func (r *AccountRepository) Update(ctx context.Context, userID, id string, patch AccountPatch) (Account, error) {
	var a Account
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		var accountType string
		var trackingEnabled bool
		var creditLimit *int64
		var availableCredit *int64
		if err := tx.QueryRow(ctx, `
			SELECT type, balance_tracking_enabled, credit_limit_cents, available_credit_cents
			FROM public.accounts
			WHERE user_id = $1 AND id = $2
			FOR UPDATE
		`, userID, id).Scan(&accountType, &trackingEnabled, &creditLimit, &availableCredit); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if patch.AnnualYieldBps.Set && !validAnnualYield(accountType, patch.AnnualYieldBps.Value) {
			return ErrInvalidAccountShape
		}
		if patch.AnnualYieldTiers.Set {
			var tiers []YieldTier
			if patch.AnnualYieldTiers.Value != nil {
				tiers = *patch.AnnualYieldTiers.Value
			}
			if !validYieldTiers(accountType, tiers) {
				return ErrInvalidAccountShape
			}
		}
		tiersDBValue, err := normalizePatchTiers(patch.AnnualYieldTiers)
		if err != nil {
			return err
		}
		if trackingEnabled {
			if accountType == "debit" && patch.BalanceCents.Set {
				return ErrDirectBalancePatchForbidden
			}
			if accountType == "credit" && patch.AvailableCreditCents.Set {
				return ErrDirectBalancePatchForbidden
			}
			if accountType == "credit" && patch.CreditLimitCents.Set && patch.CreditLimitCents.Value == nil {
				return ErrInvalidAccountShape
			}
		}
		if patch.Currency != nil {
			var hasSavingsAllocations bool
			if err := tx.QueryRow(ctx, `
				SELECT EXISTS (
					SELECT 1 FROM public.savings_goal_allocations
					WHERE user_id = $1 AND account_id = $2
				)
			`, userID, id).Scan(&hasSavingsAllocations); err != nil {
				return err
			}
			if hasSavingsAllocations {
				return ErrSavingsAccountCurrencyManaged
			}
		}

		availableCreditSet := patch.AvailableCreditCents.Set
		availableCreditValue := patch.AvailableCreditCents.Value
		if trackingEnabled && accountType == "credit" && patch.CreditLimitCents.Set {
			if creditLimit == nil || availableCredit == nil || patch.CreditLimitCents.Value == nil {
				return ErrInvalidAccountShape
			}
			adjusted, err := adjustedAvailableCredit(*creditLimit, *availableCredit, *patch.CreditLimitCents.Value)
			if err != nil {
				return err
			}
			availableCreditSet = true
			availableCreditValue = &adjusted
		}
		row := tx.QueryRow(ctx, `
			UPDATE public.accounts SET
				name                    = COALESCE($3, name),
				institution             = COALESCE($4, institution),
				last4                   = COALESCE($5, last4),
				currency                = COALESCE($6, currency),
				is_active               = COALESCE($7, is_active),
				balance_cents           = CASE WHEN $8::boolean  THEN $9  ELSE balance_cents END,
				credit_limit_cents      = CASE WHEN $10::boolean THEN $11 ELSE credit_limit_cents END,
				available_credit_cents = CASE WHEN $12::boolean THEN $13 ELSE available_credit_cents END,
				statement_cut_day       = CASE WHEN $14::boolean THEN $15 ELSE statement_cut_day END,
				payment_due_day         = CASE WHEN $16::boolean THEN $17 ELSE payment_due_day END,
				annual_yield_bps        = CASE WHEN $18::boolean THEN $19 ELSE annual_yield_bps END,
				annual_yield_tiers      = CASE WHEN $20::boolean THEN $21::jsonb ELSE annual_yield_tiers END,
				updated_at              = now()
			WHERE user_id = $1 AND id = $2
			RETURNING `+accountColumns,
			userID, id, patch.Name, patch.Institution, patch.Last4, patch.Currency, patch.IsActive,
			patch.BalanceCents.Set, patch.BalanceCents.Value,
			patch.CreditLimitCents.Set, patch.CreditLimitCents.Value,
			availableCreditSet, availableCreditValue,
			patch.StatementCutDay.Set, patch.StatementCutDay.Value,
			patch.PaymentDueDay.Set, patch.PaymentDueDay.Value,
			patch.AnnualYieldBps.Set, patch.AnnualYieldBps.Value,
			patch.AnnualYieldTiers.Set, tiersDBValue,
		)
		return scanAccount(row, &a)
	})
	if err != nil {
		return Account{}, fmt.Errorf("update account: %w", err)
	}
	return a, nil
}

func normalizePatchTiers(field Field[[]YieldTier]) (any, error) {
	if !field.Set || field.Value == nil {
		return nil, nil
	}
	return yieldTiersDBValue(*field.Value)
}

func adjustedAvailableCredit(oldLimit, oldAvailable, newLimit int64) (int64, error) {
	if oldLimit < 0 || newLimit < 0 {
		return 0, ErrInvalidAccountShape
	}
	delta := newLimit - oldLimit
	if delta > 0 && oldAvailable > math.MaxInt64-delta || delta < 0 && oldAvailable < math.MinInt64-delta {
		return 0, ErrInvalidAccountShape
	}
	return oldAvailable + delta, nil
}

// EnableBalanceTracking activates automatic balance tracking for an account
// with an opening confirmed amount, recording an opening ledger entry.
func (r *AccountRepository) EnableBalanceTracking(ctx context.Context, userID, id string, currentAmount int64) (Account, error) {
	var a Account
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		var isTracking bool
		var accType string
		var creditLimit *int64
		err := tx.QueryRow(ctx, `
			SELECT balance_tracking_enabled, type, credit_limit_cents
			FROM public.accounts
			WHERE user_id = $1 AND id = $2
			FOR UPDATE
		`, userID, id).Scan(&isTracking, &accType, &creditLimit)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if isTracking {
			return ErrBalanceTrackingAlreadyEnabled
		}

		if accType == "debit" {
			if _, err := tx.Exec(ctx, `
				UPDATE public.accounts
				SET balance_cents = $3, balance_tracking_enabled = true, balance_tracking_started_at = now(), updated_at = now()
				WHERE user_id = $1 AND id = $2
			`, userID, id, currentAmount); err != nil {
				return err
			}
		} else if accType == "credit" {
			if creditLimit == nil {
				return ErrInvalidAccountShape
			}
			if _, err := tx.Exec(ctx, `
				UPDATE public.accounts
				SET available_credit_cents = $3, balance_tracking_enabled = true, balance_tracking_started_at = now(), updated_at = now()
				WHERE user_id = $1 AND id = $2
			`, userID, id, currentAmount); err != nil {
				return err
			}
		} else {
			return ErrInvalidAccountShape
		}

		if _, err := tx.Exec(ctx, `
			INSERT INTO public.account_balance_entries (user_id, account_id, kind, delta_cents)
			VALUES ($1, $2, 'opening', $3)
		`, userID, id, currentAmount); err != nil {
			return err
		}

		return scanAccount(tx.QueryRow(ctx, `
			SELECT `+accountColumns+` FROM public.accounts WHERE user_id = $1 AND id = $2
		`, userID, id), &a)
	})
	if err != nil {
		if errors.Is(err, ErrNotFound) || errors.Is(err, ErrBalanceTrackingAlreadyEnabled) || errors.Is(err, ErrInvalidAccountShape) {
			return Account{}, err
		}
		return Account{}, fmt.Errorf("enable balance tracking: %w", err)
	}
	return a, nil
}

// ReconcileBalance adjusts a tracked account's balance to match a physical
// count or bank statement, inserting a reconciliation audit entry.
func (r *AccountRepository) ReconcileBalance(ctx context.Context, userID, id string, currentAmount int64) (Account, error) {
	var a Account
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		var isTracking bool
		var accType string
		var oldBalance *int64
		var creditLimit *int64
		var oldAvailable *int64
		err := tx.QueryRow(ctx, `
			SELECT balance_tracking_enabled, type, balance_cents, credit_limit_cents, available_credit_cents
			FROM public.accounts
			WHERE user_id = $1 AND id = $2
			FOR UPDATE
		`, userID, id).Scan(&isTracking, &accType, &oldBalance, &creditLimit, &oldAvailable)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if !isTracking {
			return ErrBalanceTrackingNotEnabled
		}

		var oldVal int64
		if accType == "debit" {
			if oldBalance == nil {
				return ErrInvalidAccountShape
			}
			oldVal = *oldBalance
		} else if accType == "credit" {
			if creditLimit == nil || oldAvailable == nil {
				return ErrInvalidAccountShape
			}
			oldVal = *oldAvailable
		} else {
			return ErrInvalidAccountShape
		}

		delta := currentAmount - oldVal
		if delta == 0 {
			return scanAccount(tx.QueryRow(ctx, `
				SELECT `+accountColumns+` FROM public.accounts WHERE user_id = $1 AND id = $2
			`, userID, id), &a)
		}

		if accType == "debit" {
			if _, err := tx.Exec(ctx, `
				UPDATE public.accounts
				SET balance_cents = $3, updated_at = now()
				WHERE user_id = $1 AND id = $2
			`, userID, id, currentAmount); err != nil {
				return err
			}
		} else {
			if _, err := tx.Exec(ctx, `
				UPDATE public.accounts
				SET available_credit_cents = $3, updated_at = now()
				WHERE user_id = $1 AND id = $2
			`, userID, id, currentAmount); err != nil {
				return err
			}
		}

		if _, err := tx.Exec(ctx, `
			INSERT INTO public.account_balance_entries (user_id, account_id, kind, delta_cents)
			VALUES ($1, $2, 'reconciliation', $3)
		`, userID, id, delta); err != nil {
			return err
		}

		return scanAccount(tx.QueryRow(ctx, `
			SELECT `+accountColumns+` FROM public.accounts WHERE user_id = $1 AND id = $2
		`, userID, id), &a)
	})
	if err != nil {
		if errors.Is(err, ErrNotFound) || errors.Is(err, ErrBalanceTrackingNotEnabled) || errors.Is(err, ErrInvalidAccountShape) {
			return Account{}, err
		}
		return Account{}, fmt.Errorf("reconcile balance: %w", err)
	}
	return a, nil
}

// Delete removes an account owned by userID.
func (r *AccountRepository) Delete(ctx context.Context, userID, id string) error {
	var rowsAffected int64
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		// MSI schedules reference their card with ON DELETE RESTRICT. Remove the
		// master first so its same-user cascade clears generated installments
		// before the account delete checks transaction references.
		if _, err := tx.Exec(ctx, `
			DELETE FROM public.msi_purchases
			WHERE user_id = $1 AND account_id = $2
		`, userID, id); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `
			DELETE FROM public.accounts
			WHERE user_id = $1 AND id = $2
		`, userID, id)
		if err != nil {
			return err
		}
		rowsAffected = tag.RowsAffected()
		return nil
	})
	if err != nil {
		return fmt.Errorf("delete account: %w", err)
	}
	if rowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}
