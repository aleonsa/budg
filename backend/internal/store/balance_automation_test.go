package store_test

import (
	"testing"

	"github.com/aleonsa/budg/backend/internal/store"
)

func TestComputeTransactionDeltas(t *testing.T) {
	t.Parallel()

	strPtr := func(s string) *string { return &s }

	t.Run("debit expense decreases balance", func(t *testing.T) {
		deltas, err := store.ComputeTransactionDeltas("expense", 1500, "acct-1", "debit", nil, nil)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(deltas) != 1 || deltas[0].AccountID != "acct-1" || deltas[0].Delta != -1500 {
			t.Fatalf("got %v", deltas)
		}
	})

	t.Run("credit expense decreases available credit", func(t *testing.T) {
		deltas, err := store.ComputeTransactionDeltas("expense", 5000, "card-1", "credit", nil, nil)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(deltas) != 1 || deltas[0].AccountID != "card-1" || deltas[0].Delta != -5000 {
			t.Fatalf("got %v", deltas)
		}
	})

	t.Run("income increases balance or available credit", func(t *testing.T) {
		deltas, err := store.ComputeTransactionDeltas("income", 25000, "acct-1", "debit", nil, nil)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(deltas) != 1 || deltas[0].Delta != 25000 {
			t.Fatalf("got %v", deltas)
		}
	})

	t.Run("transfer updates source and destination correctly", func(t *testing.T) {
		destType := "debit"
		deltas, err := store.ComputeTransactionDeltas("transfer", 10000, "checking", "debit", strPtr("savings"), &destType)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(deltas) != 2 {
			t.Fatalf("expected 2 deltas, got %d", len(deltas))
		}
		if deltas[0].AccountID != "checking" || deltas[0].Delta != -10000 {
			t.Fatalf("source delta = %+v", deltas[0])
		}
		if deltas[1].AccountID != "savings" || deltas[1].Delta != 10000 {
			t.Fatalf("dest delta = %+v", deltas[1])
		}
	})
}
