package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/aleonsa/budg/backend/internal/loans"
)

// ErrLoanPaymentManaged prevents deleting a transaction that backs a loan
// payment, mirroring the MSI installment guard.
var ErrLoanPaymentManaged = errors.New("transaction backs a loan payment")

var ErrLoanInvalid = errors.New("invalid loan operation")

// Loan mirrors public.loans. Amounts are cents; AnnualRateBps is the nominal
// annual rate in basis points (1373 = 13.73%).
type Loan struct {
	ID                  string    `json:"id"`
	UserID              string    `json:"-"`
	AccountID           string    `json:"accountId"`
	Description         string    `json:"description"`
	Lender              *string   `json:"lender,omitempty"`
	PrincipalCents      int64     `json:"principalCents"`
	AnnualRateBps       int64     `json:"annualRateBps"`
	TermMonths          int       `json:"termMonths"`
	MonthlyPaymentCents int64     `json:"monthlyPaymentCents"`
	StartDate           string    `json:"startDate"`
	DayOfMonth          int       `json:"dayOfMonth"`
	Status              string    `json:"status"`
	RemainingCents      int64     `json:"remainingCents"`
	CreatedAt           time.Time `json:"-"`
	UpdatedAt           time.Time `json:"-"`
}

// LoanPayment mirrors public.loan_payments. Expected split lives in
// principal/interest/total; actuals in the paid_* columns once settled.
type LoanPayment struct {
	ID                 string    `json:"id"`
	LoanID             string    `json:"loanId"`
	Sequence           int       `json:"sequence"`
	DueDate            string    `json:"dueDate"`
	PrincipalCents     int64     `json:"principalCents"`
	InterestCents      int64     `json:"interestCents"`
	TotalCents         int64     `json:"totalCents"`
	PaidPrincipalCents *int64    `json:"paidPrincipalCents,omitempty"`
	PaidInterestCents  *int64    `json:"paidInterestCents,omitempty"`
	PaidTotalCents     *int64    `json:"paidTotalCents,omitempty"`
	Status             string    `json:"status"`
	TransactionID      *string   `json:"transactionId,omitempty"`
	PaidAt             *string   `json:"paidAt,omitempty"`
	CreatedAt          time.Time `json:"createdAt"`
}

// LoanInput captures user-controlled fields when creating a loan. Create
// generates the full amortization schedule up front.
type LoanInput struct {
	AccountID           string  `json:"accountId"`
	Description         string  `json:"description"`
	Lender              *string `json:"lender"`
	PrincipalCents      int64   `json:"principalCents"`
	AnnualRateBps       int64   `json:"annualRateBps"`
	TermMonths          int     `json:"termMonths"`
	MonthlyPaymentCents int64   `json:"monthlyPaymentCents"`
	StartDate           string  `json:"startDate"`
	DayOfMonth          int     `json:"dayOfMonth"`
	IdempotencyKey      *string `json:"-"`
}

// LoanPatch limits updates to labels and the payment account. Financial
// terms are immutable once a schedule exists; corrections go through
// reconciliation or extra payments.
type LoanPatch struct {
	AccountID   *string       `json:"accountId"`
	Description *string       `json:"description"`
	Lender      Field[string] `json:"lender"`
}

// PayLoanPaymentInput settles one scheduled payment.
type PayLoanPaymentInput struct {
	// PaidTotalCents overrides the expense amount when the bank charged a
	// different total (e.g. insurance bundled in the monthly charge). The
	// principal/interest split stays as scheduled.
	PaidTotalCents     *int64  `json:"paidTotalCents"`
	Date               string  `json:"date"`
	CategoryID         *string `json:"categoryId"`
	PaidPrincipalCents *int64  `json:"paidPrincipalCents"`
	PaidInterestCents  *int64  `json:"paidInterestCents"`
}

// ExtraLoanPaymentInput records an ad-hoc principal payment. It creates an
// expense on the loan account and regenerates every pending payment from the
// reduced balance (same monthly payment, shorter term).
type ExtraLoanPaymentInput struct {
	AmountCents    int64   `json:"amountCents"`
	Date           string  `json:"date"`
	CategoryID     *string `json:"categoryId"`
	IdempotencyKey *string `json:"-"`
}

// ReconcileLoanInput snaps tracked debt to the balance the bank reports.
type ReconcileLoanInput struct {
	ActualBalanceCents int64  `json:"actualBalanceCents"`
	AsOfDate           string `json:"asOfDate"`
}

