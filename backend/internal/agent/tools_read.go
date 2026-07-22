package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/aleonsa/budg/backend/internal/store"
)

// ReadStore is the minimal read surface the read-only tools depend on. It is a
// narrow interface (not the concrete repositories) so tools stay testable with
// fakes and cannot reach any mutating method.
type ReadStore interface {
	ListAccounts(ctx context.Context, userID string) ([]store.Account, error)
	ListCategories(ctx context.Context, userID string) ([]store.Category, error)
	ListTransactions(ctx context.Context, userID string) ([]store.Transaction, error)
}

// NewReadOnlyToolRegistry builds the registry of read tools bound to a single
// authenticated user. The userID always comes from the verified JWT and is
// captured in closures so the model can never supply or override it.
func NewReadOnlyToolRegistry(data ReadStore, userID string) (*ToolRegistry, error) {
	if data == nil {
		return nil, errors.New("read store is required")
	}
	if userID == "" {
		return nil, errors.New("user id is required")
	}

	registry := NewToolRegistry()
	tools := []Tool{
		newListAccountsTool(data, userID),
		newListCategoriesTool(data, userID),
		newSearchTransactionsTool(data, userID),
		newFinancialSummaryTool(data, userID),
	}
	for _, tool := range tools {
		if err := registry.Register(tool); err != nil {
			return nil, err
		}
	}
	return registry, nil
}

// decodeToolArgs strictly decodes tool arguments, rejecting unknown fields so a
// hallucinated parameter never silently changes behavior. On failure it returns
// a safe error tool result rather than leaking the decode error to the model.
func decodeToolArgs[T any](raw json.RawMessage) (T, *ToolResult) {
	var args T
	if len(raw) == 0 {
		return args, nil
	}
	value, err := DecodeStrict[T](raw)
	if err != nil {
		result := errorResult("Argumentos inválidos para la herramienta.", false)
		return args, &result
	}
	return value, nil
}

func errorResult(summary string, retryable bool) ToolResult {
	return ToolResult{
		Status:      ToolStatusError,
		Summary:     summary,
		Retryable:   retryable,
		NextActions: []string{},
	}
}

func successResult(summary string, data any) (ToolResult, error) {
	payload, err := json.Marshal(data)
	if err != nil {
		return ToolResult{}, err
	}
	return ToolResult{
		Status:      ToolStatusSuccess,
		Summary:     summary,
		Data:        payload,
		Retryable:   false,
		NextActions: []string{},
	}, nil
}

// storeError converts an internal store failure into a safe, retryable tool
// error. Internal messages are never forwarded to the model.
func storeError() ToolResult {
	return errorResult("No se pudo consultar la información. Intenta de nuevo.", true)
}

type accountView struct {
	ID                   string `json:"id"`
	Name                 string `json:"name"`
	Type                 string `json:"type"`
	Institution          string `json:"institution"`
	Last4                string `json:"last4"`
	Currency             string `json:"currency"`
	BalanceCents         *int64 `json:"balanceCents,omitempty"`
	CreditLimitCents     *int64 `json:"creditLimitCents,omitempty"`
	AvailableCreditCents *int64 `json:"availableCreditCents,omitempty"`
	IsActive             bool   `json:"isActive"`
}

type listAccountsArgs struct {
	IncludeInactive bool `json:"includeInactive"`
}

