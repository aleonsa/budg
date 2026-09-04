package store

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// SavingsAllocationInput assigns existing account funds to a goal. Negative
// amounts release previously assigned funds back to the account's free balance.
type SavingsAllocationInput struct {
	AccountID      string `json:"accountId"`
	Amount         int64  `json:"amount"`
	Date           string `json:"date"`
	IdempotencyKey string `json:"-"`
}

// SaveToGoalInput moves real money between debit accounts and assigns it to a
// goal in the same database transaction.
type SaveToGoalInput struct {
	SourceAccountID      string `json:"sourceAccountId"`
	DestinationAccountID string `json:"destinationAccountId"`
	Amount               int64  `json:"amount"`
	Date                 string `json:"date"`
	Description          string `json:"description"`
	IdempotencyKey       string `json:"-"`
}

// SavingsReallocationInput moves an assignment between goals without creating
// a bank transaction.
type SavingsReallocationInput struct {
	ToGoalID       string `json:"toGoalId"`
	AccountID      string `json:"accountId"`
	Amount         int64  `json:"amount"`
	Date           string `json:"date"`
	IdempotencyKey string `json:"-"`
}

type SavingsGoalActionResult struct {
	Goal        SavingsGoal `json:"goal"`
	Transaction Transaction `json:"transaction"`
}

type SavingsReallocationResult struct {
	FromGoal SavingsGoal `json:"fromGoal"`
	ToGoal   SavingsGoal `json:"toGoal"`
}

type SavingsAccountOverview struct {
	AccountID         string `json:"accountId"`
	AccountName       string `json:"accountName"`
	Balance           int64  `json:"balance"`
	AllocatedAmount   int64  `json:"allocatedAmount"`
	UnallocatedAmount int64  `json:"unallocatedAmount"`
}

type SavingsAllocationActivity struct {
	ID            string  `json:"id"`
	GoalID        string  `json:"goalId"`
	GoalName      string  `json:"goalName"`
	AccountID     *string `json:"accountId"`
	AccountName   *string `json:"accountName"`
	TransactionID *string `json:"transactionId"`
	Amount        int64   `json:"amount"`
	Kind          string  `json:"kind"`
	Date          string  `json:"date"`
}

type SavingsOverview struct {
	TotalAllocated      int64                       `json:"totalAllocated"`
	TotalAccountBalance int64                       `json:"totalAccountBalance"`
	TotalUnallocated    int64                       `json:"totalUnallocated"`
	Accounts            []SavingsAccountOverview    `json:"accounts"`
	RecentActivity      []SavingsAllocationActivity `json:"recentActivity"`
}