const loanColumns = `id, user_id, account_id, description, lender,
	principal_cents, annual_rate_bps, term_months, monthly_payment_cents,
	start_date::text, day_of_month, status, created_at, updated_at`

const loanPaymentColumns = `id, loan_id, sequence, due_date::text,
	principal_cents, interest_cents, total_cents,
	paid_principal_cents, paid_interest_cents, paid_total_cents,
	status, transaction_id, paid_at::text, created_at`

// LoanRepository is the concrete pgx implementation.
type LoanRepository struct {
	pool *pgxpool.Pool
}

// NewLoanRepository builds a LoanRepository bound to the pool.
func NewLoanRepository(pool *pgxpool.Pool) *LoanRepository {
	return &LoanRepository{pool: pool}
}

func scanLoan(row pgx.Row, l *Loan) error {
	err := row.Scan(
		&l.ID, &l.UserID, &l.AccountID, &l.Description, &l.Lender,
		&l.PrincipalCents, &l.AnnualRateBps, &l.TermMonths, &l.MonthlyPaymentCents,
		&l.StartDate, &l.DayOfMonth, &l.Status, &l.CreatedAt, &l.UpdatedAt,
	)
	if len(l.StartDate) >= 10 {
		l.StartDate = l.StartDate[:10]
	}
	return err
}

func scanLoanPayment(row pgx.Row, p *LoanPayment) error {
	err := row.Scan(
		&p.ID, &p.LoanID, &p.Sequence, &p.DueDate,
		&p.PrincipalCents, &p.InterestCents, &p.TotalCents,
		&p.PaidPrincipalCents, &p.PaidInterestCents, &p.PaidTotalCents,
		&p.Status, &p.TransactionID, &p.PaidAt, &p.CreatedAt,
	)
	if len(p.DueDate) >= 10 {
		p.DueDate = p.DueDate[:10]
	}
	if p.PaidAt != nil && len(*p.PaidAt) >= 10 {
		truncated := (*p.PaidAt)[:10]
		p.PaidAt = &truncated
	}
	return err
}

