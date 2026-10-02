package httpapi

import (
	"context"
	"errors"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/aleonsa/budg/backend/internal/auth"
	"github.com/aleonsa/budg/backend/internal/statements"
)

// statementUploadOverhead leaves room for multipart boundaries and headers on
// top of the PDF size cap.
const statementUploadOverhead = 64 << 10

// statementReconciliationHandler parses an uploaded credit card statement PDF
// in memory and compares it with the account's recorded transactions. The PDF
// is never persisted or logged; only the structured comparison is returned.
type statementReconciliationHandler struct {
	accounts     AccountStore
	transactions TransactionStore
	parse        func(context.Context, []byte) (statements.Statement, error)
}

func newStatementReconciliationHandler(
	accounts AccountStore,
	transactions TransactionStore,
	parse func(context.Context, []byte) (statements.Statement, error),
) *statementReconciliationHandler {
	if parse == nil {
		parse = statements.ParseContext
	}
	return &statementReconciliationHandler{accounts: accounts, transactions: transactions, parse: parse}
}

func (h *statementReconciliationHandler) reconcile(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{
			Error: apiError{Code: "unauthorized", Message: "a valid access token is required"},
		})
		return
	}
	accountID := chi.URLParam(r, "id")

	accounts, err := h.accounts.List(r.Context(), user.ID)
	if err != nil {
		writeInternalError(w, r, err, "could not load account")
		return
	}
	accountIndex := -1
	for i := range accounts {
		if accounts[i].ID == accountID {
			accountIndex = i
			break
		}
	}
	if accountIndex < 0 {
		writeJSON(w, http.StatusNotFound, errorResponse{
			Error: apiError{Code: "not_found", Message: "account was not found"},
		})
		return
	}
	account := accounts[accountIndex]
	if account.Type != "credit" {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: apiError{Code: "invalid_request", Message: "statement reconciliation requires a credit account"},
		})
		return
	}

	data, status, code, message := readStatementUpload(w, r)
	if status != 0 {
		writeJSON(w, status, errorResponse{Error: apiError{Code: code, Message: message}})
		return
	}

	statement, err := h.parse(r.Context(), data)
	if err != nil {
		switch {
		case errors.Is(err, statements.ErrNotPDF):
			writeJSON(w, http.StatusBadRequest, errorResponse{
				Error: apiError{Code: "invalid_file", Message: "file must be a PDF statement"},
			})
		case errors.Is(err, statements.ErrUnreadablePDF):
			writeJSON(w, http.StatusUnprocessableEntity, errorResponse{
				Error: apiError{Code: "unreadable_statement", Message: "the PDF has no readable text layer"},
			})
		case errors.Is(err, statements.ErrParserBusy):
			writeJSON(w, http.StatusTooManyRequests, errorResponse{
				Error: apiError{Code: "parser_busy", Message: "another statement is being processed; try again shortly"},
			})
		case errors.Is(err, statements.ErrParseTimeout):
			writeJSON(w, http.StatusServiceUnavailable, errorResponse{
				Error: apiError{Code: "statement_timeout", Message: "the statement took too long to process"},
			})
		case errors.Is(err, statements.ErrUnsupportedStatement):
			writeJSON(w, http.StatusUnprocessableEntity, errorResponse{
				Error: apiError{Code: "unsupported_statement", Message: "statement format is not supported yet"},
			})
		default:
			writeInternalError(w, r, err, "could not parse statement")
		}
		return
	}
	if account.Last4 != "" && statement.CardLast4 != "" && account.Last4 != statement.CardLast4 {
		statement.Warnings = append(append([]string{}, statement.Warnings...), statements.WarningCardLast4Mismatch)
	}

	transactions, err := h.transactions.List(r.Context(), user.ID)
	if err != nil {
		writeInternalError(w, r, err, "could not load transactions")
		return
	}
	writeJSON(w, http.StatusOK, statements.Reconcile(statement, accountID, transactions))
}

// readStatementUpload streams the multipart "file" part into memory under a
// hard size cap without spilling to temporary files. A non-zero status means
// the request was rejected with the returned code and message.
func readStatementUpload(w http.ResponseWriter, r *http.Request) ([]byte, int, string, string) {
	r.Body = http.MaxBytesReader(w, r.Body, statements.MaxPDFBytes+statementUploadOverhead)
	reader, err := r.MultipartReader()
	if err != nil {
		return nil, http.StatusBadRequest, "invalid_request", "request must be multipart/form-data with a file field"
	}
	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			return nil, http.StatusBadRequest, "invalid_request", "file field is required"
		}
		if err != nil {
			var tooLarge *http.MaxBytesError
			if errors.As(err, &tooLarge) {
				return nil, http.StatusRequestEntityTooLarge, "payload_too_large", "statement must be at most 4 MiB"
			}
			return nil, http.StatusBadRequest, "invalid_request", "multipart body is malformed"
		}
		if part.FormName() != "file" {
			_ = part.Close()
			continue
		}
		data, err := io.ReadAll(io.LimitReader(part, statements.MaxPDFBytes+1))
		_ = part.Close()
		if err != nil {
			var tooLarge *http.MaxBytesError
			if errors.As(err, &tooLarge) {
				return nil, http.StatusRequestEntityTooLarge, "payload_too_large", "statement must be at most 4 MiB"
			}
			return nil, http.StatusBadRequest, "invalid_request", "file could not be read"
		}
		if len(data) > statements.MaxPDFBytes {
			return nil, http.StatusRequestEntityTooLarge, "payload_too_large", "statement must be at most 4 MiB"
		}
		return data, 0, "", ""
	}
}
