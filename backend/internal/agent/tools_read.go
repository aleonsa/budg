package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
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
	ListBudgets(ctx context.Context, userID string) ([]store.Budget, error)
	ListSavingsGoals(ctx context.Context, userID string) ([]store.SavingsGoal, error)
	ListRecurringTransactions(ctx context.Context, userID string) ([]store.RecurringTransaction, error)
	ListMSIPurchases(ctx context.Context, userID string) ([]store.MSIPurchase, error)
	ListYieldReconciliations(ctx context.Context, userID string) ([]store.YieldReconciliation, error)
}

// NewReadOnlyToolRegistry builds the registry of read tools bound to a single
// authenticated user. The userID always comes from the verified JWT and is
// captured in closures so the model can never supply or override it.
func NewReadOnlyToolRegistry(data ReadStore, userID, currentDate string) (*ToolRegistry, error) {
	registry := NewToolRegistry()
	if err := RegisterReadOnlyTools(registry, data, userID, currentDate); err != nil {
		return nil, err
	}
	return registry, nil
}

// RegisterReadOnlyTools adds the read-only tools to an existing registry,
// letting a caller combine them with mutation tools (see
// RegisterMutationTools) in one shared registry instead of needing two
// separate ones.
func RegisterReadOnlyTools(registry *ToolRegistry, data ReadStore, userID, currentDate string) error {
	if registry == nil {
		return errors.New("registry is required")
	}
	if data == nil {
		return errors.New("read store is required")
	}
	if userID == "" {
		return errors.New("user id is required")
	}
	if err := validateOptionalDate(currentDate); err != nil || currentDate == "" {
		return errors.New("current date must have format YYYY-MM-DD")
	}

	tools := []Tool{
		newListAccountsTool(data, userID),
		newListCategoriesTool(data, userID),
		newSearchTransactionsTool(data, userID, currentDate),
		newFinancialSummaryTool(data, userID, currentDate),
		newListBudgetsTool(data, userID, currentDate),
		newListSavingsGoalsTool(data, userID),
		newListRecurringTransactionsTool(data, userID),
		newListMSIPurchasesTool(data, userID),
		newCashFlowForecastTool(data, userID, currentDate),
		newListAccountYieldsTool(data, userID, currentDate),
	}
	for _, tool := range tools {
		if err := registry.Register(tool); err != nil {
			return err
		}
	}
	return nil
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
				"required": ["includeInactive"],
				"properties": {
					"includeInactive": {"type": ["boolean", "null"], "description": "Incluir cuentas inactivas. Usa null si no aplica."}
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
				"required": ["kind"],
				"properties": {
					"kind": {"type": ["string", "null"], "enum": ["expense", "income", null], "description": "Usa null para no filtrar por tipo."}
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

func newSearchTransactionsTool(data ReadStore, userID, currentDate string) Tool {
	return Tool{
		Definition: ToolDefinition{
			Name:        "search_transactions",
			Description: "Busca movimientos del usuario por rango de fechas, tipo, cuenta o categoría. Devuelve total y lista acotada, ordenada de fecha más reciente a más antigua.",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"additionalProperties": false,
				"required": ["startDate", "endDate", "type", "accountId", "categoryId", "limit"],
				"properties": {
					"startDate": {"type": ["string", "null"], "description": "Fecha inicial YYYY-MM-DD. null para no acotar."},
					"endDate": {"type": ["string", "null"], "description": "Fecha final YYYY-MM-DD. null usa la fecha actual; especifica una fecha posterior solo si el usuario pide movimientos futuros."},
					"type": {"type": ["string", "null"], "enum": ["expense", "income", "transfer", null], "description": "null para no filtrar por tipo."},
					"accountId": {"type": ["string", "null"], "description": "null para no filtrar por cuenta."},
					"categoryId": {"type": ["string", "null"], "description": "null para no filtrar por categoría."},
					"limit": {"type": ["integer", "null"], "minimum": 1, "maximum": 50, "description": "null usa el límite por defecto."}
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
			if args.EndDate == "" {
				args.EndDate = currentDate
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
			filtered := make([]store.Transaction, 0)
			for _, tx := range transactions {
				if !matchesTransactionFilter(tx, args) {
					continue
				}
				total += tx.Amount
				filtered = append(filtered, tx)
			}
			sort.Slice(filtered, func(i, j int) bool {
				if filtered[i].Date != filtered[j].Date {
					return filtered[i].Date > filtered[j].Date
				}
				return filtered[i].ID > filtered[j].ID
			})

			resultCount := min(len(filtered), limit)
			views := make([]transactionView, 0, resultCount)
			for _, tx := range filtered[:resultCount] {
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

func newFinancialSummaryTool(data ReadStore, userID, currentDate string) Tool {
	return Tool{
		Definition: ToolDefinition{
			Name:        "get_financial_summary",
			Description: "Resume ingresos, gastos y ahorro neto del usuario en un rango de fechas.",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"additionalProperties": false,
				"required": ["startDate", "endDate"],
				"properties": {
					"startDate": {"type": ["string", "null"], "description": "Fecha inicial YYYY-MM-DD. null para no acotar."},
					"endDate": {"type": ["string", "null"], "description": "Fecha final YYYY-MM-DD. null usa la fecha actual; especifica una fecha posterior solo si el usuario pide una proyección futura."}
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
			if args.EndDate == "" {
				args.EndDate = currentDate
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

type budgetView struct {
	ID             string  `json:"id"`
	CategoryID     *string `json:"categoryId"`
	CategoryName   string  `json:"categoryName"`
	AmountCents    int64   `json:"amountCents"`
	Period         string  `json:"period"`
	StartDate      string  `json:"startDate"`
	WindowStart    string  `json:"windowStart"`
	WindowEnd      string  `json:"windowEnd"`
	SpentCents     int64   `json:"spentCents"`
	RemainingCents int64   `json:"remainingCents"`
}

func newListBudgetsTool(data ReadStore, userID, currentDate string) Tool {
	return Tool{
		Definition: ToolDefinition{
			Name:        "list_budgets",
			Description: "Lista los presupuestos del usuario con el progreso del ciclo actual: monto, gastado y restante en la ventana vigente (anclada en la fecha de inicio del presupuesto). categoryId null significa presupuesto global (todos los gastos).",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"additionalProperties": false,
				"properties": {}
			}`),
		},
		Handler: func(ctx context.Context, raw json.RawMessage) (ToolResult, error) {
			budgets, err := data.ListBudgets(ctx, userID)
			if err != nil {
				if ctxErr := ctx.Err(); ctxErr != nil {
					return ToolResult{}, ctxErr
				}
				return storeError(), nil
			}
			categories, err := data.ListCategories(ctx, userID)
			if err != nil {
				if ctxErr := ctx.Err(); ctxErr != nil {
					return ToolResult{}, ctxErr
				}
				return storeError(), nil
			}
			transactions, err := data.ListTransactions(ctx, userID)
			if err != nil {
				if ctxErr := ctx.Err(); ctxErr != nil {
					return ToolResult{}, ctxErr
				}
				return storeError(), nil
			}

			categoryNames := make(map[string]string, len(categories))
			for _, category := range categories {
				categoryNames[category.ID] = category.Name
			}

			views := make([]budgetView, 0, len(budgets))
			for _, budget := range budgets {
				start, end := budgetCycleWindow(budget.Period, budget.StartDate, currentDate)
				var spent int64
				for _, tx := range transactions {
					if tx.Type != "expense" || !withinDateRange(tx.Date, start, end) {
						continue
					}
					if budget.CategoryID != nil {
						if tx.CategoryID == nil || *tx.CategoryID != *budget.CategoryID {
							continue
						}
					}
					spent += tx.Amount
				}
				name := "Global"
				if budget.CategoryID != nil {
					if resolved, ok := categoryNames[*budget.CategoryID]; ok {
						name = resolved
					} else {
						name = *budget.CategoryID
					}
				}
				views = append(views, budgetView{
					ID:             budget.ID,
					CategoryID:     budget.CategoryID,
					CategoryName:   name,
					AmountCents:    budget.Amount,
					Period:         budget.Period,
					StartDate:      budget.StartDate,
					WindowStart:    start,
					WindowEnd:      end,
					SpentCents:     spent,
					RemainingCents: budget.Amount - spent,
				})
			}
			return successResult(
				fmt.Sprintf("%d presupuesto(s)", len(views)),
				map[string]any{"budgets": views},
			)
		},
	}
}

// budgetCycleWindow returns the cycle window [start, end] (inclusive, YYYY-MM-DD)
// that contains currentDate for a budget anchored at anchorDate repeating by
// period (weekly, monthly, or yearly). Monthly and yearly anchors keep their
// day-of-month clamped on shorter months (Jan 31 -> Feb 28). A future anchor
// yields its first cycle.
func budgetCycleWindow(period, anchorDate, currentDate string) (string, string) {
	const layout = "2006-01-02"
	anchor, err := time.Parse(layout, anchorDate)
	if err != nil {
		return anchorDate, anchorDate
	}
	current, err := time.Parse(layout, currentDate)
	if err != nil {
		return anchorDate, anchorDate
	}

	windowStart := anchor
	var next time.Time
	for k := 1; ; k++ {
		switch period {
		case "weekly":
			next = anchor.AddDate(0, 0, 7*k)
		case "yearly":
			next = addMonthsClamped(anchor, 12*k)
		default: // monthly and anything unexpected default to one month
			next = addMonthsClamped(anchor, k)
		}
		if next.After(current) {
			break
		}
		windowStart = next
	}
	// The candidate that overshot current is the cycle right after
	// windowStart, so its eve closes the window.
	windowEnd := next.AddDate(0, 0, -1)
	return windowStart.Format(layout), windowEnd.Format(layout)
}

// addMonthsClamped advances by whole months keeping the day-of-month when the
// target month is shorter (Jan 31 + 1 month = Feb 28). It always advances the
// original date, never a previously clamped one, so short months never drift
// the anchor day (Jan 31 -> Feb 28 -> Mar 31, not Mar 28).
func addMonthsClamped(start time.Time, months int) time.Time {
	year, month, day := start.Date()
	total := int(month) - 1 + months
	targetYear := year + total/12
	targetMonth := time.Month(total%12 + 1)
	if day > daysInMonth(targetYear, targetMonth) {
		day = daysInMonth(targetYear, targetMonth)
	}
	return time.Date(targetYear, targetMonth, day, 0, 0, 0, 0, time.UTC)
}

func daysInMonth(year int, month time.Month) int {
	return time.Date(year, month+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

type savingsGoalView struct {
	ID                 string  `json:"id"`
	Name               string  `json:"name"`
	TargetAmountCents  int64   `json:"targetAmountCents"`
	CurrentAmountCents int64   `json:"currentAmountCents"`
	RemainingCents     int64   `json:"remainingCents"`
	ProgressPercent    int64   `json:"progressPercent"`
	TargetDate         *string `json:"targetDate"`
	AccountID          *string `json:"accountId"`
	IsCompleted        bool    `json:"isCompleted"`
	SortOrder          int     `json:"order"`
}

type listSavingsGoalsArgs struct {
	IncludeCompleted bool `json:"includeCompleted"`
}

func newListSavingsGoalsTool(data ReadStore, userID string) Tool {
	return Tool{
		Definition: ToolDefinition{
			Name:        "list_savings_goals",
			Description: "Lista las metas de ahorro del usuario con progreso (ahorrado, restante y porcentaje). Por defecto omite las metas completadas.",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"additionalProperties": false,
				"required": ["includeCompleted"],
				"properties": {
					"includeCompleted": {"type": ["boolean", "null"], "description": "Incluir metas ya completadas. Usa null si no aplica."}
				}
			}`),
		},
		Handler: func(ctx context.Context, raw json.RawMessage) (ToolResult, error) {
			args, bad := decodeToolArgs[listSavingsGoalsArgs](raw)
			if bad != nil {
				return *bad, nil
			}
			goals, err := data.ListSavingsGoals(ctx, userID)
			if err != nil {
				if ctxErr := ctx.Err(); ctxErr != nil {
					return ToolResult{}, ctxErr
				}
				return storeError(), nil
			}

			views := make([]savingsGoalView, 0, len(goals))
			for _, goal := range goals {
				if goal.IsCompleted && !args.IncludeCompleted {
					continue
				}
				remaining := goal.TargetAmount - goal.CurrentAmount
				if remaining < 0 {
					remaining = 0
				}
				var progress int64
				if goal.TargetAmount > 0 {
					progress = goal.CurrentAmount * 100 / goal.TargetAmount
				}
				views = append(views, savingsGoalView{
					ID:                 goal.ID,
					Name:               goal.Name,
					TargetAmountCents:  goal.TargetAmount,
					CurrentAmountCents: goal.CurrentAmount,
					RemainingCents:     remaining,
					ProgressPercent:    progress,
					TargetDate:         goal.TargetDate,
					AccountID:          goal.AccountID,
					IsCompleted:        goal.IsCompleted,
					SortOrder:          goal.SortOrder,
				})
			}
			return successResult(
				fmt.Sprintf("%d meta(s)", len(views)),
				map[string]any{"savingsGoals": views},
			)
		},
	}
}

type recurringTransactionView struct {
	ID          string  `json:"id"`
	Description string  `json:"description"`
	Merchant    *string `json:"merchant"`
	AmountCents int64   `json:"amountCents"`
	Frequency   string  `json:"frequency"`
	StartDate   string  `json:"startDate"`
	NextDate    string  `json:"nextDate"`
	AccountID   string  `json:"accountId"`
	CategoryID  *string `json:"categoryId"`
	IsActive    bool    `json:"isActive"`
}

type listRecurringTransactionsArgs struct {
	IncludeInactive bool `json:"includeInactive"`
}

func newListRecurringTransactionsTool(data ReadStore, userID string) Tool {
	return Tool{
		Definition: ToolDefinition{
			Name:        "list_recurring_transactions",
			Description: "Lista las transacciones recurrentes del usuario (suscripciones, rentas, nómina) con la próxima fecha de aplicación. Por defecto solo activas.",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"additionalProperties": false,
				"required": ["includeInactive"],
				"properties": {
					"includeInactive": {"type": ["boolean", "null"], "description": "Incluir recurrentes inactivas. Usa null si no aplica."}
				}
			}`),
		},
		Handler: func(ctx context.Context, raw json.RawMessage) (ToolResult, error) {
			args, bad := decodeToolArgs[listRecurringTransactionsArgs](raw)
			if bad != nil {
				return *bad, nil
			}
			recurring, err := data.ListRecurringTransactions(ctx, userID)
			if err != nil {
				if ctxErr := ctx.Err(); ctxErr != nil {
					return ToolResult{}, ctxErr
				}
				return storeError(), nil
			}

			views := make([]recurringTransactionView, 0, len(recurring))
			var monthlyOutflow int64
			for _, item := range recurring {
				if !item.IsActive && !args.IncludeInactive {
					continue
				}
				views = append(views, recurringTransactionView{
					ID:          item.ID,
					Description: item.Description,
					Merchant:    item.Merchant,
					AmountCents: item.Amount,
					Frequency:   item.Frequency,
					StartDate:   item.StartDate,
					NextDate:    item.NextDate,
					AccountID:   item.AccountID,
					CategoryID:  item.CategoryID,
					IsActive:    item.IsActive,
				})
				if item.IsActive && item.Amount > 0 {
					monthlyOutflow += recurringMonthlyAmount(item.Frequency, item.Amount)
				}
			}
			return successResult(
				fmt.Sprintf("%d recurrente(s)", len(views)),
				map[string]any{
					"recurringTransactions":     views,
					"monthlyOutflowCentsApprox": monthlyOutflow,
				},
			)
		},
	}
}

// recurringMonthlyAmount normalizes a recurring amount to an approximate
// monthly figure for the monthly-outflow aggregate. The store only accepts
// monthly and yearly frequencies.
func recurringMonthlyAmount(frequency string, amount int64) int64 {
	if frequency == "yearly" {
		return amount / 12
	}
	return amount
}

type msiPurchaseView struct {
	ID                     string  `json:"id"`
	Description            string  `json:"description"`
	Merchant               *string `json:"merchant"`
	AccountID              string  `json:"accountId"`
	CategoryID             *string `json:"categoryId"`
	TotalAmountCents       int64   `json:"totalAmountCents"`
	InstallmentAmountCents int64   `json:"installmentAmountCents"`
	InstallmentCount       int     `json:"installmentCount"`
	InstallmentsPaid       int     `json:"installmentsPaid"`
	StartDate              string  `json:"startDate"`
	InstallmentsRemaining  int     `json:"installmentsRemaining"`
	NextInstallmentDate    *string `json:"nextInstallmentDate"`
	Status                 string  `json:"status"`
}

type listMSIPurchasesArgs struct {
	Status string `json:"status"`
}

func newListMSIPurchasesTool(data ReadStore, userID string) Tool {
	return Tool{
		Definition: ToolDefinition{
			Name:        "list_msi_purchases",
			Description: "Lista las compras a meses sin intereses del usuario: cuotas pagadas, cuotas restantes, próximo pago y deuda total restante. Filtra opcionalmente por estado.",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"additionalProperties": false,
				"required": ["status"],
				"properties": {
					"status": {"type": ["string", "null"], "enum": ["active", "completed", null], "description": "null para listar todas."}
				}
			}`),
		},
		Handler: func(ctx context.Context, raw json.RawMessage) (ToolResult, error) {
			args, bad := decodeToolArgs[listMSIPurchasesArgs](raw)
			if bad != nil {
				return *bad, nil
			}
			purchases, err := data.ListMSIPurchases(ctx, userID)
			if err != nil {
				if ctxErr := ctx.Err(); ctxErr != nil {
					return ToolResult{}, ctxErr
				}
				return storeError(), nil
			}

			views := make([]msiPurchaseView, 0, len(purchases))
			var totalRemaining int64
			var monthlyBurden int64
			for _, purchase := range purchases {
				if args.Status != "" && purchase.Status != args.Status {
					continue
				}
				remaining := purchase.InstallmentCount - purchase.InstallmentsPaid
				if remaining < 0 {
					remaining = 0
				}
				if purchase.Status == "active" {
					totalRemaining += int64(remaining) * purchase.InstallmentAmount
					monthlyBurden += purchase.InstallmentAmount
				}
				views = append(views, msiPurchaseView{
					ID:                     purchase.ID,
					Description:            purchase.Description,
					Merchant:               purchase.Merchant,
					AccountID:              purchase.AccountID,
					CategoryID:             purchase.CategoryID,
					TotalAmountCents:       purchase.TotalAmount,
					InstallmentAmountCents: purchase.InstallmentAmount,
					InstallmentCount:       purchase.InstallmentCount,
					InstallmentsPaid:       purchase.InstallmentsPaid,
					StartDate:              purchase.StartDate,
					InstallmentsRemaining:  remaining,
					NextInstallmentDate:    purchase.NextInstallmentDate,
					Status:                 purchase.Status,
				})
			}
			return successResult(
				fmt.Sprintf("%d compra(s) a meses sin intereses", len(views)),
				map[string]any{
					"msiPurchases":             views,
					"activeDebtRemainingCents": totalRemaining,
					"activeMonthlyBurdenCents": monthlyBurden,
				},
			)
		},
	}
}

type cashFlowForecastArgs struct {
	DaysAhead int `json:"daysAhead"`
}

type scheduledForecastPayment struct {
	Date                       string  `json:"date"`
	Type                       string  `json:"type"`
	Description                string  `json:"description"`
	Merchant                   *string `json:"merchant"`
	AmountCents                int64   `json:"amountCents"`
	AccountID                  string  `json:"accountId"`
	ProjectedBalanceAfterCents int64   `json:"projectedBalanceAfterCents"`
}

type scheduledMSIInstallment struct {
	date              string
	installmentNumber int
}

func newCashFlowForecastTool(data ReadStore, userID, currentDate string) Tool {
	return Tool{
		Definition: ToolDefinition{
			Name:        "get_cash_flow_forecast",
			Description: "Proyecta el flujo de caja y liquidez del usuario a 30, 60 o 90 días considerando saldos en débito y compromisos programados (gastos recurrentes y cuotas MSI). Identifica el punto de saldo mínimo y si existe riesgo de liquidez.",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"additionalProperties": false,
				"required": ["daysAhead"],
				"properties": {
					"daysAhead": {
						"type": "integer",
						"enum": [30, 60, 90],
						"description": "Horizonte de proyección en días (30, 60 o 90)"
					}
				}
			}`),
		},
		Handler: func(ctx context.Context, raw json.RawMessage) (ToolResult, error) {
			args, bad := decodeToolArgs[cashFlowForecastArgs](raw)
			if bad != nil {
				return *bad, nil
			}
			if args.DaysAhead != 30 && args.DaysAhead != 60 && args.DaysAhead != 90 {
				return errorResult("daysAhead debe ser 30, 60 o 90.", false), nil
			}

			accounts, err := data.ListAccounts(ctx, userID)
			if err != nil {
				if ctxErr := ctx.Err(); ctxErr != nil {
					return ToolResult{}, ctxErr
				}
				return storeError(), nil
			}
			recurring, err := data.ListRecurringTransactions(ctx, userID)
			if err != nil {
				if ctxErr := ctx.Err(); ctxErr != nil {
					return ToolResult{}, ctxErr
				}
				return storeError(), nil
			}
			msi, err := data.ListMSIPurchases(ctx, userID)
			if err != nil {
				if ctxErr := ctx.Err(); ctxErr != nil {
					return ToolResult{}, ctxErr
				}
				return storeError(), nil
			}

			var startingLiquidBalance int64
			for _, acc := range accounts {
				if acc.IsActive && acc.Type == "debit" && acc.BalanceCents != nil {
					startingLiquidBalance += *acc.BalanceCents
				}
			}

			const layout = "2006-01-02"
			currTime, err := time.Parse(layout, currentDate)
			if err != nil {
				return errorResult("currentDate inválida", false), nil
			}
			endDate := currTime.AddDate(0, 0, args.DaysAhead).Format(layout)

			type rawPayment struct {
				date        string
				kind        string
				description string
				merchant    *string
				amount      int64
				accountID   string
			}
			var rawList []rawPayment

			var totalRecurringOutflow int64
			for _, rec := range recurring {
				if !rec.IsActive || rec.Amount <= 0 {
					continue
				}
				dates := projectRecurringDates(rec.StartDate, rec.NextDate, rec.Frequency, currentDate, endDate)
				for _, d := range dates {
					rawList = append(rawList, rawPayment{
						date:        d,
						kind:        "recurring",
						description: rec.Description,
						merchant:    rec.Merchant,
						amount:      rec.Amount,
						accountID:   rec.AccountID,
					})
					totalRecurringOutflow += rec.Amount
				}
			}

			var totalMSIOutflow int64
			for _, p := range msi {
				if p.Status != "active" {
					continue
				}
				nextDate := ""
				if p.NextInstallmentDate != nil {
					nextDate = *p.NextInstallmentDate
				}
				installments := projectMSIInstallmentDates(p.StartDate, nextDate, p.InstallmentCount, p.InstallmentsPaid, currentDate, endDate)
				for _, inst := range installments {
					desc := fmt.Sprintf("%s (%d/%d)", p.Description, inst.installmentNumber, p.InstallmentCount)
					rawList = append(rawList, rawPayment{
						date:        inst.date,
						kind:        "msi",
						description: desc,
						merchant:    p.Merchant,
						amount:      p.InstallmentAmount,
						accountID:   p.AccountID,
					})
					totalMSIOutflow += p.InstallmentAmount
				}
			}

			sort.SliceStable(rawList, func(i, j int) bool {
				return rawList[i].date < rawList[j].date
			})

			runningBalance := startingLiquidBalance
			minBalance := startingLiquidBalance
			minBalanceDate := currentDate

			payments := make([]scheduledForecastPayment, 0, len(rawList))
			for _, item := range rawList {
				runningBalance -= item.amount
				if runningBalance < minBalance {
					minBalance = runningBalance
					minBalanceDate = item.date
				}
				payments = append(payments, scheduledForecastPayment{
					Date:                       item.date,
					Type:                       item.kind,
					Description:                item.description,
					Merchant:                   item.merchant,
					AmountCents:                item.amount,
					AccountID:                  item.accountID,
					ProjectedBalanceAfterCents: runningBalance,
				})
			}

			var expectedYield int64
			for _, acc := range accounts {
				if acc.IsActive && acc.Type == "debit" && acc.BalanceCents != nil {
					expectedYield += store.EstimateYieldCentsTiered(
						*acc.BalanceCents, acc.AnnualYieldBps, acc.AnnualYieldTiers, args.DaysAhead)
				}
			}

			totalScheduledOutflow := totalRecurringOutflow + totalMSIOutflow
			isRisk := minBalance < 0 || startingLiquidBalance < 0

			summary := fmt.Sprintf("Proyección a %d días: saldo final %d centavos, mínimo %d centavos (el %s), %d pagos programados",
				args.DaysAhead, runningBalance, minBalance, minBalanceDate, len(payments))

			return successResult(summary, map[string]any{
				"startingLiquidBalanceCents":     startingLiquidBalance,
				"horizonDays":                    args.DaysAhead,
				"endDate":                        endDate,
				"projectedBalanceCents":          runningBalance,
				"minBalanceCents":                minBalance,
				"minBalanceDate":                 minBalanceDate,
				"isLiquidityRisk":                isRisk,
				"totalRecurringOutflowCents":     totalRecurringOutflow,
				"totalMSIOutflowCents":           totalMSIOutflow,
				"totalScheduledOutflowCents":     totalScheduledOutflow,
				"expectedYieldCents":             expectedYield,
				"projectedBalanceWithYieldCents": runningBalance + expectedYield,
				"scheduledPaymentsCount":         len(payments),
				"upcomingPayments":               payments,
			})
		},
	}
}

func projectRecurringDates(startDate, nextDate, frequency, fromDate, toDate string) []string {
	const layout = "2006-01-02"
	start, err := time.Parse(layout, startDate)
	if err != nil {
		return nil
	}
	cursorDate := nextDate
	if cursorDate == "" {
		cursorDate = startDate
	}
	cursor, err := time.Parse(layout, cursorDate)
	if err != nil {
		return nil
	}
	from, err := time.Parse(layout, fromDate)
	if err != nil {
		return nil
	}
	to, err := time.Parse(layout, toDate)
	if err != nil {
		return nil
	}

	intervalMonths := 1
	if frequency == "yearly" {
		intervalMonths = 12
	}

	if cursor.Before(from) {
		k := 0
		for cursor.Before(from) && k < 1200 {
			k++
			cursor = addMonthsClamped(start, k*intervalMonths)
		}
	}

	var dates []string
	guard := 0
	for !cursor.After(to) && guard < 120 {
		if !cursor.Before(from) {
			dates = append(dates, cursor.Format(layout))
		}
		cursor = addMonthsClamped(cursor, intervalMonths)
		guard++
	}
	return dates
}

func projectMSIInstallmentDates(startDate, nextDate string, count, paid int, fromDate, toDate string) []scheduledMSIInstallment {
	const layout = "2006-01-02"
	remaining := count - paid
	if remaining <= 0 {
		return nil
	}
	baseDateStr := nextDate
	if baseDateStr == "" {
		baseDateStr = startDate
	}
	baseDate, err := time.Parse(layout, baseDateStr)
	if err != nil {
		return nil
	}
	from, err := time.Parse(layout, fromDate)
	if err != nil {
		return nil
	}
	to, err := time.Parse(layout, toDate)
	if err != nil {
		return nil
	}

	var result []scheduledMSIInstallment
	for i := 0; i < remaining; i++ {
		installmentDate := addMonthsClamped(baseDate, i)
		if !installmentDate.Before(from) && !installmentDate.After(to) {
			result = append(result, scheduledMSIInstallment{
				date:              installmentDate.Format(layout),
				installmentNumber: paid + i + 1,
			})
		}
	}
	return result
}