// List returns every loan with its tracked remaining balance
// (principal minus settled principal, including adjustments).
func (r *LoanRepository) List(ctx context.Context, userID string) ([]Loan, error) {
	out := make([]Loan, 0)
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT `+loanColumns+`, COALESCE(paid.paid_principal, 0)
			FROM public.loans
			LEFT JOIN (
				SELECT loan_id, SUM(paid_principal_cents) AS paid_principal
				FROM public.loan_payments
				WHERE user_id = $1 AND status IN ('paid', 'adjustment') AND paid_principal_cents IS NOT NULL
				GROUP BY loan_id
			) AS paid ON paid.loan_id = loans.id
			WHERE loans.user_id = $1
			ORDER BY loans.start_date DESC, loans.id DESC
		`, userID)
		if err != nil {
			return fmt.Errorf("list loans: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var l Loan
			var paidPrincipal int64
			if err := rows.Scan(&l.ID, &l.UserID, &l.AccountID, &l.Description, &l.Lender,
				&l.PrincipalCents, &l.AnnualRateBps, &l.TermMonths, &l.MonthlyPaymentCents,
				&l.StartDate, &l.DayOfMonth, &l.Status, &l.CreatedAt, &l.UpdatedAt, &paidPrincipal); err != nil {
				return err
			}
			l.RemainingCents = l.PrincipalCents - paidPrincipal
			out = append(out, l)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func loadLoan(ctx context.Context, tx pgx.Tx, userID, id string, forUpdate bool) (Loan, error) {
	var l Loan
	query := `SELECT ` + loanColumns + ` FROM public.loans WHERE user_id = $1 AND id = $2`
	if forUpdate {
		query += ` FOR UPDATE`
	}
	if err := scanLoan(tx.QueryRow(ctx, query, userID, id), &l); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Loan{}, ErrNotFound
		}
		return Loan{}, err
	}
	return l, nil
}

// Get returns the loan and its full payment schedule.
func (r *LoanRepository) Get(ctx context.Context, userID, id string) (Loan, []LoanPayment, error) {
	var loan Loan
	var remaining int64
	payments := make([]LoanPayment, 0)
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		var err error
		loan, err = loadLoan(ctx, tx, userID, id, true)
		if err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `
			SELECT `+loanPaymentColumns+`
			FROM public.loan_payments
			WHERE user_id = $1 AND loan_id = $2
			ORDER BY due_date, sequence
		`, userID, id)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var p LoanPayment
			if err := scanLoanPayment(rows, &p); err != nil {
				return err
			}
			payments = append(payments, p)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		rows.Close()
		remaining, err = trackedRemainingCents(ctx, tx, userID, id)
		return err
	})
	if err != nil {
		return Loan{}, nil, err
	}
	loan.RemainingCents = remaining
	return loan, payments, nil
}

// trackedRemainingCents computes principal minus settled principal in the
// same transaction that mutates payments, so callers always read a
// consistent snapshot.
func trackedRemainingCents(ctx context.Context, tx pgx.Tx, userID, loanID string) (int64, error) {
	var remaining int64
	err := tx.QueryRow(ctx, `
		SELECT loans.principal_cents - COALESCE(SUM(payments.paid_principal_cents), 0)
		FROM public.loans
		LEFT JOIN public.loan_payments AS payments
			ON payments.loan_id = loans.id
			AND payments.status IN ('paid', 'adjustment')
			AND payments.paid_principal_cents IS NOT NULL
		WHERE loans.user_id = $1 AND loans.id = $2
		GROUP BY loans.principal_cents
	`, userID, loanID).Scan(&remaining)
	return remaining, err
}

// Create inserts the loan and its generated schedule atomically.
func (r *LoanRepository) Create(ctx context.Context, userID string, in LoanInput) (Loan, error) {
	var l Loan
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		replayID, replay, err := beginIdempotentCreate(ctx, tx, userID, in.IdempotencyKey, "loan", in)
		if err != nil {
			return err
		}
		if replay {
			err := scanLoan(tx.QueryRow(ctx, `SELECT `+loanColumns+` FROM public.loans WHERE user_id = $1 AND id = $2`, userID, replayID), &l)
			if errors.Is(err, pgx.ErrNoRows) {
				return newIdempotencyReplayDeletedError(replayID)
			}
			return err
		}
		accounts, err := lockTransactionAccounts(ctx, tx, userID, []string{in.AccountID})
		if err != nil {
			return err
		}
		if !validLoanAccount(accounts[in.AccountID]) {
			return ErrLoanInvalid
		}

		start, err := time.Parse("2006-01-02", in.StartDate)
		if err != nil {
			return fmt.Errorf("startDate must be YYYY-MM-DD: %w", err)
		}
		rows := loans.BuildSchedule(loans.Params{
			PrincipalCents:      in.PrincipalCents,
			AnnualRateBps:       in.AnnualRateBps,
			MonthlyPaymentCents: in.MonthlyPaymentCents,
			TermMonths:          in.TermMonths,
			StartDate:           start,
			DayOfMonth:          in.DayOfMonth,
		})
		if len(rows) == 0 || rows[len(rows)-1].RemainingCents != 0 {
			return ErrLoanInvalid
		}

		inserted := true
		err = tx.QueryRow(ctx, `
			INSERT INTO public.loans (
				user_id, account_id, description, lender,
				principal_cents, annual_rate_bps, term_months, monthly_payment_cents,
				start_date, day_of_month, idempotency_key
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
			ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
			RETURNING `+loanColumns,
			userID, in.AccountID, in.Description, in.Lender,
			in.PrincipalCents, in.AnnualRateBps, in.TermMonths, in.MonthlyPaymentCents,
			in.StartDate, in.DayOfMonth, in.IdempotencyKey,
		).Scan(
			&l.ID, &l.UserID, &l.AccountID, &l.Description, &l.Lender,
			&l.PrincipalCents, &l.AnnualRateBps, &l.TermMonths, &l.MonthlyPaymentCents,
			&l.StartDate, &l.DayOfMonth, &l.Status, &l.CreatedAt, &l.UpdatedAt,
		)
		if errors.Is(err, pgx.ErrNoRows) && in.IdempotencyKey != nil {
			inserted = false
			if err := scanLoan(tx.QueryRow(ctx, `
				SELECT `+loanColumns+` FROM public.loans WHERE user_id = $1 AND idempotency_key = $2
			`, userID, *in.IdempotencyKey), &l); err != nil {
				return err
			}
			if !sameMaterialLoan(l, in) {
				return ErrIdempotencyConflict
			}
		} else if err != nil {
			return err
		}
		if !inserted {
			return completeIdempotentCreate(ctx, tx, userID, in.IdempotencyKey, "loan", l.ID)
		}
		if err := insertLoanSchedule(ctx, tx, userID, l.ID, rows); err != nil {
			return err
		}
		return completeIdempotentCreate(ctx, tx, userID, in.IdempotencyKey, "loan", l.ID)
	})
	if err != nil {
		return Loan{}, fmt.Errorf("create loan: %w", err)
	}
	l.RemainingCents = l.PrincipalCents
	return l, nil
}

func sameMaterialLoan(existing Loan, requested LoanInput) bool {
	return existing.AccountID == requested.AccountID &&
		existing.Description == requested.Description &&
		equalOptionalString(existing.Lender, requested.Lender) &&
		existing.PrincipalCents == requested.PrincipalCents &&
		existing.AnnualRateBps == requested.AnnualRateBps &&
		existing.TermMonths == requested.TermMonths &&
		existing.MonthlyPaymentCents == requested.MonthlyPaymentCents &&
		existing.StartDate == requested.StartDate &&
		existing.DayOfMonth == requested.DayOfMonth
}

func insertLoanSchedule(ctx context.Context, tx pgx.Tx, userID, loanID string, rows []loans.Row) error {
	for _, row := range rows {
		if _, err := tx.Exec(ctx, `
			INSERT INTO public.loan_payments (
				user_id, loan_id, sequence, due_date,
				principal_cents, interest_cents, total_cents
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
		`, userID, loanID, row.Sequence, row.DueDate.Format("2006-01-02"),
			row.PrincipalCents, row.InterestCents, row.TotalCents); err != nil {
			return err
		}
	}
	return nil
}

// Update edits labels and the payment account. Financial terms stay frozen
// once the schedule exists.
func (r *LoanRepository) Update(ctx context.Context, userID, id string, patch LoanPatch) (Loan, error) {
	var l Loan
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		existing, err := loadLoan(ctx, tx, userID, id, true)
		if err != nil {
			return err
		}
		accountID := existing.AccountID
		if patch.AccountID != nil && *patch.AccountID != "" {
			accountID = *patch.AccountID
		}
		accounts, err := lockTransactionAccounts(ctx, tx, userID, []string{accountID})
		if err != nil {
			return err
		}
		if !validLoanAccount(accounts[accountID]) {
			return ErrLoanInvalid
		}
		description := existing.Description
		if patch.Description != nil && *patch.Description != "" {
			description = *patch.Description
		}
		var lender *string
		if patch.Lender.Set {
			lender = patch.Lender.Value
		} else {
			lender = existing.Lender
		}
		return scanLoan(tx.QueryRow(ctx, `
			UPDATE public.loans SET
				account_id = $3, description = $4, lender = $5, updated_at = now()
			WHERE user_id = $1 AND id = $2
			RETURNING `+loanColumns,
			userID, id, accountID, description, lender,
		), &l)
	})
	if err != nil {
		return Loan{}, fmt.Errorf("update loan: %w", err)
	}
	return l, nil
}

// Delete removes unused loans; settled history must be undone first.
func (r *LoanRepository) Delete(ctx context.Context, userID, id string) error {
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		if _, err := loadLoan(ctx, tx, userID, id, true); err != nil {
			return err
		}
		var hasHistory bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM public.loan_payments WHERE user_id=$1 AND loan_id=$2 AND status <> 'pending')`, userID, id).Scan(&hasHistory); err != nil {
			return err
		}
		if hasHistory {
			return ErrLoanInvalid
		}
		tag, err := tx.Exec(ctx, `DELETE FROM public.loans WHERE user_id = $1 AND id = $2`, userID, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("delete loan: %w", err)
	}
	return nil
}

// Pay settles one scheduled payment: records the actual principal/interest
// split and creates the expense transaction on the loan account.
func (r *LoanRepository) Pay(ctx context.Context, userID, loanID, paymentID string, in PayLoanPaymentInput) (LoanPayment, error) {
	var payment LoanPayment
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		loan, err := loadLoan(ctx, tx, userID, loanID, true)
		if err != nil {
			return err
		}
		if err := scanLoanPayment(tx.QueryRow(ctx, `
			SELECT `+loanPaymentColumns+` FROM public.loan_payments
			WHERE user_id = $1 AND loan_id = $2 AND id = $3 FOR UPDATE
		`, userID, loanID, paymentID), &payment); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if payment.Status == "paid" {
			if payment.PaidAt == nil || *payment.PaidAt != in.Date || (in.PaidTotalCents != nil && (payment.PaidTotalCents == nil || *in.PaidTotalCents != *payment.PaidTotalCents)) || (in.PaidPrincipalCents != nil && (payment.PaidPrincipalCents == nil || *in.PaidPrincipalCents != *payment.PaidPrincipalCents)) || (in.PaidInterestCents != nil && (payment.PaidInterestCents == nil || *in.PaidInterestCents != *payment.PaidInterestCents)) {
				return ErrLoanInvalid
			}
			return nil
		}
		if payment.Status == "adjustment" {
			return ErrLoanInvalid
		}
		var nextID string
		if err := tx.QueryRow(ctx, `SELECT id FROM public.loan_payments WHERE user_id=$1 AND loan_id=$2 AND status='pending' ORDER BY sequence LIMIT 1`, userID, loanID).Scan(&nextID); err != nil {
			return err
		}
		if nextID != paymentID {
			return ErrLoanInvalid
		}
		if err := validateLoanEventDate(ctx, tx, userID, loanID, in.Date, false); err != nil {
			return err
		}
		if _, err := time.Parse("2006-01-02", in.Date); err != nil {
			return fmt.Errorf("date must be YYYY-MM-DD: %w", err)
		}

		paidTotal := payment.TotalCents
		if in.PaidTotalCents != nil && *in.PaidTotalCents > 0 {
			paidTotal = *in.PaidTotalCents
		}
		principal, interest := payment.PrincipalCents, payment.InterestCents
		if in.PaidPrincipalCents != nil {
			principal = *in.PaidPrincipalCents
		}
		if in.PaidInterestCents != nil {
			interest = *in.PaidInterestCents
		}
		remaining, err := trackedRemainingCents(ctx, tx, userID, loanID)
		if err != nil {
			return err
		}
		if principal < 0 || interest < 0 || principal > remaining || principal+interest > paidTotal {
			return ErrLoanInvalid
		}
		if in.PaidTotalCents != nil && paidTotal < payment.TotalCents && in.PaidPrincipalCents == nil {
			return ErrLoanInvalid
		}
		accounts, err := lockTransactionAccounts(ctx, tx, userID, []string{loan.AccountID})
		if err != nil {
			return err
		}
		description := fmt.Sprintf("%s — mensualidad %d", loan.Description, payment.Sequence)
		if !validLoanAccount(accounts[loan.AccountID]) {
			return ErrLoanInvalid
		}
		transaction, _, err := createTransactionWithLockedAccounts(ctx, tx, userID, TransactionInput{
			AccountID:   loan.AccountID,
			Type:        "expense",
			Amount:      paidTotal,
			CategoryID:  in.CategoryID,
			Date:        in.Date,
			Description: description,
			Merchant:    loan.Lender,
		}, accounts)
		if err != nil {
			return err
		}

		if err := tx.QueryRow(ctx, `
			UPDATE public.loan_payments SET
				status = 'paid',
    created_at = now(),
				paid_principal_cents = $4,
				paid_interest_cents = $5,
				paid_total_cents = $6,
				transaction_id = $7,
				paid_at = $8::date
			WHERE user_id = $1 AND loan_id = $2 AND id = $3
			RETURNING `+loanPaymentColumns,
			userID, loanID, paymentID,
			principal, interest, paidTotal,
			transaction.ID, in.Date,
		).Scan(
			&payment.ID, &payment.LoanID, &payment.Sequence, &payment.DueDate,
			&payment.PrincipalCents, &payment.InterestCents, &payment.TotalCents,
			&payment.PaidPrincipalCents, &payment.PaidInterestCents, &payment.PaidTotalCents,
			&payment.Status, &payment.TransactionID, &payment.PaidAt, &payment.CreatedAt,
		); err != nil {
			return err
		}
		return regenerateLoanSchedule(ctx, tx, userID, loan, "")
	})
	if err != nil {
		return LoanPayment{}, fmt.Errorf("pay loan payment: %w", err)
	}
	return payment, nil
}

