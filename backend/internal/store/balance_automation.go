package store

import (
	"errors"
	"fmt"
)

var (
	ErrBalanceTrackingAlreadyEnabled = errors.New("balance tracking already enabled")
	ErrBalanceTrackingNotEnabled     = errors.New("balance tracking not enabled")
	ErrDirectBalancePatchForbidden   = errors.New("direct balance modification forbidden while tracking is enabled; use reconciliation")
)

// AccountDelta represents the signed change to an account's materialized balance
// or available credit.
type AccountDelta struct {
	AccountID string
	Delta     int64
}

// ComputeTransactionDeltas calculates the signed change for each account involved
// in a transaction based on account type (debit vs credit) and transaction type.
//
// Semantics:
//   - Debit: balance_cents changes (Expense: -amount, Income/Refund: +amount)
//   - Credit: available_credit_cents changes in the same direction as cash availability
//     (Expense on credit card reduces available credit: -amount; Payment/Refund increases available credit: +amount)
func ComputeTransactionDeltas(
	txType string,
	amount int64,
	sourceAccountID string,
	sourceAccountType string,
	transferToAccountID *string,
	destAccountType *string,
) ([]AccountDelta, error) {
	if amount <= 0 {
		return nil, errors.New("transaction amount must be positive")
	}

	switch txType {
	case "expense":
		// Expense reduces available funds / available credit.
		return []AccountDelta{
			{AccountID: sourceAccountID, Delta: -amount},
		}, nil

	case "income":
		// Income increases available funds / available credit.
		return []AccountDelta{
			{AccountID: sourceAccountID, Delta: amount},
		}, nil

	case "transfer":
		if transferToAccountID == nil || *transferToAccountID == "" {
			return nil, errors.New("transfer requires transferToAccountId")
		}
		if sourceAccountID == *transferToAccountID {
			return nil, errors.New("cannot transfer to the same account")
		}
		if destAccountType == nil {
			return nil, errors.New("destination account type required for transfer")
		}

		// Source account loses funds/credit (delta = -amount).
		// Destination account gains funds/credit (delta = +amount).
		return []AccountDelta{
			{AccountID: sourceAccountID, Delta: -amount},
			{AccountID: *transferToAccountID, Delta: amount},
		}, nil

	default:
		return nil, fmt.Errorf("unknown transaction type: %q", txType)
	}
}
