package store

import (
	"context"
	"errors"
	"fmt"
	"math"
	"math/big"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// YieldAllocation is the share of a yield reconciliation credited to a goal.
type YieldAllocation struct {
	GoalID string `json:"goalId"`
	Amount int64  `json:"amount"`
}

// YieldReconciliation records one comparison between budg's balance and the
// bank balance of a savings account. The difference is split into earned
// yield (an income transaction) and an adjustment (a plain reconciliation
// ledger entry), and the yield is distributed across the account's goals.
type YieldReconciliation struct {
	ID                  string            `json:"id"`
	AccountID           string            `json:"accountId"`
	TransactionID       *string           `json:"transactionId"`
	Date                string            `json:"date"`
	PeriodStart         string            `json:"periodStart"`
	BalanceBeforeCents  int64             `json:"balanceBefore"`
	BalanceAfterCents   int64             `json:"balanceAfter"`
	YieldCents          int64             `json:"yield"`
	AdjustmentCents     int64             `json:"adjustment"`
	EstimatedYieldCents int64             `json:"estimatedYield"`
	AnnualYieldBps      *int              `json:"annualYieldBps"`
	AnnualYieldTiers    []YieldTier       `json:"annualYieldTiers"`
	Allocations         []YieldAllocation `json:"allocations"`
	operationID         string
}

// YieldReconciliationInput captures a reconciliation request. YieldCents is
// the part of the difference the user attributes to yield; the rest is an
// adjustment. A negative difference cannot contain yield.
type YieldReconciliationInput struct {
	CurrentBalanceCents int64   `json:"currentBalance"`
	YieldCents          int64   `json:"yieldAmount"`
	CategoryID          *string `json:"categoryId"`
	Date                string  `json:"date"`
	IdempotencyKey      *string `json:"-"`
}

// YieldReconciliationResult returns the stored reconciliation and the
// account after the balance change.
type YieldReconciliationResult struct {
	Reconciliation YieldReconciliation `json:"reconciliation"`
	Account        Account             `json:"account"`
}

// EstimateYieldCents approximates yield earned on balance at an annual rate
// compounded daily over days.
func EstimateYieldCents(balance int64, annualYieldBps *int, days int) int64 {
	if annualYieldBps == nil || *annualYieldBps <= 0 || balance <= 0 || days <= 0 {
		return 0
	}
	rate := float64(*annualYieldBps) / 10_000
	return int64(math.Round(float64(balance) * (math.Pow(1+rate/365, float64(days)) - 1)))
}

// EstimateYieldCentsTiered estimates yield when the rate depends on the
// balance: each tier's portion of the balance compounds at its own rate.
// Tiers take precedence over the flat rate when present.
func EstimateYieldCentsTiered(balance int64, flatBps *int, tiers []YieldTier, days int) int64 {
	if balance <= 0 || days <= 0 {
		return 0
	}
	if len(tiers) == 0 {
		return EstimateYieldCents(balance, flatBps, days)
	}
	currentBalance := float64(balance)
	for range days {
		currentBalance += tieredDailyYield(currentBalance, tiers)
	}
	return int64(math.Round(currentBalance - float64(balance)))
}

func tieredDailyYield(balance float64, tiers []YieldTier) float64 {
	var dailyYield float64
	var previousCap float64
	for _, tier := range tiers {
		portion := balance - previousCap
		if tier.UpToCents != nil {
			portion = math.Min(balance, float64(*tier.UpToCents)) - previousCap
		}
		if portion <= 0 {
			break
		}
		dailyYield += portion * float64(tier.AnnualYieldBps) / 10_000 / 365
		if tier.UpToCents == nil {
			break
		}
		previousCap = float64(*tier.UpToCents)
	}
	return dailyYield
}

// BlendedAnnualYieldBps is the single effective configured rate on balance:
// the balance-weighted average of the tiers (or the flat rate). Returns nil
// when nothing is configured or balance is zero.
func BlendedAnnualYieldBps(balance int64, flatBps *int, tiers []YieldTier) *int {
	if balance <= 0 {
		return nil
	}
	if len(tiers) == 0 {
		if flatBps == nil {
			return nil
		}
		bps := *flatBps
		return &bps
	}
	var previousCap int64
	weighted := float64(0)
	for _, tier := range tiers {
		portion := balance - previousCap
		if tier.UpToCents != nil {
			portion = min64(balance, *tier.UpToCents) - previousCap
			if portion <= 0 {
				break
			}
			previousCap = *tier.UpToCents
		}
		weighted += float64(portion) * float64(tier.AnnualYieldBps)
		if tier.UpToCents == nil {
			break
		}
	}
	bps := int64(math.Round(weighted / float64(balance)))
	if bps < 0 {
		bps = 0
	}
	rounded := int(bps)
	return &rounded
}

func min64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

// AccountYieldRepository persists yield reconciliations.
type AccountYieldRepository struct {
	pool *pgxpool.Pool
}

// NewAccountYieldRepository builds an AccountYieldRepository.
func NewAccountYieldRepository(pool *pgxpool.Pool) *AccountYieldRepository {
	return &AccountYieldRepository{pool: pool}
}

const yieldReconciliationColumns = `id, account_id, transaction_id, occurred_on::text, period_start::text,
	balance_before_cents, balance_after_cents, yield_cents, adjustment_cents,
	estimated_yield_cents, annual_yield_bps, annual_yield_tiers, operation_id`

func scanYieldReconciliation(row pgx.Row, rec *YieldReconciliation) error {
	return row.Scan(
		&rec.ID, &rec.AccountID, &rec.TransactionID, &rec.Date, &rec.PeriodStart,
		&rec.BalanceBeforeCents, &rec.BalanceAfterCents, &rec.YieldCents, &rec.AdjustmentCents,
		&rec.EstimatedYieldCents, &rec.AnnualYieldBps, &rec.AnnualYieldTiers, &rec.operationID,
	)
}

// List returns every yield reconciliation of the user, newest first.
func (r *AccountYieldRepository) List(ctx context.Context, userID string) ([]YieldReconciliation, error) {
	out := make([]YieldReconciliation, 0)
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT `+yieldReconciliationColumns+`
			FROM public.account_yield_reconciliations
			WHERE user_id = $1
			ORDER BY occurred_on DESC, created_at DESC, id DESC
		`, userID)
		if err != nil {
			return err
		}
		index := map[string]int{}
		for rows.Next() {
			var rec YieldReconciliation
			if err := scanYieldReconciliation(rows, &rec); err != nil {
				rows.Close()
				return err
			}
			rec.Allocations = []YieldAllocation{}
			index[rec.operationID] = len(out)
			out = append(out, rec)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()

		allocations, err := tx.Query(ctx, `
			SELECT operation_id, goal_id, amount_cents
			FROM public.savings_goal_allocations
			WHERE user_id = $1 AND kind = 'yield'
			ORDER BY goal_id
		`, userID)
		if err != nil {
			return err
		}
		defer allocations.Close()
		for allocations.Next() {
			var operationID string
			var allocation YieldAllocation
			if err := allocations.Scan(&operationID, &allocation.GoalID, &allocation.Amount); err != nil {
				return err
			}
			if i, ok := index[operationID]; ok {
				out[i].Allocations = append(out[i].Allocations, allocation)
			}
		}
		return allocations.Err()
	})
	if err != nil {
		return nil, fmt.Errorf("list yield reconciliations: %w", err)
	}
	return out, nil
}

// Reconcile records yield and adjustment for a tracked debit account so its
// balance matches currentBalance, and distributes the yield to goals in
// proportion to the funds each goal has allocated in the account.
func (r *AccountYieldRepository) Reconcile(ctx context.Context, userID, accountID string, in YieldReconciliationInput) (YieldReconciliationResult, error) {
	date, err := time.Parse(time.DateOnly, in.Date)
	if err != nil || in.YieldCents < 0 || accountID == "" {
		return YieldReconciliationResult{}, ErrInvalidTransactionShape
	}
	// Allow one day of clock skew so users west of UTC can use their local today.
	if date.After(time.Now().UTC().Truncate(24*time.Hour).AddDate(0, 0, 1)) {
		return YieldReconciliationResult{}, ErrInvalidTransactionShape
	}
	if in.CategoryID != nil && strings.TrimSpace(*in.CategoryID) == "" {
		return YieldReconciliationResult{}, ErrInvalidTransactionShape
	}

	var result YieldReconciliationResult
	err = RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		request := map[string]any{"accountId": accountID, "input": in}
		replayID, replay, err := beginIdempotentCreate(ctx, tx, userID, in.IdempotencyKey, "yield_reconciliation", request)
		if err != nil {
			return err
		}
		if replay {
			rec, err := loadYieldReconciliation(ctx, tx, userID, replayID, false)
			if errors.Is(err, ErrNotFound) {
				return newIdempotencyReplayDeletedError(replayID)
			}
			if err != nil {
				return err
			}
			result.Reconciliation = rec
			return scanAccount(tx.QueryRow(ctx, `SELECT `+accountColumns+` FROM public.accounts WHERE user_id = $1 AND id = $2`, userID, rec.AccountID), &result.Account)
		}

		accounts, err := lockTransactionAccounts(ctx, tx, userID, []string{accountID})
		if err != nil {
			return err
		}
		account := accounts[accountID]
		if account.typeName != "debit" || account.balanceCents == nil {
			return ErrInvalidAccountShape
		}
		if !account.trackingEnabled {
			return ErrBalanceTrackingNotEnabled
		}
		var active bool
		if err := tx.QueryRow(ctx, `SELECT is_active FROM public.accounts WHERE user_id = $1 AND id = $2`, userID, accountID).Scan(&active); err != nil {
			return err
		}
		if !active {
			return ErrInvalidAccountShape
		}
		// The bank figure is as of in.Date, so budg's balance must be too:
		// reject when balance-affecting movements are dated after it.
		var laterMovements bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM public.transactions
				WHERE user_id = $1 AND affects_balance AND date > $3::date
				  AND (account_id = $2 OR transfer_to_account_id = $2)
			)
		`, userID, accountID, in.Date).Scan(&laterMovements); err != nil {
			return err
		}
		if laterMovements {
			return ErrYieldDateBeforeMovements
		}

		var bps *int
		var tiers []YieldTier
		var reconciledOn *string
		var trackingStartedAt *time.Time
		if err := tx.QueryRow(ctx, `
			SELECT annual_yield_bps, annual_yield_tiers,
				yield_reconciled_on::text, balance_tracking_started_at
			FROM public.accounts
			WHERE user_id = $1 AND id = $2
		`, userID, accountID).Scan(&bps, &tiers, &reconciledOn, &trackingStartedAt); err != nil {
			return err
		}
		periodStart := in.Date
		switch {
		case reconciledOn != nil:
			periodStart = *reconciledOn
		case trackingStartedAt != nil:
			periodStart = trackingStartedAt.UTC().Format(time.DateOnly)
		}
		start, err := time.Parse(time.DateOnly, periodStart)
		if err != nil {
			return err
		}
		if date.Before(start) {
			if reconciledOn != nil {
				return ErrInvalidTransactionShape
			}
			start, periodStart = date, in.Date
		}

		balanceBefore := *account.balanceCents
		delta := in.CurrentBalanceCents - balanceBefore
		if (delta >= 0 && in.YieldCents > delta) || (delta < 0 && in.YieldCents != 0) {
			return ErrInvalidTransactionShape
		}
		days := int(date.Sub(start).Hours() / 24)
		estimate := EstimateYieldCentsTiered(balanceBefore, bps, tiers, days)
		tiersDBValue, err := yieldTiersDBValue(tiers)
		if err != nil {
			return err
		}

		if in.CategoryID != nil {
			var kind string
			err := tx.QueryRow(ctx, `
				SELECT kind FROM public.categories WHERE user_id = $1 AND id = $2
			`, userID, *in.CategoryID).Scan(&kind)
			if errors.Is(err, pgx.ErrNoRows) || (err == nil && kind != "income") {
				return ErrInvalidTransactionShape
			}
			if err != nil {
				return err
			}
		}

		var transactionID *string
		if in.YieldCents > 0 {
			transaction, _, err := createTransactionWithLockedAccounts(ctx, tx, userID, TransactionInput{
				AccountID:   accountID,
				Type:        "income",
				Amount:      in.YieldCents,
				CategoryID:  in.CategoryID,
				Date:        in.Date,
				Description: "Rendimientos",
			}, accounts)
			if err != nil {
				return err
			}
			transactionID = &transaction.ID
		}

		adjustment := delta - in.YieldCents
		if adjustment != 0 {
			if err := applyReconciliationAdjustment(ctx, tx, userID, account, adjustment); err != nil {
				return err
			}
		}

		rec := YieldReconciliation{}
		if err := scanYieldReconciliation(tx.QueryRow(ctx, `
			INSERT INTO public.account_yield_reconciliations (
				user_id, account_id, transaction_id, occurred_on, period_start,
				balance_before_cents, balance_after_cents, yield_cents, adjustment_cents,
				estimated_yield_cents, annual_yield_bps, annual_yield_tiers
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
			RETURNING `+yieldReconciliationColumns,
			userID, accountID, transactionID, in.Date, periodStart,
			balanceBefore, in.CurrentBalanceCents, in.YieldCents, adjustment, estimate, bps, tiersDBValue,
		), &rec); err != nil {
			return err
		}

		rec.Allocations, err = distributeYield(ctx, tx, userID, accountID, rec.operationID, in.Date, in.YieldCents, balanceBefore)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE public.accounts SET yield_reconciled_on = $3, updated_at = now()
			WHERE user_id = $1 AND id = $2
		`, userID, accountID, in.Date); err != nil {
			return err
		}
		if err := completeIdempotentCreate(ctx, tx, userID, in.IdempotencyKey, "yield_reconciliation", rec.ID); err != nil {
			return err
		}
		result.Reconciliation = rec
		return scanAccount(tx.QueryRow(ctx, `SELECT `+accountColumns+` FROM public.accounts WHERE user_id = $1 AND id = $2`, userID, accountID), &result.Account)
	})
	if err != nil {
		return YieldReconciliationResult{}, fmt.Errorf("reconcile yield: %w", err)
	}
	return result, nil
}

// Undo reverts the latest yield reconciliation of an account: goal shares,
// the yield income transaction, and the adjustment.
func (r *AccountYieldRepository) Undo(ctx context.Context, userID, accountID, id string) (Account, error) {
	var account Account
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		accounts, err := lockTransactionAccounts(ctx, tx, userID, []string{accountID})
		if err != nil {
			return err
		}
		rec, err := loadYieldReconciliation(ctx, tx, userID, id, true)
		if err != nil {
			return err
		}
		if rec.AccountID != accountID {
			return ErrNotFound
		}
		var latestID string
		if err := tx.QueryRow(ctx, `
			SELECT id FROM public.account_yield_reconciliations
			WHERE user_id = $1 AND account_id = $2
			ORDER BY occurred_on DESC, created_at DESC, id DESC
			LIMIT 1
		`, userID, accountID).Scan(&latestID); err != nil {
			return err
		}
		if latestID != id {
			return ErrYieldReconciliationNotLatest
		}

		goalIDs := make([]string, 0, len(rec.Allocations))
		var removedAllocations int64
		for _, allocation := range rec.Allocations {
			goalIDs = append(goalIDs, allocation.GoalID)
			removedAllocations += allocation.Amount
		}
		if _, err := lockSavingsGoals(ctx, tx, userID, goalIDs); err != nil {
			return err
		}
		// Each goal must still hold its share in this account, and removing the
		// yield must not leave the account with more allocated than its balance.
		for _, allocation := range rec.Allocations {
			var held int64
			if err := tx.QueryRow(ctx, `
				SELECT COALESCE(SUM(amount_cents), 0) FROM public.savings_goal_allocations
				WHERE user_id = $1 AND goal_id = $2 AND account_id = $3
			`, userID, allocation.GoalID, accountID).Scan(&held); err != nil {
				return err
			}
			if held < allocation.Amount {
				return ErrInsufficientGoalAllocation
			}
		}
		var totalAllocated int64
		if err := tx.QueryRow(ctx, `
			SELECT COALESCE(SUM(amount_cents), 0) FROM public.savings_goal_allocations
			WHERE user_id = $1 AND account_id = $2
		`, userID, accountID).Scan(&totalAllocated); err != nil {
			return err
		}
		locked := accounts[accountID]
		if locked.balanceCents == nil {
			return ErrInvalidAccountShape
		}
		balanceAfterUndo := *locked.balanceCents - rec.YieldCents - rec.AdjustmentCents
		if totalAllocated-removedAllocations > balanceAfterUndo && balanceAfterUndo < *locked.balanceCents {
			return ErrInsufficientUnallocatedSavings
		}
		for _, allocation := range rec.Allocations {
			if _, err := applySavingsGoalDelta(ctx, tx, userID, allocation.GoalID, -allocation.Amount, nil); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `
			DELETE FROM public.savings_goal_allocations
			WHERE user_id = $1 AND operation_id = $2 AND kind = 'yield'
		`, userID, rec.operationID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			DELETE FROM public.account_yield_reconciliations WHERE user_id = $1 AND id = $2
		`, userID, id); err != nil {
			return err
		}

		if rec.TransactionID != nil {
			entries, err := loadTransactionBalanceEntries(ctx, tx, userID, *rec.TransactionID)
			if err != nil {
				return err
			}
			if err := reverseTransactionBalanceEntries(ctx, tx, userID, entries, accounts); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `DELETE FROM public.transactions WHERE user_id = $1 AND id = $2`, userID, *rec.TransactionID); err != nil {
				return err
			}
		}
		if rec.AdjustmentCents != 0 {
			if err := applyReconciliationAdjustment(ctx, tx, userID, accounts[accountID], -rec.AdjustmentCents); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `
			UPDATE public.accounts SET
				yield_reconciled_on = (
					SELECT MAX(occurred_on) FROM public.account_yield_reconciliations
					WHERE user_id = $1 AND account_id = $2
				),
				updated_at = now()
			WHERE user_id = $1 AND id = $2
		`, userID, accountID); err != nil {
			return err
		}
		return scanAccount(tx.QueryRow(ctx, `SELECT `+accountColumns+` FROM public.accounts WHERE user_id = $1 AND id = $2`, userID, accountID), &account)
	})
	if err != nil {
		return Account{}, fmt.Errorf("undo yield reconciliation: %w", err)
	}
	return account, nil
}

