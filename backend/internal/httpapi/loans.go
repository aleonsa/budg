package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/aleonsa/budg/backend/internal/auth"
	"github.com/aleonsa/budg/backend/internal/loans"
	"github.com/aleonsa/budg/backend/internal/store"
	"github.com/go-chi/chi/v5"
)

type LoanStore interface {
	List(context.Context, string) ([]store.Loan, error)
	Get(context.Context, string, string) (store.Loan, []store.LoanPayment, error)
	Create(context.Context, string, store.LoanInput) (store.Loan, error)
	Update(context.Context, string, string, store.LoanPatch) (store.Loan, error)
	Delete(context.Context, string, string) error
	Pay(context.Context, string, string, string, store.PayLoanPaymentInput) (store.LoanPayment, error)
	AddExtraPayment(context.Context, string, string, store.ExtraLoanPaymentInput) (store.LoanPayment, []store.LoanPayment, error)
	Reconcile(context.Context, string, string, store.ReconcileLoanInput) (store.LoanPayment, error)
	Undo(context.Context, string, string, string) error
}

type loansHandler struct{ store LoanStore }

func loanUser(w http.ResponseWriter, r *http.Request) (string, bool) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{Error: apiError{Code: "unauthorized", Message: "a valid access token is required"}})
		return "", false
	}
	for _, key := range []string{"id", "paymentId"} {
		if id := chi.URLParam(r, key); id != "" && !uuidPattern.MatchString(id) {
			loanBadRequest(w, "invalid resource ID")
			return "", false
		}
	}
	return user.ID, true
}
func loanBadRequest(w http.ResponseWriter, message string) {
	writeJSON(w, http.StatusBadRequest, errorResponse{Error: apiError{Code: "invalid_request", Message: message}})
}
func loanError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeJSON(w, http.StatusNotFound, errorResponse{Error: apiError{Code: "not_found", Message: "loan or payment not found"}})
	case errors.Is(err, store.ErrLoanInvalid):
		writeJSON(w, http.StatusConflict, errorResponse{Error: apiError{Code: "loan_conflict", Message: "check payment order, principal and amounts; loans with history cannot be deleted"}})
	case errors.Is(err, store.ErrIdempotencyConflict), errors.Is(err, store.ErrIdempotencyReplayDeleted):
		writeJSON(w, http.StatusConflict, errorResponse{Error: apiError{Code: "idempotency_conflict", Message: "this operation key has already been used"}})
	default:
		writeInternalError(w, r, err, "could not process loan")
	}
}
func validLoanDate(s string) bool {
	d, err := time.Parse("2006-01-02", s)
	return err == nil && d.Year() >= 2000 && d.Year() <= 2200
}
func validLoanCategory(id *string) bool { return id == nil || uuidPattern.MatchString(*id) }
func loanParams(in store.LoanInput) loans.Params {
	start, _ := time.Parse("2006-01-02", in.StartDate)
	return loans.Params{PrincipalCents: in.PrincipalCents, AnnualRateBps: in.AnnualRateBps, MonthlyPaymentCents: in.MonthlyPaymentCents, TermMonths: in.TermMonths, StartDate: start, DayOfMonth: in.DayOfMonth}
}
func validLoanInput(in store.LoanInput) bool {
	if !uuidPattern.MatchString(in.AccountID) || strings.TrimSpace(in.Description) == "" || len(in.Description) > 500 || in.Lender != nil && len(*in.Lender) > 200 || !validLoanDate(in.StartDate) {
		return false
	}
	p := loanParams(in)
	if loans.Validate(p) != nil {
		return false
	}
	s := loans.BuildSchedule(p)
	return len(s) > 0 && s[0].DueDate.Format("2006-01-02") == in.StartDate && s[len(s)-1].RemainingCents == 0
}
func loanKey(r *http.Request) (*string, bool) {
	key := r.Header.Get("Idempotency-Key")
	if len(key) > 128 {
		return nil, false
	}
	if key == "" {
		return nil, true
	}
	return &key, true
}