func newListAccountsTool(data ReadStore, userID string) Tool {
	return Tool{
		Definition: ToolDefinition{
			Name:        "list_accounts",
			Description: "Lista las cuentas del usuario con saldos y crédito. Por defecto solo cuentas activas.",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"additionalProperties": false,
				"properties": {
					"includeInactive": {"type": "boolean", "description": "Incluir cuentas inactivas"}
				}
			}`),
		},
		Handler: func(ctx context.Context, raw json.RawMessage) (ToolResult, error) {
			args, bad := decodeToolArgs[listAccountsArgs](raw)
			if bad != nil {
				return *bad, nil
			}
			accounts, err := data.ListAccounts(ctx, userID)
			if err != nil {
				if ctxErr := ctx.Err(); ctxErr != nil {
					return ToolResult{}, ctxErr
				}
				return storeError(), nil
			}

			views := make([]accountView, 0, len(accounts))
			for _, account := range accounts {
				if !account.IsActive && !args.IncludeInactive {
					continue
				}
				views = append(views, accountView{
					ID:                   account.ID,
					Name:                 account.Name,
					Type:                 account.Type,
					Institution:          account.Institution,
					Last4:                account.Last4,
					Currency:             account.Currency,
					BalanceCents:         account.BalanceCents,
					CreditLimitCents:     account.CreditLimitCents,
					AvailableCreditCents: account.AvailableCreditCents,
					IsActive:             account.IsActive,
				})
			}
			return successResult(
				fmt.Sprintf("%d cuenta(s)", len(views)),
				map[string]any{"accounts": views},
			)
		},
	}
}

type categoryView struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Kind string `json:"kind"`
}

type listCategoriesArgs struct {
	Kind string `json:"kind"`
}

func newListCategoriesTool(data ReadStore, userID string) Tool {
	return Tool{
		Definition: ToolDefinition{
			Name:        "list_categories",
			Description: "Lista las categorías del usuario. Filtra opcionalmente por tipo (expense o income).",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"additionalProperties": false,
				"properties": {
					"kind": {"type": "string", "enum": ["expense", "income"]}
				}
			}`),
		},
		Handler: func(ctx context.Context, raw json.RawMessage) (ToolResult, error) {
			args, bad := decodeToolArgs[listCategoriesArgs](raw)
			if bad != nil {
				return *bad, nil
			}
			categories, err := data.ListCategories(ctx, userID)
			if err != nil {
				if ctxErr := ctx.Err(); ctxErr != nil {
					return ToolResult{}, ctxErr
				}
				return storeError(), nil
			}

			views := make([]categoryView, 0, len(categories))
			for _, category := range categories {
				if args.Kind != "" && category.Kind != args.Kind {
					continue
				}
				views = append(views, categoryView{ID: category.ID, Name: category.Name, Kind: category.Kind})
			}
			return successResult(
				fmt.Sprintf("%d categoría(s)", len(views)),
				map[string]any{"categories": views},
			)
		},
	}
}

type transactionView struct {
	ID          string  `json:"id"`
	Type        string  `json:"type"`
	AmountCents int64   `json:"amountCents"`
	AccountID   string  `json:"accountId"`
	CategoryID  *string `json:"categoryId,omitempty"`
	Date        string  `json:"date"`
	Description string  `json:"description"`
}

type searchTransactionsArgs struct {
	StartDate  string `json:"startDate"`
	EndDate    string `json:"endDate"`
	Type       string `json:"type"`
	AccountID  string `json:"accountId"`
	CategoryID string `json:"categoryId"`
	Limit      int    `json:"limit"`
}

const maxTransactionResults = 50