func loadYieldReconciliation(ctx context.Context, tx pgx.Tx, userID, id string, forUpdate bool) (YieldReconciliation, error) {
	query := `SELECT ` + yieldReconciliationColumns + ` FROM public.account_yield_reconciliations WHERE user_id = $1 AND id = $2`
	if forUpdate {
		query += ` FOR UPDATE`
	}
	var rec YieldReconciliation
	if err := scanYieldReconciliation(tx.QueryRow(ctx, query, userID, id), &rec); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return YieldReconciliation{}, ErrNotFound
		}
		return YieldReconciliation{}, err
	}
	rows, err := tx.Query(ctx, `
		SELECT goal_id, amount_cents FROM public.savings_goal_allocations
		WHERE user_id = $1 AND operation_id = $2 AND kind = 'yield'
		ORDER BY goal_id
	`, userID, rec.operationID)
	if err != nil {
		return YieldReconciliation{}, err
	}
	defer rows.Close()
	rec.Allocations = []YieldAllocation{}
	for rows.Next() {
		var allocation YieldAllocation
		if err := rows.Scan(&allocation.GoalID, &allocation.Amount); err != nil {
			return YieldReconciliation{}, err
		}
		rec.Allocations = append(rec.Allocations, allocation)
	}
	return rec, rows.Err()
}

