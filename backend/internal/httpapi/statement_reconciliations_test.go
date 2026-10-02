package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/aleonsa/budg/backend/internal/httpapi"
	"github.com/aleonsa/budg/backend/internal/statements"
	"github.com/aleonsa/budg/backend/internal/store"
)

const statementCardID = "card-1"

func syntheticStatement() statements.Statement {
	return statements.Statement{
		Issuer: "banamex", Product: "JOY BANAMEX", CardLast4: "4321",
		PeriodStart: "2026-06-08", PeriodEnd: "2026-07-08", PaymentDueDate: "2026-08-03",
		PaymentToAvoidInterestCents: 9000, TotalChargesCents: 9000,
		Movements: []statements.Movement{
			{Line: 1, OperationDate: "2026-06-10", PostingDate: "2026-06-10", Description: "CAFE", AmountCents: 4000, Direction: statements.DirectionCharge},
			{Line: 2, OperationDate: "2026-06-12", PostingDate: "2026-06-12", Description: "TIENDA", AmountCents: 5000, Direction: statements.DirectionCharge},
		},
		Warnings: []string{},
	}
}

func newStatementRouter(accounts *stubAccountStore, txs *stubTransactionStore, parse func(context.Context, []byte) (statements.Statement, error)) http.Handler {
	return httpapi.NewRouter(httpapi.Options{
		Database:       readyDatabase(),
		AuthMiddleware: authenticatedMiddleware,
		Accounts:       accounts,
		Transactions:   txs,
		ParseStatement: parse,
	})
}

func statementUploadRequest(t *testing.T, field string, content []byte) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile(field, "estado.pdf")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatalf("write part: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/accounts/"+statementCardID+"/statement-reconciliations", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	return req
}

func creditAccounts(last4 string) *stubAccountStore {
	return &stubAccountStore{listResult: []store.Account{
		{ID: statementCardID, Name: "Joy", Type: "credit", Last4: last4, IsActive: true},
		{ID: "debit-1", Name: "Débito", Type: "debit", Last4: "1111", IsActive: true},
	}}
}

func TestStatementReconciliationReturnsComparison(t *testing.T) {
	t.Parallel()
	var received []byte
	parse := func(_ context.Context, data []byte) (statements.Statement, error) {
		received = data
		return syntheticStatement(), nil
	}
	txs := &stubTransactionStore{listResult: []store.Transaction{
		{ID: "tx-cafe", AccountID: statementCardID, Type: "expense", Amount: 4000, Date: "2026-06-10", Description: "Café"},
	}}
	rec := httptest.NewRecorder()
	newStatementRouter(creditAccounts("4321"), txs, parse).ServeHTTP(rec, statementUploadRequest(t, "file", []byte("%PDF-fake")))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if string(received) != "%PDF-fake" {
		t.Fatalf("parser received %q", received)
	}
	var body statements.Reconciliation
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Summary.Matched != 1 || body.Summary.Missing != 1 || body.Summary.MissingChargesCents != 5000 {
		t.Fatalf("summary = %+v", body.Summary)
	}
	if body.Movements[0].TransactionID == nil || *body.Movements[0].TransactionID != "tx-cafe" {
		t.Fatalf("first movement = %+v", body.Movements[0])
	}
	if len(body.Statement.Warnings) != 0 {
		t.Fatalf("warnings = %v", body.Statement.Warnings)
	}
}

func TestStatementReconciliationWarnsOnCardMismatch(t *testing.T) {
	t.Parallel()
	parse := func(context.Context, []byte) (statements.Statement, error) { return syntheticStatement(), nil }
	rec := httptest.NewRecorder()
	newStatementRouter(creditAccounts("9999"), &stubTransactionStore{}, parse).
		ServeHTTP(rec, statementUploadRequest(t, "file", []byte("%PDF-fake")))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), statements.WarningCardLast4Mismatch) {
		t.Fatalf("body lacks card mismatch warning: %s", rec.Body.String())
	}
}

