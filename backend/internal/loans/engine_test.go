package loans

import (
	"testing"
	"time"
)

func d(s string) time.Time {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		panic(err)
	}
	return t
}

// inbursaParams reproduces the KIA K4 financing: 276,900 MXN at 13.73% with a
// 6,404.28 P&I payment (the contract's months 1-12 annuity, insurance excluded).
func inbursaParams() Params {
	return Params{
		PrincipalCents:      27_690_000,
		AnnualRateBps:       1373,
		MonthlyPaymentCents: 640_428,
		TermMonths:          60,
		StartDate:           d("2026-12-13"),
		DayOfMonth:          13,
	}
}

func TestBuildScheduleMatchesContractMonths1To3(t *testing.T) {
	rows := BuildSchedule(inbursaParams())
	if len(rows) != 60 {
		t.Fatalf("got %d rows, want 60", len(rows))
	}

	// Values transcribed from the Inbursa amortization PDF (capital,
	// interest, remaining balance).
	want := []struct {
		principal int64
		interest  int64
		remaining int64
	}{
		{323_608, 316_820, 27_366_392},
		{327_311, 313_117, 27_039_081},
		{331_056, 309_372, 26_708_025},
	}
	for i, w := range want {
		row := rows[i]
		if row.PrincipalCents != w.principal || row.InterestCents != w.interest || row.RemainingCents != w.remaining {
			t.Errorf("row %d: got principal=%d interest=%d remaining=%d, want principal=%d interest=%d remaining=%d",
				row.Sequence, row.PrincipalCents, row.InterestCents, row.RemainingCents,
				w.principal, w.interest, w.remaining)
		}
	}
}

func TestBuildScheduleClosesAtZero(t *testing.T) {
	rows := BuildSchedule(inbursaParams())
	if got := rows[len(rows)-1].RemainingCents; got != 0 {
		t.Fatalf("final balance = %d, want 0", got)
	}
	if rows[len(rows)-1].DueDate.Format("2006-01-02") != "2031-11-13" {
		t.Fatalf("payoff = %s, want 2031-11-13", rows[len(rows)-1].DueDate.Format("2006-01-02"))
	}
}

func TestMonthlyInterestRounding(t *testing.T) {
	// 276,900 @ 13.73% → 316,819.75 → rounds to 316,820 (contract value).
	if got := monthlyInterest(27_690_000, 1373); got != 316_820 {
		t.Fatalf("monthlyInterest = %d, want 316820", got)
	}
	if got := monthlyInterest(0, 1373); got != 0 {
		t.Fatalf("zero balance interest = %d, want 0", got)
	}
}

func TestAddMonthsClamped(t *testing.T) {
	if got := addMonthsClamped(d("2026-01-31"), 1, 31); got.Day() != 28 {
		t.Fatalf("jan 31 +1mo = day %d, want 28 (2026 not leap)", got.Day())
	}
	if got := addMonthsClamped(d("2026-12-13"), 1, 13); got.Format("2006-01-02") != "2027-01-13" {
		t.Fatalf("got %s, want 2027-01-13", got.Format("2006-01-02"))
	}
}

func TestApplyExtraPaymentShortensTermAndSavesInterest(t *testing.T) {
	p := inbursaParams()
	baseline := BuildSchedule(p)
	result := ApplyExtraPayment(p, 50_000_00, d("2027-06-01")) // $50k after 6 payments

	if result.InterestSavedCents <= 0 {
		t.Fatalf("interest saved = %d, want > 0", result.InterestSavedCents)
	}
	if result.MonthsSaved <= 0 {
		t.Fatalf("months saved = %d, want > 0", result.MonthsSaved)
	}
	if len(result.Schedule) >= len(baseline) {
		t.Fatalf("schedule length %d, want < %d", len(result.Schedule), len(baseline))
	}
	if got := result.Schedule[len(result.Schedule)-1].RemainingCents; got != 0 {
		t.Fatalf("final balance after extra payment = %d, want 0", got)
	}
	// Rows on or before the extra date must be identical to baseline.
	for i, row := range result.Schedule {
		if row.DueDate.After(d("2027-06-01")) {
			break
		}
		if row != baseline[i] {
			t.Fatalf("row %d changed before extra date: %+v vs baseline %+v", row.Sequence, row, baseline[i])
		}
	}
}

func TestApplyExtraPaymentZeroAmountIsIdentity(t *testing.T) {
	p := inbursaParams()
	result := ApplyExtraPayment(p, 0, d("2027-06-01"))
	if result.InterestSavedCents != 0 || result.MonthsSaved != 0 {
		t.Fatalf("zero extra changed result: %+v", result)
	}
	if len(result.Schedule) != p.TermMonths {
		t.Fatalf("schedule length = %d, want %d", len(result.Schedule), p.TermMonths)
	}
}

func TestApplyExtraPaymentLargerThanBalance(t *testing.T) {
	p := inbursaParams()
	result := ApplyExtraPayment(p, 30_000_000, d("2026-12-01"))
	if len(result.Schedule) != 0 || !result.NewPayoffDate.Equal(d("2026-12-01")) {
		t.Fatal("full prepayment must cancel all future installments")
	}
	if result.MonthsSaved == 0 {
		t.Fatal("overpayment should report months saved")
	}
}

func TestExtraPaymentReducesInterestBeforeNextDueDate(t *testing.T) {
	p := inbursaParams()
	result := ApplyExtraPayment(p, 1_000_000, d("2026-12-01"))
	if result.Schedule[0].InterestCents >= BuildSchedule(p)[0].InterestCents {
		t.Fatal("prepayment must reduce next interest")
	}
	for i := 1; i < len(result.Schedule); i++ {
		if !result.Schedule[i].DueDate.After(result.Schedule[i-1].DueDate) {
			t.Fatal("duplicate payment dates")
		}
	}
}

func TestExtraOnDueDateIsAppliedBeforeProjectedPayment(t *testing.T) {
	p := inbursaParams()
	s := ApplyExtraPayment(p, 1_000_000, p.StartDate)
	if s.Schedule[0].InterestCents >= BuildSchedule(p)[0].InterestCents {
		t.Fatal("same-day extra must reduce the next projected interest")
	}
}
func TestNegativeAmortizationRejected(t *testing.T) {
	p := inbursaParams()
	p.MonthlyPaymentCents = 100
	if Validate(p) == nil || len(BuildSchedule(p)) != 0 {
		t.Fatal("must reject payments below interest")
	}
}
func TestUnderfundedTermDoesNotInventBalloon(t *testing.T) {
	p := inbursaParams()
	p.TermMonths = 12
	s := BuildSchedule(p)
	if s[len(s)-1].RemainingCents == 0 {
		t.Fatal("must retain unpaid principal")
	}
}
