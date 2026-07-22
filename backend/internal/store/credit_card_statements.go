package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrInvalidCreditCardStatement = errors.New("invalid credit card statement")

type CreditCardStatement struct {
	ID                    string    `json:"id"`
	AccountID             string    `json:"accountId"`
	CycleStartDate        string    `json:"cycleStartDate"`
	CycleEndDate          string    `json:"cycleEndDate"`
	PaymentDueDate        string    `json:"paymentDueDate"`
	StatementBalanceCents int64     `json:"statementBalance"`
	MinimumPaymentCents   *int64    `json:"minimumPayment,omitempty"`
	PaidAmountCents       int64     `json:"paidAmount"`
	Status                string    `json:"status"`
	ConfirmedAt           time.Time `json:"confirmedAt"`
}

type CreditCardStatementInput struct {
	CycleStartDate        string `json:"cycleStartDate"`
	CycleEndDate          string `json:"cycleEndDate"`
	PaymentDueDate        string `json:"paymentDueDate"`
	StatementBalanceCents int64  `json:"statementBalance"`
	MinimumPaymentCents   *int64 `json:"minimumPayment"`
}

const creditCardStatementQuery = `
	SELECT
		s.id,
		s.account_id,
		s.cycle_start_date::text,
		s.cycle_end_date::text,
		s.payment_due_date::text,
		s.statement_balance_cents,
		s.minimum_payment_cents,
		COALESCE(payments.paid_amount, 0)::bigint AS paid_amount,
		CASE
			WHEN COALESCE(payments.paid_amount, 0) >= s.statement_balance_cents THEN 'paid'
			WHEN CURRENT_DATE > s.payment_due_date THEN 'overdue'
			WHEN COALESCE(payments.paid_amount, 0) > 0 THEN 'partial'
			ELSE 'pending'
		END AS status,
		s.confirmed_at
	FROM public.credit_card_statements s
	LEFT JOIN LATERAL (
		SELECT SUM(t.amount) AS paid_amount
		FROM public.transactions t
		WHERE t.user_id = s.user_id
			AND t.credit_card_statement_id = s.id
			AND t.type = 'transfer'
			AND t.date <= CURRENT_DATE
	) payments ON true`

func scanCreditCardStatement(row pgx.Row, statement *CreditCardStatement) error {
	return row.Scan(
		&statement.ID,
		&statement.AccountID,
		&statement.CycleStartDate,
		&statement.CycleEndDate,
		&statement.PaymentDueDate,
		&statement.StatementBalanceCents,
		&statement.MinimumPaymentCents,
		&statement.PaidAmountCents,
		&statement.Status,
		&statement.ConfirmedAt,
	)
}

type CreditCardStatementRepository struct {
	pool *pgxpool.Pool
}

func NewCreditCardStatementRepository(pool *pgxpool.Pool) *CreditCardStatementRepository {
	return &CreditCardStatementRepository{pool: pool}
}

func (r *CreditCardStatementRepository) List(ctx context.Context, userID, accountID string) ([]CreditCardStatement, error) {
	statements := make([]CreditCardStatement, 0)
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		if err := validateCreditAccount(ctx, tx, userID, accountID, false); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, creditCardStatementQuery+`
			WHERE s.user_id = $1 AND s.account_id = $2
			ORDER BY s.cycle_end_date DESC, s.id DESC
		`, userID, accountID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var statement CreditCardStatement
			if err := scanCreditCardStatement(rows, &statement); err != nil {
				return err
			}
			statements = append(statements, statement)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, fmt.Errorf("list credit card statements: %w", err)
	}
	return statements, nil
}

func (r *CreditCardStatementRepository) Confirm(ctx context.Context, userID, accountID string, input CreditCardStatementInput) (CreditCardStatement, error) {
	if err := validateCreditCardStatementInput(input); err != nil {
		return CreditCardStatement{}, err
	}

	var statement CreditCardStatement
	err := RunScoped(ctx, r.pool, userID, func(ctx context.Context, tx pgx.Tx) error {
		if err := validateCreditAccount(ctx, tx, userID, accountID, true); err != nil {
			return err
		}
		var statementID string
		if err := tx.QueryRow(ctx, `
			INSERT INTO public.credit_card_statements (
				user_id, account_id, cycle_start_date, cycle_end_date,
				payment_due_date, statement_balance_cents, minimum_payment_cents
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			ON CONFLICT (account_id, cycle_end_date) DO UPDATE SET
				cycle_start_date = EXCLUDED.cycle_start_date,
				payment_due_date = EXCLUDED.payment_due_date,
				statement_balance_cents = EXCLUDED.statement_balance_cents,
				minimum_payment_cents = EXCLUDED.minimum_payment_cents,
				confirmed_at = now(),
				updated_at = now()
			RETURNING id
		`, userID, accountID, input.CycleStartDate, input.CycleEndDate,
			input.PaymentDueDate, input.StatementBalanceCents, input.MinimumPaymentCents,
		).Scan(&statementID); err != nil {
			return err
		}
		return scanCreditCardStatement(tx.QueryRow(ctx, creditCardStatementQuery+`
			WHERE s.user_id = $1 AND s.id = $2
		`, userID, statementID), &statement)
	})
	if err != nil {
		return CreditCardStatement{}, fmt.Errorf("confirm credit card statement: %w", err)
	}
	return statement, nil
}

func validateCreditAccount(ctx context.Context, tx pgx.Tx, userID, accountID string, requireActive bool) error {
	var accountType string
	var active bool
	err := tx.QueryRow(ctx, `
		SELECT type, is_active
		FROM public.accounts
		WHERE user_id = $1 AND id = $2
	`, userID, accountID).Scan(&accountType, &active)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if accountType != "credit" {
		return ErrInvalidAccountShape
	}
	if requireActive && !active {
		return fmt.Errorf("%w: credit account is inactive", ErrInvalidCreditCardStatement)
	}
	return nil
}

func validateCreditCardStatementInput(input CreditCardStatementInput) error {
	cycleStart, err := time.Parse("2006-01-02", input.CycleStartDate)
	if err != nil {
		return fmt.Errorf("%w: invalid cycle start date", ErrInvalidCreditCardStatement)
	}
	cycleEnd, err := time.Parse("2006-01-02", input.CycleEndDate)
	if err != nil {
		return fmt.Errorf("%w: invalid cycle end date", ErrInvalidCreditCardStatement)
	}
	due, err := time.Parse("2006-01-02", input.PaymentDueDate)
	if err != nil {
		return fmt.Errorf("%w: invalid payment due date", ErrInvalidCreditCardStatement)
	}
	if cycleStart.After(cycleEnd) {
		return fmt.Errorf("%w: cycle start date must not be after cycle end date", ErrInvalidCreditCardStatement)
	}
	if !due.After(cycleEnd) {
		return fmt.Errorf("%w: payment due date must be after cycle end date", ErrInvalidCreditCardStatement)
	}
	if input.StatementBalanceCents < 0 || (input.MinimumPaymentCents != nil && *input.MinimumPaymentCents < 0) {
		return fmt.Errorf("%w: amounts must not be negative", ErrInvalidCreditCardStatement)
	}
	return nil
}
