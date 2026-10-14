// Package loans implements the pure amortization math behind the loans
// feature. It has no database dependencies so it can be unit tested against
// contract values (see engine_test.go) and reused by the what-if calculator
// endpoint without touching persistence.
package loans

import (
	"errors"
	"time"
)

// Validate bounds calculations and rejects negative amortization.
func Validate(p Params) error {
	if p.PrincipalCents <= 0 || p.PrincipalCents > 1_000_000_000_000 || p.AnnualRateBps < 0 || p.AnnualRateBps > 100000 || p.TermMonths < 1 || p.TermMonths > 600 || p.MonthlyPaymentCents <= 0 || p.MonthlyPaymentCents > 1_000_000_000_000 || p.DayOfMonth < 1 || p.DayOfMonth > 31 || p.StartDate.IsZero() {
		return errors.New("invalid loan terms")
	}
	if p.MonthlyPaymentCents <= monthlyInterest(p.PrincipalCents, p.AnnualRateBps) {
		return errors.New("monthly payment must exceed interest")
	}
	return nil
}

// Row is one line of an amortization schedule.
type Row struct {
	Sequence       int
	DueDate        time.Time
	PrincipalCents int64
	InterestCents  int64
	TotalCents     int64
	RemainingCents int64 // balance right after this payment
}

// Params feeds BuildSchedule. Amounts are in cents; AnnualRateBps is the
// nominal annual rate in basis points (1373 = 13.73%).
type Params struct {
	PrincipalCents      int64
	AnnualRateBps       int64
	MonthlyPaymentCents int64
	TermMonths          int
	StartDate           time.Time // anchors the first due date's month
	DayOfMonth          int       // due day, clamped to month end
}

// BuildSchedule generates a full amortization schedule. The last payment is
// reduced to the exact remaining balance plus its interest so the schedule
// always closes at zero regardless of cent rounding.
func BuildSchedule(p Params) []Row {
	if Validate(p) != nil {
		return nil
	}
	rows := make([]Row, 0, p.TermMonths)
	balance := p.PrincipalCents
	for seq := 1; seq <= p.TermMonths; seq++ {
		interest := monthlyInterest(balance, p.AnnualRateBps)
		principal := p.MonthlyPaymentCents - interest
		if principal > balance || balance-principal <= 100 {
			// Final payment absorbs any residual cents left by monthly
			// interest rounding so the schedule always closes at zero,
			// matching how the Inbursa contract adjusts its last row.
			principal = balance
		}
		total := principal + interest
		balance -= principal
		rows = append(rows, Row{
			Sequence:       seq,
			DueDate:        addMonthsClamped(p.StartDate, seq-1, p.DayOfMonth),
			PrincipalCents: principal,
			InterestCents:  interest,
			TotalCents:     total,
			RemainingCents: balance,
		})
		if balance <= 0 {
			break
		}
	}
	return rows
}

// ExtraPaymentResult summarizes what an additional principal payment does to
// a baseline schedule.
type ExtraPaymentResult struct {
	ExtraPaymentCents  int64
	AppliedOn          time.Time
	InterestSavedCents int64
	MonthsSaved        int
	NewPayoffDate      time.Time
	Schedule           []Row // schedule after the extra payment is applied
}

// ApplyExtraPayment splits every baseline row into before/after the extra
// payment date: rows due on or before extraDate are assumed paid. The extra
// principal reduces the balance before the next month's interest is calculated.
// This monthly approximation does not model daily accrued interest.
func ApplyExtraPayment(p Params, extraCents int64, extraDate time.Time) ExtraPaymentResult {
	baseline := BuildSchedule(p)
	if len(baseline) == 0 || extraDate.After(payoffDate(baseline)) {
		return ExtraPaymentResult{Schedule: baseline, NewPayoffDate: payoffDate(baseline)}
	}

	if extraCents <= 0 {
		return ExtraPaymentResult{
			ExtraPaymentCents: extraCents,
			AppliedOn:         extraDate,
			Schedule:          baseline,
			NewPayoffDate:     payoffDate(baseline),
		}
	}

	kept := make([]Row, 0, len(baseline))
	balance := p.PrincipalCents
	anchor := extraDate
	for _, row := range baseline {
		if row.DueDate.Before(extraDate) {
			kept = append(kept, row)
			balance = row.RemainingCents
			continue
		}
		// Reduce capital before computing the next projected installment.
		anchor = row.DueDate
		if extraCents > balance {
			extraCents = balance
		}
		balance -= extraCents
		break
	}
	if balance <= 0 {
		result := finishResult(p, extraCents, extraDate, baseline, kept)
		result.NewPayoffDate = extraDate
		result.MonthsSaved = len(baseline) - len(kept)
		return result
	}

	rest := BuildSchedule(Params{
		PrincipalCents:      balance,
		AnnualRateBps:       p.AnnualRateBps,
		MonthlyPaymentCents: p.MonthlyPaymentCents,
		TermMonths:          p.TermMonths - len(kept),
		StartDate:           anchor,
		DayOfMonth:          p.DayOfMonth,
	})
	nextSeq := len(kept) + 1
	for i := range rest {
		rest[i].Sequence = nextSeq + i
	}
	kept = append(kept, rest...)
	return finishResult(p, extraCents, extraDate, baseline, kept)
}

func finishResult(p Params, extraCents int64, extraDate time.Time, baseline, actual []Row) ExtraPaymentResult {
	baseInterest := totalInterest(baseline)
	actualInterest := totalInterest(actual)
	saved := baseInterest - actualInterest
	if saved < 0 {
		saved = 0
	}
	return ExtraPaymentResult{
		ExtraPaymentCents:  extraCents,
		AppliedOn:          extraDate,
		InterestSavedCents: saved,
		MonthsSaved:        len(baseline) - len(actual),
		NewPayoffDate:      payoffDate(actual),
		Schedule:           actual,
	}
}

// monthlyInterest computes round(balance * annualRateBps / 120000) in cents:
// balance × rate% / 12 months, rounded to the nearest cent. Verified against
// the Inbursa contract: 276,900 @ 1373bps → 316,820 cents ($3,168.20).
func monthlyInterest(balanceCents, annualRateBps int64) int64 {
	if balanceCents <= 0 {
		return 0
	}
	numerator := balanceCents * annualRateBps
	return (numerator + 60000) / 120000
}

// addMonthsClamped moves to the month offset months after anchor's month and
// clamps the day to the target month's length (e.g. day 31 in February).
func addMonthsClamped(anchor time.Time, offset int, day int) time.Time {
	if day < 1 {
		day = 1
	}
	y, m, _ := anchor.Date()
	first := time.Date(y, m, 1, 0, 0, 0, 0, time.UTC).AddDate(0, offset, 0)
	lastDay := time.Date(first.Year(), first.Month()+1, 0, 0, 0, 0, 0, time.UTC).Day()
	if day > lastDay {
		day = lastDay
	}
	return time.Date(first.Year(), first.Month(), day, 0, 0, 0, 0, time.UTC)
}

func totalInterest(rows []Row) int64 {
	var sum int64
	for _, r := range rows {
		sum += r.InterestCents
	}
	return sum
}

func payoffDate(rows []Row) time.Time {
	if len(rows) == 0 {
		return time.Time{}
	}
	return rows[len(rows)-1].DueDate
}