// AddExtraPayment books an ad-hoc principal payment, then regenerates every
// pending row from the reduced balance (same monthly payment, shorter term).
func (r *LoanRepository) AddExtraPayment(ctx context.Context, userID, loanID string, in ExtraLoanPaymentInput) (LoanPayment, []LoanPayment, error) {
	var extra LoanPayment
	regenerated := make([]LoanPayment, 0)
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		loan, err := loadLoan(ctx, tx, userID, loanID, true)
		if err != nil {
			return err
		}
		replayID, replay, err := beginIdempotentCreate(ctx, tx, userID, in.IdempotencyKey, "loan_extra", struct {
			LoanID string
			Input  ExtraLoanPaymentInput
		}{loanID, in})
		if err != nil {
			return err
		}
		if replay {
			if err := scanLoanPayment(tx.QueryRow(ctx, `SELECT `+loanPaymentColumns+` FROM public.loan_payments WHERE user_id=$1 AND id=$2 AND loan_id=$3`, userID, replayID, loanID), &extra); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return newIdempotencyReplayDeletedError(replayID)
				}
				return err
			}
			return loadScheduleInto(ctx, tx, userID, loanID, &regenerated)
		}
		if loan.Status == "paid_off" {
			return ErrLoanInvalid
		}
		if err := validateLoanEventDate(ctx, tx, userID, loanID, in.Date, true); err != nil {
			return err
		}
		if in.AmountCents <= 0 {
			return errors.New("amountCents must be greater than zero")
		}
		paidOn, err := time.Parse("2006-01-02", in.Date)
		if err != nil {
			return fmt.Errorf("date must be YYYY-MM-DD: %w", err)
		}
		_ = paidOn
		remainingBefore, err := trackedRemainingCents(ctx, tx, userID, loanID)
		if err != nil {
			return err
		}
		if in.AmountCents > remainingBefore {
			return ErrLoanInvalid
		}

		accounts, err := lockTransactionAccounts(ctx, tx, userID, []string{loan.AccountID})
		if err != nil {
			return err
		}
		description := fmt.Sprintf("%s — aportación a capital", loan.Description)
		if !validLoanAccount(accounts[loan.AccountID]) {
			return ErrLoanInvalid
		}
		transaction, _, err := createTransactionWithLockedAccounts(ctx, tx, userID, TransactionInput{
			AccountID:   loan.AccountID,
			Type:        "expense",
			Amount:      in.AmountCents,
			CategoryID:  in.CategoryID,
			Date:        in.Date,
			Description: description,
			Merchant:    loan.Lender,
		}, accounts)
		if err != nil {
			return err
		}

		// Unnumbered principal payments do not consume monthly installment numbers.
		if err := tx.QueryRow(ctx, `
			INSERT INTO public.loan_payments (
				user_id, loan_id, sequence, due_date,
				principal_cents, interest_cents, total_cents,
				paid_principal_cents, paid_total_cents,
				status, transaction_id, paid_at
			)
			VALUES ($1, $2, 0, $3::date, $4, 0, $4, $4, $4, 'paid', $5, $3::date)
			RETURNING `+loanPaymentColumns,
			userID, loanID, in.Date, in.AmountCents, transaction.ID,
		).Scan(
			&extra.ID, &extra.LoanID, &extra.Sequence, &extra.DueDate,
			&extra.PrincipalCents, &extra.InterestCents, &extra.TotalCents,
			&extra.PaidPrincipalCents, &extra.PaidInterestCents, &extra.PaidTotalCents,
			&extra.Status, &extra.TransactionID, &extra.PaidAt, &extra.CreatedAt,
		); err != nil {
			return err
		}

		if err := regenerateLoanSchedule(ctx, tx, userID, loan, ""); err != nil {
			return err
		}
		if err := completeIdempotentCreate(ctx, tx, userID, in.IdempotencyKey, "loan_extra", extra.ID); err != nil {
			return err
		}
		return loadScheduleInto(ctx, tx, userID, loanID, &regenerated)
	})
	if err != nil {
		return LoanPayment{}, nil, fmt.Errorf("add extra payment: %w", err)
	}
	return extra, regenerated, nil
}