func (h *loansHandler) list(w http.ResponseWriter, r *http.Request) {
	u, ok := loanUser(w, r)
	if !ok {
		return
	}
	data, err := h.store.List(r.Context(), u)
	if err != nil {
		loanError(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"data": data})
}
func (h *loansHandler) get(w http.ResponseWriter, r *http.Request) {
	u, ok := loanUser(w, r)
	if !ok {
		return
	}
	loan, payments, err := h.store.Get(r.Context(), u, chi.URLParam(r, "id"))
	if err != nil {
		loanError(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"loan": loan, "payments": payments})
}
func (h *loansHandler) create(w http.ResponseWriter, r *http.Request) {
	u, ok := loanUser(w, r)
	if !ok {
		return
	}
	var in store.LoanInput
	if decodeJSON(r, &in) != nil || !validLoanInput(in) {
		loanBadRequest(w, "invalid loan terms or payment does not amortize within the selected term")
		return
	}
	key, ok := loanKey(r)
	if !ok {
		loanBadRequest(w, "invalid idempotency key")
		return
	}
	in.IdempotencyKey = key
	data, err := h.store.Create(r.Context(), u, in)
	if err != nil {
		loanError(w, r, err)
		return
	}
	writeJSON(w, 201, data)
}
func (h *loansHandler) update(w http.ResponseWriter, r *http.Request) {
	u, ok := loanUser(w, r)
	if !ok {
		return
	}
	var in store.LoanPatch
	if decodeJSON(r, &in) != nil || in.AccountID != nil && !uuidPattern.MatchString(*in.AccountID) || in.Description != nil && (strings.TrimSpace(*in.Description) == "" || len(*in.Description) > 500) || in.Lender.Value != nil && len(*in.Lender.Value) > 200 {
		loanBadRequest(w, "invalid loan fields")
		return
	}
	data, err := h.store.Update(r.Context(), u, chi.URLParam(r, "id"), in)
	if err != nil {
		loanError(w, r, err)
		return
	}
	writeJSON(w, 200, data)
}
func (h *loansHandler) delete(w http.ResponseWriter, r *http.Request) {
	u, ok := loanUser(w, r)
	if !ok {
		return
	}
	if err := h.store.Delete(r.Context(), u, chi.URLParam(r, "id")); err != nil {
		loanError(w, r, err)
		return
	}
	w.WriteHeader(204)
}
func (h *loansHandler) pay(w http.ResponseWriter, r *http.Request) {
	u, ok := loanUser(w, r)
	if !ok {
		return
	}
	var in store.PayLoanPaymentInput
	if decodeJSON(r, &in) != nil || !validLoanDate(in.Date) || !validLoanCategory(in.CategoryID) {
		loanBadRequest(w, "invalid payment")
		return
	}
	for _, v := range []*int64{in.PaidTotalCents, in.PaidPrincipalCents, in.PaidInterestCents} {
		if v != nil && (*v < 0 || *v > 1_000_000_000_000) {
			loanBadRequest(w, "invalid payment amount")
			return
		}
	}
	if in.PaidTotalCents != nil && *in.PaidTotalCents == 0 {
		loanBadRequest(w, "payment total must be positive")
		return
	}
	data, err := h.store.Pay(r.Context(), u, chi.URLParam(r, "id"), chi.URLParam(r, "paymentId"), in)
	if err != nil {
		loanError(w, r, err)
		return
	}
	writeJSON(w, 200, data)
}
func (h *loansHandler) extra(w http.ResponseWriter, r *http.Request) {
	u, ok := loanUser(w, r)
	if !ok {
		return
	}
	var in store.ExtraLoanPaymentInput
	if decodeJSON(r, &in) != nil || !validLoanDate(in.Date) || !validLoanCategory(in.CategoryID) || in.AmountCents <= 0 || in.AmountCents > 1_000_000_000_000 {
		loanBadRequest(w, "invalid principal payment")
		return
	}
	key, ok := loanKey(r)
	if !ok || key == nil {
		loanBadRequest(w, "Idempotency-Key is required for extra payments")
		return
	}
	in.IdempotencyKey = key
	extra, payments, err := h.store.AddExtraPayment(r.Context(), u, chi.URLParam(r, "id"), in)
	if err != nil {
		loanError(w, r, err)
		return
	}
	writeJSON(w, 201, map[string]any{"payment": extra, "payments": payments})
}
func (h *loansHandler) reconcile(w http.ResponseWriter, r *http.Request) {
	u, ok := loanUser(w, r)
	if !ok {
		return
	}
	var in store.ReconcileLoanInput
	if decodeJSON(r, &in) != nil || !validLoanDate(in.AsOfDate) || in.ActualBalanceCents < 0 || in.ActualBalanceCents > 1_000_000_000_000 {
		loanBadRequest(w, "invalid reconciliation balance or date")
		return
	}
	data, err := h.store.Reconcile(r.Context(), u, chi.URLParam(r, "id"), in)
	if err != nil {
		loanError(w, r, err)
		return
	}
	writeJSON(w, 200, data)
}
func (h *loansHandler) undo(w http.ResponseWriter, r *http.Request) {
	u, ok := loanUser(w, r)
	if !ok {
		return
	}
	if err := h.store.Undo(r.Context(), u, chi.URLParam(r, "id"), chi.URLParam(r, "paymentId")); err != nil {
		loanError(w, r, err)
		return
	}
	w.WriteHeader(204)
}