func (r *SavingsGoalRepository) Overview(ctx context.Context, userID string) (SavingsOverview, error) {
	overview := SavingsOverview{
		Accounts:       make([]SavingsAccountOverview, 0),
		RecentActivity: make([]SavingsAllocationActivity, 0),
	}
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		var currencyCount int
		if err := tx.QueryRow(ctx, `
			SELECT COUNT(DISTINCT account.currency)
			FROM public.savings_goal_allocations allocation
			JOIN public.accounts account ON account.user_id = allocation.user_id AND account.id = allocation.account_id
			WHERE allocation.user_id = $1
		`, userID).Scan(&currencyCount); err != nil {
			return err
		}
		if currencyCount > 1 {
			return ErrTransferCurrencyMismatch
		}
		if err := tx.QueryRow(ctx, `
			SELECT COALESCE(SUM(current_amount), 0)
			FROM public.savings_goals
			WHERE user_id = $1
		`, userID).Scan(&overview.TotalAllocated); err != nil {
			return err
		}

		rows, err := tx.Query(ctx, `
			WITH savings_account_ids AS (
				SELECT DISTINCT account_id
				FROM public.savings_goal_allocations
				WHERE user_id = $1 AND account_id IS NOT NULL
			), allocated AS (
				SELECT account_id, SUM(amount_cents) AS amount
				FROM public.savings_goal_allocations
				WHERE user_id = $1 AND account_id IS NOT NULL
				GROUP BY account_id
			)
			SELECT a.id, a.name, a.balance_cents, COALESCE(allocated.amount, 0)
			FROM public.accounts a
			JOIN savings_account_ids ids ON ids.account_id = a.id
			LEFT JOIN allocated ON allocated.account_id = a.id
			WHERE a.user_id = $1 AND a.type = 'debit'
			ORDER BY a.name, a.id
		`, userID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var account SavingsAccountOverview
			if err := rows.Scan(&account.AccountID, &account.AccountName, &account.Balance, &account.AllocatedAmount); err != nil {
				rows.Close()
				return err
			}
			account.UnallocatedAmount = account.Balance - account.AllocatedAmount
			overview.TotalAccountBalance += account.Balance
			overview.TotalUnallocated += account.UnallocatedAmount
			overview.Accounts = append(overview.Accounts, account)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()

		activityRows, err := tx.Query(ctx, `
			SELECT allocation.id, allocation.goal_id, goal.name,
				allocation.account_id, account.name, allocation.transaction_id,
				allocation.amount_cents, allocation.kind, allocation.occurred_on::text
			FROM public.savings_goal_allocations allocation
			JOIN public.savings_goals goal
				ON goal.user_id = allocation.user_id AND goal.id = allocation.goal_id
			LEFT JOIN public.accounts account
				ON account.user_id = allocation.user_id AND account.id = allocation.account_id
			WHERE allocation.user_id = $1
			ORDER BY allocation.occurred_on DESC, allocation.created_at DESC, allocation.id DESC
			LIMIT 12
		`, userID)
		if err != nil {
			return err
		}
		defer activityRows.Close()
		for activityRows.Next() {
			var activity SavingsAllocationActivity
			if err := activityRows.Scan(
				&activity.ID, &activity.GoalID, &activity.GoalName,
				&activity.AccountID, &activity.AccountName, &activity.TransactionID,
				&activity.Amount, &activity.Kind, &activity.Date,
			); err != nil {
				return err
			}
			overview.RecentActivity = append(overview.RecentActivity, activity)
		}
		return activityRows.Err()
	})
	if err != nil {
		return SavingsOverview{}, fmt.Errorf("load savings overview: %w", err)
	}
	return overview, nil
}

func (r *SavingsGoalRepository) Save(ctx context.Context, userID, goalID string, in SaveToGoalInput) (SavingsGoalActionResult, error) {
	if goalID == "" || in.SourceAccountID == "" || in.DestinationAccountID == "" ||
		in.SourceAccountID == in.DestinationAccountID || in.Amount <= 0 ||
		strings.TrimSpace(in.Description) == "" || in.IdempotencyKey == "" || !validSavingsDate(in.Date) {
		return SavingsGoalActionResult{}, ErrInvalidTransactionShape
	}

	var result SavingsGoalActionResult
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		accounts, err := lockTransactionAccounts(ctx, tx, userID, []string{in.SourceAccountID, in.DestinationAccountID})
		if err != nil {
			return err
		}
		source := accounts[in.SourceAccountID]
		destination := accounts[in.DestinationAccountID]
		if source.typeName != "debit" || destination.typeName != "debit" {
			return ErrInvalidAccountShape
		}
		if !source.trackingEnabled || !destination.trackingEnabled {
			return ErrBalanceTrackingNotEnabled
		}
		if err := validateSavingsCurrency(ctx, tx, userID, destination.currency); err != nil {
			return err
		}
		if _, err := lockSavingsGoal(ctx, tx, userID, goalID); err != nil {
			return err
		}

		destinationID := in.DestinationAccountID
		key := in.IdempotencyKey
		transactionInput := TransactionInput{
			AccountID:         in.SourceAccountID,
			Type:              "transfer",
			Amount:            in.Amount,
			Date:              in.Date,
			Description:       strings.TrimSpace(in.Description),
			TransferToAccount: &destinationID,
			IdempotencyKey:    &key,
		}
		transaction, created, err := createTransactionWithLockedAccounts(ctx, tx, userID, transactionInput, accounts)
		if err != nil {
			return err
		}
		result.Transaction = transaction
		if !created {
			var existingGoalID, existingAccountID string
			var existingAmount int64
			err := tx.QueryRow(ctx, `
				SELECT goal_id, account_id, amount_cents
				FROM public.savings_goal_allocations
				WHERE user_id = $1 AND transaction_id = $2
			`, userID, transaction.ID).Scan(&existingGoalID, &existingAccountID, &existingAmount)
			if errors.Is(err, pgx.ErrNoRows) || existingGoalID != goalID || existingAccountID != in.DestinationAccountID || existingAmount != in.Amount {
				return ErrIdempotencyConflict
			}
			if err != nil {
				return err
			}
			goal, err := lockSavingsGoal(ctx, tx, userID, goalID)
			result.Goal = goal
			return err
		}

		if _, err := tx.Exec(ctx, `
			INSERT INTO public.savings_goal_allocations (
				user_id, goal_id, account_id, transaction_id, amount_cents, kind, occurred_on
			)
			VALUES ($1, $2, $3, $4, $5, 'transfer', $6)
		`, userID, goalID, in.DestinationAccountID, transaction.ID, in.Amount, in.Date); err != nil {
			return err
		}
		goal, err := applySavingsGoalDelta(ctx, tx, userID, goalID, in.Amount, &in.DestinationAccountID)
		result.Goal = goal
		return err
	})
	if err != nil {
		if isSavingsCurrencyViolation(err) {
			return SavingsGoalActionResult{}, ErrTransferCurrencyMismatch
		}
		return SavingsGoalActionResult{}, fmt.Errorf("save to savings goal: %w", err)
	}
	return result, nil
}