// Reconcile snaps tracked debt to the bank's reported balance by inserting a
// signed adjustment row. A positive delta means the bank reports less debt
// than the schedule (more principal was repaid than tracked).
func (r *LoanRepository) Reconcile(ctx context.Context, userID, loanID string, in ReconcileLoanInput) (LoanPayment, error) {
	var adjustment LoanPayment
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		loan, err := loadLoan(ctx, tx, userID, loanID, true)
		if err != nil {
			return err
		}
		if in.ActualBalanceCents < 0 {
			return errors.New("actualBalanceCents must be >= 0")
		}
		if err := validateLoanEventDate(ctx, tx, userID, loanID, in.AsOfDate, false); err != nil {
			return err
		}
		asOf, err := time.Parse("2006-01-02", in.AsOfDate)
		if err != nil {
			return fmt.Errorf("asOfDate must be YYYY-MM-DD: %w", err)
		}
		tracked, err := trackedRemainingCents(ctx, tx, userID, loanID)
		if err != nil {
			return err
		}
		delta := tracked - in.ActualBalanceCents
		if delta == 0 {
			return nil
		}
		if err := scanLoanPayment(tx.QueryRow(ctx, `
			INSERT INTO public.loan_payments (
				user_id, loan_id, sequence, due_date,
				principal_cents, interest_cents, total_cents,
				paid_principal_cents, paid_total_cents,
				status, paid_at
			)
			VALUES ($1, $2, -1, $3::date, 0, 0, 0, $4, 0, 'adjustment', $3::date)
			RETURNING `+loanPaymentColumns,
			userID, loanID, asOf.Format("2006-01-02"), delta,
		), &adjustment); err != nil {
			return err
		}
		return regenerateLoanSchedule(ctx, tx, userID, loan, "")
	})
	if err != nil {
		return LoanPayment{}, fmt.Errorf("reconcile loan: %w", err)
	}
	return adjustment, nil
}