type loanScheduleRow struct {
	Sequence       int    `json:"sequence"`
	DueDate        string `json:"dueDate"`
	PrincipalCents int64  `json:"principalCents"`
	InterestCents  int64  `json:"interestCents"`
	TotalCents     int64  `json:"totalCents"`
	RemainingCents int64  `json:"remainingCents"`
}

func (h *loansHandler) calculate(w http.ResponseWriter, r *http.Request) {
	u, ok := loanUser(w, r)
	if !ok {
		return
	}
	var in struct {
		AmountCents int64  `json:"amountCents"`
		Date        string `json:"date"`
	}
	if decodeJSON(r, &in) != nil || in.AmountCents < 0 || in.AmountCents > 1_000_000_000_000 || !validLoanDate(in.Date) {
		loanBadRequest(w, "invalid simulation")
		return
	}
	loan, payments, err := h.store.Get(r.Context(), u, chi.URLParam(r, "id"))
	if err != nil {
		loanError(w, r, err)
		return
	}
	var pending []store.LoanPayment
	for _, p := range payments {
		if p.Status == "pending" {
			pending = append(pending, p)
		}
	}
	if len(pending) == 0 || loan.RemainingCents <= 0 {
		loanBadRequest(w, "loan has no pending payments")
		return
	}
	start, _ := time.Parse("2006-01-02", pending[0].DueDate)
	p := loans.Params{PrincipalCents: loan.RemainingCents, AnnualRateBps: loan.AnnualRateBps, MonthlyPaymentCents: loan.MonthlyPaymentCents, TermMonths: len(pending), StartDate: start, DayOfMonth: loan.DayOfMonth}
	date, _ := time.Parse("2006-01-02", in.Date)
	for _, event := range payments {
		if event.Status != "pending" && event.PaidAt != nil && in.Date < *event.PaidAt {
			loanBadRequest(w, "simulation date must be after the last recorded event")
			return
		}
	}
	result := loans.ApplyExtraPayment(p, in.AmountCents, date)
	rows := make([]loanScheduleRow, 0, len(result.Schedule))
	for _, r := range result.Schedule {
		rows = append(rows, loanScheduleRow{r.Sequence, r.DueDate.Format("2006-01-02"), r.PrincipalCents, r.InterestCents, r.TotalCents, r.RemainingCents})
	}
	writeJSON(w, 200, map[string]any{"interestSavedCents": result.InterestSavedCents, "monthsSaved": result.MonthsSaved, "newPayoffDate": result.NewPayoffDate.Format("2006-01-02"), "schedule": rows, "estimated": true})
}