func newSearchTransactionsTool(data ReadStore, userID string) Tool {
	return Tool{
		Definition: ToolDefinition{
			Name:        "search_transactions",
			Description: "Busca movimientos del usuario por rango de fechas, tipo, cuenta o categoría. Devuelve total y lista acotada.",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"additionalProperties": false,
				"properties": {
					"startDate": {"type": "string", "description": "Fecha inicial YYYY-MM-DD"},
					"endDate": {"type": "string", "description": "Fecha final YYYY-MM-DD"},
					"type": {"type": "string", "enum": ["expense", "income", "transfer"]},
					"accountId": {"type": "string"},
					"categoryId": {"type": "string"},
					"limit": {"type": "integer", "minimum": 1, "maximum": 50}
				}
			}`),
		},
		Handler: func(ctx context.Context, raw json.RawMessage) (ToolResult, error) {
			args, bad := decodeToolArgs[searchTransactionsArgs](raw)
			if bad != nil {
				return *bad, nil
			}
			if err := validateOptionalDate(args.StartDate); err != nil {
				return errorResult("startDate debe tener formato YYYY-MM-DD.", false), nil
			}
			if err := validateOptionalDate(args.EndDate); err != nil {
				return errorResult("endDate debe tener formato YYYY-MM-DD.", false), nil
			}

			transactions, err := data.ListTransactions(ctx, userID)
			if err != nil {
				if ctxErr := ctx.Err(); ctxErr != nil {
					return ToolResult{}, ctxErr
				}
				return storeError(), nil
			}

			limit := args.Limit
			if limit <= 0 || limit > maxTransactionResults {
				limit = maxTransactionResults
			}

			var total int64
			views := make([]transactionView, 0)
			for _, tx := range transactions {
				if !matchesTransactionFilter(tx, args) {
					continue
				}
				total += tx.Amount
				if len(views) < limit {
					views = append(views, transactionView{
						ID:          tx.ID,
						Type:        tx.Type,
						AmountCents: tx.Amount,
						AccountID:   tx.AccountID,
						CategoryID:  tx.CategoryID,
						Date:        tx.Date,
						Description: tx.Description,
					})
				}
			}

			return successResult(
				fmt.Sprintf("%d movimiento(s)", len(views)),
				map[string]any{
					"count":        len(views),
					"totalCents":   total,
					"transactions": views,
				},
			)
		},
	}
}

type financialSummaryArgs struct {
	StartDate string `json:"startDate"`
	EndDate   string `json:"endDate"`
}

func newFinancialSummaryTool(data ReadStore, userID string) Tool {
	return Tool{
		Definition: ToolDefinition{
			Name:        "get_financial_summary",
			Description: "Resume ingresos, gastos y ahorro neto del usuario en un rango de fechas.",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"additionalProperties": false,
				"properties": {
					"startDate": {"type": "string", "description": "Fecha inicial YYYY-MM-DD"},
					"endDate": {"type": "string", "description": "Fecha final YYYY-MM-DD"}
				}
			}`),
		},
		Handler: func(ctx context.Context, raw json.RawMessage) (ToolResult, error) {
			args, bad := decodeToolArgs[financialSummaryArgs](raw)
			if bad != nil {
				return *bad, nil
			}
			if err := validateOptionalDate(args.StartDate); err != nil {
				return errorResult("startDate debe tener formato YYYY-MM-DD.", false), nil
			}
			if err := validateOptionalDate(args.EndDate); err != nil {
				return errorResult("endDate debe tener formato YYYY-MM-DD.", false), nil
			}

			transactions, err := data.ListTransactions(ctx, userID)
			if err != nil {
				if ctxErr := ctx.Err(); ctxErr != nil {
					return ToolResult{}, ctxErr
				}
				return storeError(), nil
			}

			var income, expenses int64
			filter := searchTransactionsArgs{StartDate: args.StartDate, EndDate: args.EndDate}
			for _, tx := range transactions {
				if !withinDateRange(tx.Date, filter.StartDate, filter.EndDate) {
					continue
				}
				switch tx.Type {
				case "income":
					income += tx.Amount
				case "expense":
					expenses += tx.Amount
				}
			}

			return successResult(
				"Resumen financiero del periodo",
				map[string]any{
					"incomeCents":   income,
					"expensesCents": expenses,
					"netCents":      income - expenses,
				},
			)
		},
	}
}

func matchesTransactionFilter(tx store.Transaction, args searchTransactionsArgs) bool {
	if !withinDateRange(tx.Date, args.StartDate, args.EndDate) {
		return false
	}
	if args.Type != "" && tx.Type != args.Type {
		return false
	}
	if args.AccountID != "" && tx.AccountID != args.AccountID {
		return false
	}
	if args.CategoryID != "" {
		if tx.CategoryID == nil || *tx.CategoryID != args.CategoryID {
			return false
		}
	}
	return true
}

func withinDateRange(date, start, end string) bool {
	if start != "" && date < start {
		return false
	}
	if end != "" && date > end {
		return false
	}
	return true
}

func validateOptionalDate(value string) error {
	if value == "" {
		return nil
	}
	if _, err := time.Parse("2006-01-02", value); err != nil {
		return fmt.Errorf("invalid date %q", value)
	}
	return nil
}