func validLoanAccount(account lockedAccount) bool {
	return account.typeName == "debit" && account.currency == "MXN" && account.trackingEnabled
}

func validateLoanEventDate(ctx context.Context, tx pgx.Tx, userID, loanID, date string, extra bool) error {
	var latest, next *string
	err := tx.QueryRow(ctx, `SELECT MAX(paid_at)::text,MIN(due_date) FILTER (WHERE status='pending')::text FROM public.loan_payments WHERE user_id=$1 AND loan_id=$2`, userID, loanID).Scan(&latest, &next)
	if err != nil {
		return err
	}
	if latest != nil && date < *latest {
		return ErrLoanInvalid
	}
	if extra && next != nil && date > *next {
		return ErrLoanInvalid
	}
	return nil
}

// Pending rows are projections, never ledger transactions. Rebuild them from
// actual principal while preserving the next due date and settled history.
func regenerateLoanSchedule(ctx context.Context, tx pgx.Tx, userID string, loan Loan, fallback string) error {
	remaining, err := trackedRemainingCents(ctx, tx, userID, loan.ID)
	if err != nil {
		return err
	}
	var next *string
	if err := tx.QueryRow(ctx, `SELECT MIN(due_date)::text FROM public.loan_payments WHERE user_id=$1 AND loan_id=$2 AND status='pending'`, userID, loan.ID).Scan(&next); err != nil {
		return err
	}
	var maxSeq int
	if err := tx.QueryRow(ctx, `SELECT COALESCE(MAX(sequence),0) FROM public.loan_payments WHERE user_id=$1 AND loan_id=$2 AND status='paid' AND sequence>0`, userID, loan.ID).Scan(&maxSeq); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM public.loan_payments WHERE user_id=$1 AND loan_id=$2 AND status='pending'`, userID, loan.ID); err != nil {
		return err
	}
	if remaining > 0 {
		start, err := time.Parse("2006-01-02", loan.StartDate)
		if err != nil {
			return err
		}
		start = start.AddDate(0, maxSeq, 0)
		if next != nil {
			start, err = time.Parse("2006-01-02", *next)
		} else if fallback != "" {
			start, err = time.Parse("2006-01-02", fallback)
		}
		if err != nil {
			return err
		}
		// Up to 600 periods accommodates reconciled balances without inventing a balloon payment.
		rows := loans.BuildSchedule(loans.Params{PrincipalCents: remaining, AnnualRateBps: loan.AnnualRateBps, MonthlyPaymentCents: loan.MonthlyPaymentCents, TermMonths: 600, StartDate: start, DayOfMonth: loan.DayOfMonth})
		if len(rows) == 0 || rows[len(rows)-1].RemainingCents != 0 {
			return ErrLoanInvalid
		}
		for i := range rows {
			rows[i].Sequence = maxSeq + i + 1
		}
		if err := insertLoanSchedule(ctx, tx, userID, loan.ID, rows); err != nil {
			return err
		}
	}
	status := "active"
	if remaining <= 0 {
		status = "paid_off"
	}
	_, err = tx.Exec(ctx, `UPDATE public.loans SET status=$3,updated_at=now() WHERE user_id=$1 AND id=$2`, userID, loan.ID, status)
	return err
}

func loadScheduleInto(ctx context.Context, tx pgx.Tx, userID, loanID string, out *[]LoanPayment) error {
	rows, err := tx.Query(ctx, `
		SELECT `+loanPaymentColumns+`
		FROM public.loan_payments
		WHERE user_id = $1 AND loan_id = $2
		ORDER BY due_date, sequence
	`, userID, loanID)
	if err != nil {
		return err
	}
	defer rows.Close()
	payments := make([]LoanPayment, 0)
	for rows.Next() {
		var p LoanPayment
		if err := scanLoanPayment(rows, &p); err != nil {
			return err
		}
		payments = append(payments, p)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	*out = payments
	return nil
}

// refreshLoanStatus flips the loan to paid_off once nothing is pending and
// the tracked balance reached zero.
func refreshLoanStatus(ctx context.Context, tx pgx.Tx, userID, loanID string) error {
	_, err := tx.Exec(ctx, `
		UPDATE public.loans SET
			status = 'paid_off',
			updated_at = now()
		WHERE user_id = $1 AND id = $2
		  AND status = 'active'
		  AND (
				SELECT loans.principal_cents - COALESCE(SUM(p.paid_principal_cents), 0)
				FROM public.loans
				LEFT JOIN public.loan_payments AS p
					ON p.loan_id = loans.id
					AND p.status IN ('paid', 'adjustment')
					AND p.paid_principal_cents IS NOT NULL
				WHERE loans.id = $2
				GROUP BY loans.principal_cents
		  ) <= 0
		  AND NOT EXISTS (
				SELECT 1 FROM public.loan_payments
				WHERE user_id = $1 AND loan_id = $2 AND status = 'pending'
		  )
	`, userID, loanID)
	return err
}

// transactionHasLoanPayment guards transaction deletion for rows that back a
// loan payment, mirroring the MSI installment guard.
func transactionHasLoanPayment(ctx context.Context, tx pgx.Tx, userID, transactionID string) (bool, error) {
	var found bool
	err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM public.loan_payments
			WHERE user_id = $1 AND transaction_id = $2
		)
	`, userID, transactionID).Scan(&found)
	return found, err
}

