package statements

import (
	"testing"

	"github.com/aleonsa/budg/backend/internal/store"
)

const card = "card-1"

func strPtr(s string) *string { return &s }

func reconcileFixture() (Statement, []store.Transaction) {
	st := Statement{
		Issuer: "banamex", PeriodStart: "2026-06-08", PeriodEnd: "2026-07-08", PaymentDueDate: "2026-08-03",
		Movements: []Movement{
			{Line: 1, OperationDate: "2026-06-10", PostingDate: "2026-06-10", Description: "TIENDA EJEMPLO", AmountCents: 10000, Direction: DirectionCharge, Installment: &Installment{Number: 2, Total: 6}},
			{Line: 2, OperationDate: "2026-06-12", PostingDate: "2026-06-12", Description: "SU ABONO...GRACIAS", AmountCents: 90000, Direction: DirectionCredit},
			{Line: 3, OperationDate: "2026-06-15", PostingDate: "2026-06-16", Description: "CAFE DEMO CDE 123", AmountCents: 8550, Direction: DirectionCharge},
			{Line: 4, OperationDate: "2026-06-20", PostingDate: "2026-06-20", Description: "CAFE DEMO CDE 123", AmountCents: 8550, Direction: DirectionCharge},
			{Line: 5, OperationDate: "2026-06-30", PostingDate: "2026-07-02", Description: "SERVICIO RECURRENTE", AmountCents: 106500, Direction: DirectionCharge},
			{Line: 6, OperationDate: "2026-07-01", PostingDate: "2026-07-01", Description: "DISPONIBLE BANAMEX", AmountCents: 50000, Direction: DirectionCharge, Installment: &Installment{Number: 9, Total: 24}},
		},
	}
	txs := []store.Transaction{
		{ID: "msi-2", AccountID: card, Type: "expense", Amount: 10001, Date: "2026-06-02", Description: "Tienda (2/6)", MSIPurchaseID: strPtr("msi")},
		{ID: "payment", AccountID: "debit-1", Type: "transfer", Amount: 90000, Date: "2026-06-11", Description: "Pago tarjeta", TransferToAccount: strPtr(card)},
		{ID: "cafe-a", AccountID: card, Type: "expense", Amount: 8550, Date: "2026-06-21", Description: "Café"},
		{ID: "cafe-b", AccountID: card, Type: "expense", Amount: 8550, Date: "2026-06-15", Description: "Café demo"},
		{ID: "other-account", AccountID: "debit-1", Type: "expense", Amount: 106500, Date: "2026-06-30", Description: "Servicio"},
		{ID: "only-budg", AccountID: card, Type: "expense", Amount: 4200, Date: "2026-06-25", Description: "Tacos"},
		{ID: "outside-period", AccountID: card, Type: "expense", Amount: 777, Date: "2026-05-01", Description: "Viejo"},
	}
	return st, txs
}

func TestReconcileClassifiesMovements(t *testing.T) {
	st, txs := reconcileFixture()
	result := Reconcile(st, card, txs)

	want := []struct {
		status MatchStatus
		txID   string
	}{
		{StatusInstallmentMatched, "msi-2"},
		{StatusMatched, "payment"},
		{StatusMatched, "cafe-b"},
		{StatusMatched, "cafe-a"},
		{StatusMissing, ""},
		{StatusInstallmentUnmatched, ""},
	}
	if len(result.Movements) != len(want) {
		t.Fatalf("movements = %d, want %d", len(result.Movements), len(want))
	}
	for i, w := range want {
		got := result.Movements[i]
		if got.Status != w.status {
			t.Errorf("movement %d status = %s, want %s", i+1, got.Status, w.status)
		}
		gotID := ""
		if got.TransactionID != nil {
			gotID = *got.TransactionID
		}
		if gotID != w.txID {
			t.Errorf("movement %d tx = %q, want %q", i+1, gotID, w.txID)
		}
	}

	if result.Summary.Matched != 3 || result.Summary.Missing != 1 ||
		result.Summary.InstallmentsMatched != 1 || result.Summary.InstallmentsUnmatched != 1 {
		t.Fatalf("summary = %+v", result.Summary)
	}
	if result.Summary.MissingChargesCents != 106500 || result.Summary.MissingCreditsCents != 0 {
		t.Fatalf("missing totals = %+v", result.Summary)
	}
	if len(result.OnlyInBudg) != 1 || result.OnlyInBudg[0].ID != "only-budg" {
		t.Fatalf("only in budg = %+v", result.OnlyInBudg)
	}
}

