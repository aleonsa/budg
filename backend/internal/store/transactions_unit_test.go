package store

import (
	"errors"
	"testing"
)

func TestValidateTransactionShapeRequiresStatementPaymentsToAffectBalance(t *testing.T) {
	t.Parallel()
	destination := "card-1"
	statement := "statement-1"
	transaction := Transaction{
		AccountID: "checking-1", Type: "transfer", Amount: 100,
		Date: "2026-07-22", Description: "Card payment",
		TransferToAccount: &destination, CreditCardStatementID: &statement,
	}
	if err := validateTransactionShape(transaction); !errors.Is(err, ErrInvalidTransactionShape) {
		t.Fatalf("validateTransactionShape() error = %v, want ErrInvalidTransactionShape", err)
	}
	transaction.AffectsBalance = true
	if err := validateTransactionShape(transaction); err != nil {
		t.Fatalf("validateTransactionShape() error = %v, want nil", err)
	}
}

func TestValidateStatementBalanceTrackingRequiresBothAccounts(t *testing.T) {
	t.Parallel()
	destinationID := "card-1"
	statementID := "statement-1"
	transaction := Transaction{
		AccountID: "checking-1", Type: "transfer", TransferToAccount: &destinationID,
		CreditCardStatementID: &statementID,
	}
	cases := []struct {
		name               string
		sourceTracked      bool
		destinationTracked bool
		wantErr            bool
	}{
		{name: "untracked source", destinationTracked: true, wantErr: true},
		{name: "untracked destination", sourceTracked: true, wantErr: true},
		{name: "tracked both", sourceTracked: true, destinationTracked: true},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			accounts := map[string]lockedAccount{
				"checking-1": {id: "checking-1", typeName: "debit", currency: "MXN", trackingEnabled: tc.sourceTracked},
				"card-1":     {id: "card-1", typeName: "credit", currency: "MXN", trackingEnabled: tc.destinationTracked},
			}
			err := validateStatementBalanceTracking(transaction, accounts)
			if tc.wantErr && !errors.Is(err, ErrBalanceTrackingNotEnabled) {
				t.Fatalf("validateStatementBalanceTracking() error = %v, want ErrBalanceTrackingNotEnabled", err)
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("validateStatementBalanceTracking() error = %v, want nil", err)
			}
		})
	}
}

func TestAdjustedAvailableCreditPreservesDebt(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name                          string
		oldLimit, oldAvailable, limit int64
		want                          int64
		wantErr                       bool
	}{
		{name: "increase", oldLimit: 20000, oldAvailable: 15000, limit: 25000, want: 20000},
		{name: "decrease", oldLimit: 20000, oldAvailable: 15000, limit: 10000, want: 5000},
		{name: "below debt", oldLimit: 20000, oldAvailable: 15000, limit: 4000, want: -1000},
		{name: "negative limit", oldLimit: 20000, oldAvailable: 15000, limit: -1, wantErr: true},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := adjustedAvailableCredit(tc.oldLimit, tc.oldAvailable, tc.limit)
			if tc.wantErr {
				if !errors.Is(err, ErrInvalidAccountShape) {
					t.Fatalf("adjustedAvailableCredit() error = %v, want ErrInvalidAccountShape", err)
				}
				return
			}
			if err != nil || got != tc.want {
				t.Fatalf("adjustedAvailableCredit() = (%d, %v), want (%d, nil)", got, err, tc.want)
			}
		})
	}
}