func (r *SavingsGoalRepository) Allocate(ctx context.Context, userID, goalID string, in SavingsAllocationInput) (SavingsGoal, error) {
	if goalID == "" || in.AccountID == "" || in.Amount == 0 || in.IdempotencyKey == "" || !validSavingsDate(in.Date) {
		return SavingsGoal{}, ErrInvalidTransactionShape
	}

	var goal SavingsGoal
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		accounts, err := lockTransactionAccounts(ctx, tx, userID, []string{in.AccountID})
		if err != nil {
			return err
		}
		account := accounts[in.AccountID]
		if account.typeName != "debit" || account.balanceCents == nil {
			return ErrInvalidAccountShape
		}
		if !account.trackingEnabled {
			return ErrBalanceTrackingNotEnabled
		}
		if err := validateSavingsCurrency(ctx, tx, userID, account.currency); err != nil {
			return err
		}
		if _, err := lockSavingsGoal(ctx, tx, userID, goalID); err != nil {
			return err
		}
		var existingGoalID, existingAccountID, existingDate, existingKind string
		var existingAmount int64
		err = tx.QueryRow(ctx, `
			SELECT goal_id, account_id, amount_cents, occurred_on::text, kind
			FROM public.savings_goal_allocations
			WHERE user_id = $1 AND idempotency_key = $2
		`, userID, in.IdempotencyKey).Scan(&existingGoalID, &existingAccountID, &existingAmount, &existingDate, &existingKind)
		if err == nil {
			expectedKind := "allocation"
			if in.Amount < 0 {
				expectedKind = "release"
			}
			if existingGoalID != goalID || existingAccountID != in.AccountID || existingAmount != in.Amount || existingDate != in.Date || existingKind != expectedKind {
				return ErrIdempotencyConflict
			}
			goal, err = lockSavingsGoal(ctx, tx, userID, goalID)
			return err
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}

		var accountAllocated, goalAccountAllocated int64
		if err := tx.QueryRow(ctx, `
			SELECT
				COALESCE(SUM(amount_cents), 0),
				COALESCE(SUM(amount_cents) FILTER (WHERE goal_id = $3), 0)
			FROM public.savings_goal_allocations
			WHERE user_id = $1 AND account_id = $2
		`, userID, in.AccountID, goalID).Scan(&accountAllocated, &goalAccountAllocated); err != nil {
			return err
		}
		kind := "allocation"
		if in.Amount > 0 {
			if in.Amount > *account.balanceCents-accountAllocated {
				return ErrInsufficientUnallocatedSavings
			}
		} else {
			kind = "release"
			if -in.Amount > goalAccountAllocated {
				return ErrInsufficientGoalAllocation
			}
		}

		if _, err := tx.Exec(ctx, `
			INSERT INTO public.savings_goal_allocations (
				user_id, goal_id, account_id, idempotency_key, amount_cents, kind, occurred_on
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
		`, userID, goalID, in.AccountID, in.IdempotencyKey, in.Amount, kind, in.Date); err != nil {
			return err
		}
		goal, err = applySavingsGoalDelta(ctx, tx, userID, goalID, in.Amount, &in.AccountID)
		return err
	})
	if err != nil {
		if isSavingsCurrencyViolation(err) {
			return SavingsGoal{}, ErrTransferCurrencyMismatch
		}
		if isSavingsIdempotencyRace(err) {
			return SavingsGoal{}, ErrIdempotencyConflict
		}
		return SavingsGoal{}, fmt.Errorf("allocate savings: %w", err)
	}
	return goal, nil
}