func applyReconciliationAdjustment(ctx context.Context, tx pgx.Tx, userID string, account lockedAccount, delta int64) error {
	if err := updateMaterializedBalance(ctx, tx, userID, account, delta); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO public.account_balance_entries (user_id, account_id, kind, delta_cents)
		VALUES ($1, $2, 'reconciliation', $3)
	`, userID, account.id, delta)
	return err
}

// YieldShares splits yield across goals in proportion to the money each goal
// had allocated in the account. The denominator is the larger of the account
// balance and the total allocated, so unallocated funds keep their share as
// free balance. Shares round down; leftover cents stay unallocated.
func YieldShares(yield, balance int64, allocated map[string]int64) []YieldAllocation {
	if yield <= 0 || len(allocated) == 0 {
		return []YieldAllocation{}
	}
	var total int64
	goalIDs := make([]string, 0, len(allocated))
	for goalID, amount := range allocated {
		if amount > 0 {
			total += amount
			goalIDs = append(goalIDs, goalID)
		}
	}
	denominator := balance
	if total > denominator {
		denominator = total
	}
	if denominator <= 0 {
		return []YieldAllocation{}
	}
	sort.Strings(goalIDs)
	shares := make([]YieldAllocation, 0, len(goalIDs))
	for _, goalID := range goalIDs {
		share := new(big.Int).Mul(big.NewInt(yield), big.NewInt(allocated[goalID]))
		share.Quo(share, big.NewInt(denominator))
		if share.Sign() > 0 {
			shares = append(shares, YieldAllocation{GoalID: goalID, Amount: share.Int64()})
		}
	}
	return shares
}

func distributeYield(ctx context.Context, tx pgx.Tx, userID, accountID, operationID, date string, yield, balance int64) ([]YieldAllocation, error) {
	if yield <= 0 {
		return []YieldAllocation{}, nil
	}
	idRows, err := tx.Query(ctx, `
		SELECT DISTINCT goal_id FROM public.savings_goal_allocations
		WHERE user_id = $1 AND account_id = $2
	`, userID, accountID)
	if err != nil {
		return nil, err
	}
	candidateIDs := []string{}
	for idRows.Next() {
		var goalID string
		if err := idRows.Scan(&goalID); err != nil {
			idRows.Close()
			return nil, err
		}
		candidateIDs = append(candidateIDs, goalID)
	}
	if err := idRows.Err(); err != nil {
		idRows.Close()
		return nil, err
	}
	idRows.Close()
	// Lock goals before summing so concurrent allocations cannot change the
	// sums the shares are computed from.
	if _, err := lockSavingsGoals(ctx, tx, userID, candidateIDs); err != nil {
		return nil, err
	}

	rows, err := tx.Query(ctx, `
		SELECT goal_id, SUM(amount_cents)
		FROM public.savings_goal_allocations
		WHERE user_id = $1 AND account_id = $2
		GROUP BY goal_id
		HAVING SUM(amount_cents) > 0
	`, userID, accountID)
	if err != nil {
		return nil, err
	}
	allocated := map[string]int64{}
	for rows.Next() {
		var goalID string
		var amount int64
		if err := rows.Scan(&goalID, &amount); err != nil {
			rows.Close()
			return nil, err
		}
		allocated[goalID] = amount
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	shares := YieldShares(yield, balance, allocated)
	for _, share := range shares {
		if _, err := tx.Exec(ctx, `
			INSERT INTO public.savings_goal_allocations (
				user_id, goal_id, account_id, operation_id, amount_cents, kind, occurred_on
			)
			VALUES ($1, $2, $3, $4, $5, 'yield', $6)
		`, userID, share.GoalID, accountID, operationID, share.Amount, date); err != nil {
			return nil, err
		}
		if _, err := applySavingsGoalDelta(ctx, tx, userID, share.GoalID, share.Amount, &accountID); err != nil {
			return nil, err
		}
	}
	return shares, nil
}