func TestStatementReconciliationRejectsInvalidRequests(t *testing.T) {
	t.Parallel()
	okParse := func(context.Context, []byte) (statements.Statement, error) { return syntheticStatement(), nil }
	cases := []struct {
		name     string
		accounts *stubAccountStore
		parse    func(context.Context, []byte) (statements.Statement, error)
		request  func(t *testing.T) *http.Request
		status   int
		code     string
	}{
		{
			name: "not multipart", accounts: creditAccounts("4321"), parse: okParse,
			request: func(t *testing.T) *http.Request {
				req := httptest.NewRequest(http.MethodPost, "/v1/accounts/"+statementCardID+"/statement-reconciliations", strings.NewReader("{}"))
				req.Header.Set("Content-Type", "application/json")
				return req
			},
			status: http.StatusBadRequest, code: "invalid_request",
		},
		{
			name: "missing file field", accounts: creditAccounts("4321"), parse: okParse,
			request: func(t *testing.T) *http.Request { return statementUploadRequest(t, "other", []byte("%PDF-x")) },
			status:  http.StatusBadRequest, code: "invalid_request",
		},
		{
			name: "unknown account", accounts: &stubAccountStore{}, parse: okParse,
			request: func(t *testing.T) *http.Request { return statementUploadRequest(t, "file", []byte("%PDF-x")) },
			status:  http.StatusNotFound, code: "not_found",
		},
		{
			name: "debit account", parse: okParse,
			accounts: &stubAccountStore{listResult: []store.Account{{ID: statementCardID, Type: "debit"}}},
			request:  func(t *testing.T) *http.Request { return statementUploadRequest(t, "file", []byte("%PDF-x")) },
			status:   http.StatusBadRequest, code: "invalid_request",
		},
		{
			name: "not a pdf", accounts: creditAccounts("4321"),
			parse: func(context.Context, []byte) (statements.Statement, error) {
				return statements.Statement{}, statements.ErrNotPDF
			},
			request: func(t *testing.T) *http.Request { return statementUploadRequest(t, "file", []byte("hello")) },
			status:  http.StatusBadRequest, code: "invalid_file",
		},
		{
			name: "unsupported bank", accounts: creditAccounts("4321"),
			parse: func(context.Context, []byte) (statements.Statement, error) {
				return statements.Statement{}, statements.ErrUnsupportedStatement
			},
			request: func(t *testing.T) *http.Request { return statementUploadRequest(t, "file", []byte("%PDF-x")) },
			status:  http.StatusUnprocessableEntity, code: "unsupported_statement",
		},
		{
			name: "unreadable pdf", accounts: creditAccounts("4321"),
			parse: func(context.Context, []byte) (statements.Statement, error) {
				return statements.Statement{}, statements.ErrUnreadablePDF
			},
			request: func(t *testing.T) *http.Request { return statementUploadRequest(t, "file", []byte("%PDF-x")) },
			status:  http.StatusUnprocessableEntity, code: "unreadable_statement",
		},
		{
			name: "parser busy", accounts: creditAccounts("4321"),
			parse: func(context.Context, []byte) (statements.Statement, error) {
				return statements.Statement{}, statements.ErrParserBusy
			},
			request: func(t *testing.T) *http.Request { return statementUploadRequest(t, "file", []byte("%PDF-x")) },
			status:  http.StatusTooManyRequests, code: "parser_busy",
		},
		{
			name: "parse timeout", accounts: creditAccounts("4321"),
			parse: func(context.Context, []byte) (statements.Statement, error) {
				return statements.Statement{}, statements.ErrParseTimeout
			},
			request: func(t *testing.T) *http.Request { return statementUploadRequest(t, "file", []byte("%PDF-x")) },
			status:  http.StatusServiceUnavailable, code: "statement_timeout",
		},
		{
			name: "oversized upload", accounts: creditAccounts("4321"), parse: okParse,
			request: func(t *testing.T) *http.Request {
				return statementUploadRequest(t, "file", bytes.Repeat([]byte("a"), statements.MaxPDFBytes+1))
			},
			status: http.StatusRequestEntityTooLarge, code: "payload_too_large",
		},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			rec := httptest.NewRecorder()
			newStatementRouter(tc.accounts, &stubTransactionStore{}, tc.parse).ServeHTTP(rec, tc.request(t))
			if rec.Code != tc.status {
				t.Fatalf("status = %d, want %d (body=%s)", rec.Code, tc.status, rec.Body.String())
			}
			var response struct {
				Error struct {
					Code string `json:"code"`
				} `json:"error"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if response.Error.Code != tc.code {
				t.Fatalf("code = %q, want %q", response.Error.Code, tc.code)
			}
		})
	}
}