// Undo reverses only the latest settled event, preserving chronological debt history.
func (r *LoanRepository) Undo(ctx context.Context, userID, loanID, paymentID string) error {
	return RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		loan, err := loadLoan(ctx, tx, userID, loanID, true)
		if err != nil {
			return err
		}
		var payment LoanPayment
		if err := scanLoanPayment(tx.QueryRow(ctx, `SELECT `+loanPaymentColumns+` FROM public.loan_payments WHERE user_id=$1 AND loan_id=$2 AND id=$3`, userID, loanID, paymentID), &payment); err != nil {
			return ErrNotFound
		}
		var latest string
		if err := tx.QueryRow(ctx, `SELECT id FROM public.loan_payments WHERE user_id=$1 AND loan_id=$2 AND status<>'pending' ORDER BY created_at DESC,id DESC LIMIT 1`, userID, loanID).Scan(&latest); err != nil {
			return ErrNotFound
		}
		if latest != paymentID {
			return ErrLoanInvalid
		}
		if payment.TransactionID != nil {
			// Clear the managed reference in this transaction before reversing/deleting
			// its ledger row; intermediate state is never committed.
			if _, err := tx.Exec(ctx, `DELETE FROM public.loan_payments WHERE user_id=$1 AND id=$2`, userID, paymentID); err != nil {
				return err
			}
			entries, err := loadTransactionBalanceEntries(ctx, tx, userID, *payment.TransactionID)
			if err != nil {
				return err
			}
			ids := []string{}
			for _, e := range entries {
				ids = append(ids, e.accountID)
			}
			accounts, err := lockTransactionAccounts(ctx, tx, userID, ids)
			if err != nil {
				return err
			}
			if err := reverseTransactionBalanceEntries(ctx, tx, userID, entries, accounts); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `DELETE FROM public.transactions WHERE user_id=$1 AND id=$2`, userID, *payment.TransactionID); err != nil {
				return err
			}
		}
		if payment.Sequence > 0 {
			if _, err := tx.Exec(ctx, `DELETE FROM public.loan_payments WHERE user_id=$1 AND loan_id=$2 AND status='pending'`, userID, loanID); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO public.loan_payments(user_id,loan_id,sequence,due_date,principal_cents,interest_cents,total_cents) VALUES ($1,$2,$3,$4,$5,$6,$7)`, userID, loanID, payment.Sequence, payment.DueDate, payment.PrincipalCents, payment.InterestCents, payment.TotalCents); err != nil {
				return err
			}
		} else {
			if _, err := tx.Exec(ctx, `DELETE FROM public.loan_payments WHERE user_id=$1 AND id=$2`, userID, paymentID); err != nil {
				return err
			}
		}
		return regenerateLoanSchedule(ctx, tx, userID, loan, payment.DueDate)
	})
}