func TestReconcileDoesNotMatchOutsideWindowOrWrongDirection(t *testing.T) {
	st := Statement{
		PeriodStart: "2026-06-01", PeriodEnd: "2026-06-30",
		Movements: []Movement{
			{Line: 1, OperationDate: "2026-06-10", PostingDate: "2026-06-10", Description: "X", AmountCents: 500, Direction: DirectionCharge},
			{Line: 2, OperationDate: "2026-06-10", PostingDate: "2026-06-10", Description: "REEMBOLSO", AmountCents: 700, Direction: DirectionCredit},
		},
	}
	txs := []store.Transaction{
		{ID: "late", AccountID: card, Type: "expense", Amount: 500, Date: "2026-06-20"},
		{ID: "expense-not-credit", AccountID: card, Type: "expense", Amount: 700, Date: "2026-06-10"},
	}
	result := Reconcile(st, card, txs)
	for _, movement := range result.Movements {
		if movement.Status != StatusMissing {
			t.Fatalf("movement %d status = %s, want missing", movement.Line, movement.Status)
		}
	}
	if result.Summary.MissingCreditsCents != 700 || result.Summary.MissingChargesCents != 500 {
		t.Fatalf("summary = %+v", result.Summary)
	}
}

func TestReconcileMatchesRefundIncome(t *testing.T) {
	st := Statement{
		PeriodStart: "2026-06-01", PeriodEnd: "2026-06-30",
		Movements: []Movement{{Line: 1, OperationDate: "2026-06-10", PostingDate: "2026-06-11", Description: "DEVOLUCION", AmountCents: 700, Direction: DirectionCredit}},
	}
	txs := []store.Transaction{{ID: "refund", AccountID: card, Type: "income", Amount: 700, Date: "2026-06-12"}}
	result := Reconcile(st, card, txs)
	if result.Movements[0].Status != StatusMatched {
		t.Fatalf("status = %s, want matched", result.Movements[0].Status)
	}
}

func TestReconcileAssignsMatchesGloballyForRepeatedAmounts(t *testing.T) {
	st := Statement{
		PeriodStart: "2026-06-01", PeriodEnd: "2026-06-30",
		Movements: []Movement{
			{Line: 1, OperationDate: "2026-06-10", PostingDate: "2026-06-10", Description: "UBER RIDE", AmountCents: 9900, Direction: DirectionCharge},
			{Line: 2, OperationDate: "2026-06-12", PostingDate: "2026-06-12", Description: "UBER RIDE", AmountCents: 9900, Direction: DirectionCharge},
		},
	}
	txs := []store.Transaction{
		{ID: "jun-08", AccountID: card, Type: "expense", Amount: 9900, Date: "2026-06-08", Description: "Taxi"},
		{ID: "jun-12", AccountID: card, Type: "expense", Amount: 9900, Date: "2026-06-12", Description: "Uber ride"},
	}
	result := Reconcile(st, card, txs)
	if result.Summary.Matched != 2 || result.Summary.Missing != 0 {
		t.Fatalf("summary = %+v, want both matched", result.Summary)
	}
	if *result.Movements[0].TransactionID != "jun-08" || *result.Movements[1].TransactionID != "jun-12" {
		t.Fatalf("assignment = %s, %s", *result.Movements[0].TransactionID, *result.Movements[1].TransactionID)
	}
}

func TestReconcileTransferOutOfCardCountsAsCharge(t *testing.T) {
	st := Statement{
		PeriodStart: "2026-06-01", PeriodEnd: "2026-06-30",
		Movements: []Movement{{Line: 1, OperationDate: "2026-06-17", PostingDate: "2026-06-17", Description: "DISPOSICION", AmountCents: 500000, Direction: DirectionCharge}},
	}
	txs := []store.Transaction{{ID: "cash-out", AccountID: card, Type: "transfer", Amount: 500000, Date: "2026-06-17", TransferToAccount: strPtr("debit-1")}}
	if Reconcile(st, card, txs).Movements[0].Status != StatusMatched {
		t.Fatal("transfer out of the card should match a charge")
	}
}

func TestReconcileInstallmentTolerance(t *testing.T) {
	st := Statement{
		PeriodStart: "2026-06-01", PeriodEnd: "2026-06-30",
		Movements: []Movement{{Line: 1, OperationDate: "2026-06-10", PostingDate: "2026-06-10", Description: "TIENDA", AmountCents: 10000, Direction: DirectionCharge, Installment: &Installment{Number: 2, Total: 6}}},
	}
	within := []store.Transaction{{ID: "ok", AccountID: card, Type: "expense", Amount: 10002, Date: "2026-06-15", MSIPurchaseID: strPtr("m")}}
	if Reconcile(st, card, within).Movements[0].Status != StatusInstallmentMatched {
		t.Fatal("2-cent difference should match")
	}
	outside := []store.Transaction{{ID: "far", AccountID: card, Type: "expense", Amount: 10003, Date: "2026-06-15", MSIPurchaseID: strPtr("m")}}
	if Reconcile(st, card, outside).Movements[0].Status != StatusInstallmentUnmatched {
		t.Fatal("3-cent difference should not match")
	}
}
