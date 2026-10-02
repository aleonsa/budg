package statements

import (
	"errors"
	"testing"
)

// syntheticBanamexTokens mirrors the token stream extracted from a Banamex
// credit card statement. All names, merchants, and amounts are invented.
func syntheticBanamexTokens() []string {
	return []string{
		".", "Estado de Cuenta Mensual", "Tarjeta de Crédito", "JOY BANAMEX",
		"Periodo:", "08-jun-2026 al 08-jul-2026",
		"Fecha de corte:", "08-jul-2026",
		"Fecha límite de pago:", "1", "lunes, 3-ago-2026",
		"Pago para no generar intereses:", "2", "$1,250.50",
		"Pago mínimo + compras y cargos diferidos a meses:", "3", "$400.00",
		"Pago mínimo:", "4", "$150.00",
		"Número de tarjeta", "5200 0000 0000 4321",
		// Deferred purchases table: single date per row, must be ignored.
		"COMPRAS Y CARGOS DIFERIDOS A MESES SIN INTERESES",
		"10-jun-2026", "TIENDA EJEMPLO", "$600.00", "$400.00", "$100.00", "2 de 6", "NA",
		"CARGOS, ABONOS Y COMPRAS REGULARES (NO A MESES)",
		"Fecha de la", "operación", "Fecha", "de cargo", "Descripción del movimiento", "Monto",
		"10-jun-2026", "10-jun-2026", "TIENDA EJEMPLO 002 de 006", "+", "$100.00",
		"12-jun-2026", "12-jun-2026", "SU ABONO...GRACIAS", "-", "$900.00",
		"15-jun-2026", "16-jun-2026", "CAFE DEMO", "CDE 123456AB1MX", "+", "$85.50",
		"30-jun-2026", "02-jul-2026", "SERVICIO RECURRENTE", "+", "$1,065.00",
		"Total cargos", "+", "$1,250.50",
		"Total abonos", "-", "$900.00",
		"Banco Nacional de México, S.A., Integrante del Grupo Financiero Banamex",
		// Glossary repeats labels without values; must not override.
		"Fecha de corte:", "Último día del periodo de facturación",
		"Pago mínimo:", "Es la cantidad que la Institución Financiera deberá",
	}
}

func TestParseBanamexStatementHeaderAndMovements(t *testing.T) {
	st, err := ParseTokens(syntheticBanamexTokens())
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if st.Issuer != "banamex" || st.Product != "JOY BANAMEX" || st.CardLast4 != "4321" {
		t.Fatalf("identity = %q %q %q", st.Issuer, st.Product, st.CardLast4)
	}
	if st.PeriodStart != "2026-06-08" || st.PeriodEnd != "2026-07-08" || st.PaymentDueDate != "2026-08-03" {
		t.Fatalf("dates = %s..%s due %s", st.PeriodStart, st.PeriodEnd, st.PaymentDueDate)
	}
	if st.PaymentToAvoidInterestCents != 125050 {
		t.Fatalf("payment to avoid interest = %d", st.PaymentToAvoidInterestCents)
	}
	if st.MinimumPaymentCents == nil || *st.MinimumPaymentCents != 15000 {
		t.Fatalf("minimum payment = %v", st.MinimumPaymentCents)
	}
	if len(st.Warnings) != 0 {
		t.Fatalf("warnings = %v, want none", st.Warnings)
	}
	if len(st.Movements) != 4 {
		t.Fatalf("movements = %+v, want 4", st.Movements)
	}

	installment := st.Movements[0]
	if installment.Description != "TIENDA EJEMPLO" || installment.Installment == nil ||
		installment.Installment.Number != 2 || installment.Installment.Total != 6 {
		t.Fatalf("installment movement = %+v", installment)
	}
	payment := st.Movements[1]
	if payment.Direction != DirectionCredit || payment.AmountCents != 90000 || payment.OperationDate != "2026-06-12" {
		t.Fatalf("payment movement = %+v", payment)
	}
	cafe := st.Movements[2]
	if cafe.Description != "CAFE DEMO CDE 123456AB1MX" || cafe.PostingDate != "2026-06-16" ||
		cafe.Direction != DirectionCharge || cafe.AmountCents != 8550 || cafe.Line != 3 {
		t.Fatalf("multi-fragment movement = %+v", cafe)
	}
}

func TestParseBanamexFlagsTotalsMismatch(t *testing.T) {
	tokens := syntheticBanamexTokens()
	for i, token := range tokens {
		if token == "Total cargos" {
			tokens[i+2] = "$9,999.99"
		}
	}
	st, err := ParseTokens(tokens)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(st.Warnings) != 1 || st.Warnings[0] != WarningChargesTotalMismatch {
		t.Fatalf("warnings = %v", st.Warnings)
	}
}

func TestParseRejectsUnknownStatements(t *testing.T) {
	if _, err := ParseTokens([]string{"Este es tu estado de cuenta", "Tarjeta de Crédito Nu"}); !errors.Is(err, ErrUnsupportedStatement) {
		t.Fatalf("err = %v, want ErrUnsupportedStatement", err)
	}
}

func TestParseBanamexRequiresPeriod(t *testing.T) {
	tokens := []string{"Tarjeta de Crédito", "JOY BANAMEX", "Total cargos", "+", "$1.00"}
	if _, err := ParseTokens(tokens); !errors.Is(err, ErrUnsupportedStatement) {
		t.Fatalf("err = %v, want ErrUnsupportedStatement", err)
	}
}

func TestExtractTokensRejectsNonPDFAndMalformedInput(t *testing.T) {
	if _, err := ExtractTokens([]byte("hello")); !errors.Is(err, ErrNotPDF) {
		t.Fatalf("plain text err = %v, want ErrNotPDF", err)
	}
	if _, err := ExtractTokens(nil); !errors.Is(err, ErrNotPDF) {
		t.Fatalf("empty err = %v, want ErrNotPDF", err)
	}
	garbage := append([]byte("%PDF-1.7\n"), []byte("garbage without xref or trailer")...)
	if _, err := ExtractTokens(garbage); !errors.Is(err, ErrUnreadablePDF) {
		t.Fatalf("malformed err = %v, want ErrUnreadablePDF", err)
	}
	oversized := make([]byte, MaxPDFBytes+1)
	copy(oversized, "%PDF-")
	if _, err := ExtractTokens(oversized); !errors.Is(err, ErrNotPDF) {
		t.Fatalf("oversized err = %v, want ErrNotPDF", err)
	}
}

func TestParseHelpers(t *testing.T) {
	if date, ok := parseStatementDate("5-sep-2026"); !ok || date != "2026-09-05" {
		t.Fatalf("date = %q %v", date, ok)
	}
	if _, ok := parseStatementDate("31-feb-2026"); ok {
		t.Fatal("accepted impossible date")
	}
	if cents, sign, ok := parseMoney("+$12,345.67"); !ok || cents != 1234567 || sign != "+" {
		t.Fatalf("money = %d %q %v", cents, sign, ok)
	}
	if _, _, ok := parseMoney("12"); ok {
		t.Fatal("accepted amount without cents")
	}
}