func (r *SavingsGoalRepository) Reallocate(ctx context.Context, userID, fromGoalID string, in SavingsReallocationInput) (SavingsReallocationResult, error) {
	if fromGoalID == "" || in.ToGoalID == "" || fromGoalID == in.ToGoalID ||
		in.AccountID == "" || in.Amount <= 0 || in.IdempotencyKey == "" || !validSavingsDate(in.Date) {
		return SavingsReallocationResult{}, ErrInvalidTransactionShape
	}

	var result SavingsReallocationResult
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		accounts, err := lockTransactionAccounts(ctx, tx, userID, []string{in.AccountID})
		if err != nil {
			return err
		}
		account := accounts[in.AccountID]
		if account.typeName != "debit" || !account.trackingEnabled {
			return ErrInvalidAccountShape
		}
		if err := validateSavingsCurrency(ctx, tx, userID, account.currency); err != nil {
			return err
		}
		if _, err := lockSavingsGoals(ctx, tx, userID, []string{fromGoalID, in.ToGoalID}); err != nil {
			return err
		}
		var existingFromGoalID, existingAccountID, existingDate, operationID string
		var existingAmount int64
		err = tx.QueryRow(ctx, `
			SELECT goal_id, account_id, amount_cents, occurred_on::text, operation_id
			FROM public.savings_goal_allocations
			WHERE user_id = $1 AND idempotency_key = $2
		`, userID, in.IdempotencyKey).Scan(
			&existingFromGoalID, &existingAccountID, &existingAmount, &existingDate, &operationID,
		)
		if err == nil {
			var existingToGoalID string
			var pairedAmount int64
			pairErr := tx.QueryRow(ctx, `
				SELECT goal_id, amount_cents
				FROM public.savings_goal_allocations
				WHERE user_id = $1 AND operation_id = $2 AND idempotency_key IS NULL
			`, userID, operationID).Scan(&existingToGoalID, &pairedAmount)
			if pairErr != nil || existingFromGoalID != fromGoalID || existingToGoalID != in.ToGoalID ||
				existingAccountID != in.AccountID || existingAmount != -in.Amount || pairedAmount != in.Amount || existingDate != in.Date {
				return ErrIdempotencyConflict
			}
			result.FromGoal, err = lockSavingsGoal(ctx, tx, userID, fromGoalID)
			if err != nil {
				return err
			}
			result.ToGoal, err = lockSavingsGoal(ctx, tx, userID, in.ToGoalID)
			return err
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}

		var allocated int64
		if err := tx.QueryRow(ctx, `
			SELECT COALESCE(SUM(amount_cents), 0)
			FROM public.savings_goal_allocations
			WHERE user_id = $1 AND goal_id = $2 AND account_id = $3
		`, userID, fromGoalID, in.AccountID).Scan(&allocated); err != nil {
			return err
		}
		if in.Amount > allocated {
			return ErrInsufficientGoalAllocation
		}

		if err := tx.QueryRow(ctx, `
			INSERT INTO public.savings_goal_allocations (
				user_id, goal_id, account_id, idempotency_key, amount_cents, kind, occurred_on
			)
			VALUES ($1, $2, $3, $4, $5, 'reallocation', $6)
			RETURNING operation_id
		`, userID, fromGoalID, in.AccountID, in.IdempotencyKey, -in.Amount, in.Date).Scan(&operationID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO public.savings_goal_allocations (
				user_id, goal_id, account_id, operation_id, amount_cents, kind, occurred_on
			)
			VALUES ($1, $2, $3, $4, $5, 'reallocation', $6)
		`, userID, in.ToGoalID, in.AccountID, operationID, in.Amount, in.Date); err != nil {
			return err
		}
		result.FromGoal, err = applySavingsGoalDelta(ctx, tx, userID, fromGoalID, -in.Amount, nil)
		if err != nil {
			return err
		}
		result.ToGoal, err = applySavingsGoalDelta(ctx, tx, userID, in.ToGoalID, in.Amount, &in.AccountID)
		return err
	})
	if err != nil {
		if isSavingsCurrencyViolation(err) {
			return SavingsReallocationResult{}, ErrTransferCurrencyMismatch
		}
		if isSavingsIdempotencyRace(err) {
			return SavingsReallocationResult{}, ErrIdempotencyConflict
		}
		return SavingsReallocationResult{}, fmt.Errorf("reallocate savings: %w", err)
	}
	return result, nil
}

func lockSavingsGoal(ctx context.Context, tx pgx.Tx, userID, goalID string) (SavingsGoal, error) {
	var goal SavingsGoal
	err := scanSavingsGoal(tx.QueryRow(ctx, `
		SELECT `+savingsGoalColumns+`
		FROM public.savings_goals
		WHERE user_id = $1 AND id = $2
		FOR UPDATE
	`, userID, goalID), &goal)
	if errors.Is(err, pgx.ErrNoRows) {
		return SavingsGoal{}, ErrNotFound
	}
	return goal, err
}

func lockSavingsGoals(ctx context.Context, tx pgx.Tx, userID string, goalIDs []string) ([]SavingsGoal, error) {
	ids := append([]string(nil), goalIDs...)
	sort.Strings(ids)
	goals := make([]SavingsGoal, 0, len(ids))
	for _, id := range ids {
		goal, err := lockSavingsGoal(ctx, tx, userID, id)
		if err != nil {
			return nil, err
		}
		goals = append(goals, goal)
	}
	return goals, nil
}

func applySavingsGoalDelta(ctx context.Context, tx pgx.Tx, userID, goalID string, delta int64, preferredAccountID *string) (SavingsGoal, error) {
	var goal SavingsGoal
	err := scanSavingsGoal(tx.QueryRow(ctx, `
		UPDATE public.savings_goals SET
			current_amount = current_amount + $3,
			is_completed = current_amount + $3 >= target_amount,
			account_id = CASE
				WHEN account_id IS NULL AND $4::uuid IS NOT NULL THEN $4
				ELSE account_id
			END,
			updated_at = now()
		WHERE user_id = $1 AND id = $2 AND current_amount + $3 >= 0
		RETURNING `+savingsGoalColumns,
		userID, goalID, delta, preferredAccountID,
	), &goal)
	if errors.Is(err, pgx.ErrNoRows) {
		return SavingsGoal{}, ErrInsufficientGoalAllocation
	}
	return goal, err
}

func validSavingsDate(value string) bool {
	_, err := time.Parse(time.DateOnly, value)
	return err == nil
}

func validateSavingsCurrency(ctx context.Context, tx pgx.Tx, userID, currency string) error {
	var mismatch bool
	err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM public.savings_goal_allocations allocation
			JOIN public.accounts account
				ON account.user_id = allocation.user_id AND account.id = allocation.account_id
			WHERE allocation.user_id = $1 AND account.currency <> $2
		)
	`, userID, currency).Scan(&mismatch)
	if err != nil {
		return err
	}
	if mismatch {
		return ErrTransferCurrencyMismatch
	}
	return nil
}

func isSavingsIdempotencyRace(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "savings_goal_allocations_idempotency_idx"
}

func isSavingsCurrencyViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23514" && pgErr.ConstraintName == "savings_goal_allocations_currency_guard"
}
