package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/aleonsa/budg/backend/internal/store"
)

const (
	maxResourceNameLength        = 120
	maxResourceDescriptionLength = 240
	maxMerchantLength            = 120
)

func confirmedMutation(
	ctx context.Context,
	confirmer *Confirmer,
	userID, toolName string,
	raw json.RawMessage,
	summary string,
	proposal any,
	execute func() (ToolResult, error),
) (ToolResult, error) {
	if token := ConfirmationTokenFromContext(ctx); token != "" {
		if err := confirmer.Verify(token, userID, toolName, raw); err == nil {
			return execute()
		}
	}
	token, expiresAt, err := confirmer.Issue(userID, toolName, raw)
	if err != nil {
		return ToolResult{}, fmt.Errorf("issue confirmation token: %w", err)
	}
	return proposalResult(summary, proposal, token, expiresAt)
}

func validateRequiredText(field, value string, maxLength int) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return field + " es requerido."
	}
	if len([]rune(trimmed)) > maxLength {
		return fmt.Sprintf("%s no puede exceder %d caracteres.", field, maxLength)
	}
	return ""
}

func validateOptionalText(field string, value *string, maxLength int) string {
	if value == nil {
		return ""
	}
	if strings.TrimSpace(*value) == "" {
		return field + " no puede quedar vacío."
	}
	if len([]rune(strings.TrimSpace(*value))) > maxLength {
		return fmt.Sprintf("%s no puede exceder %d caracteres.", field, maxLength)
	}
	return ""
}

func lookupAccount(ctx context.Context, data Store, userID, id string) (store.Account, bool, error) {
	accounts, err := data.ListAccounts(ctx, userID)
	if err != nil {
		return store.Account{}, false, err
	}
	account, ok := findAccountByID(accounts, id)
	return account, ok, nil
}

func lookupCategory(ctx context.Context, data Store, userID string, id *string) (store.Category, bool, error) {
	if id == nil {
		return store.Category{}, true, nil
	}
	categories, err := data.ListCategories(ctx, userID)
	if err != nil {
		return store.Category{}, false, err
	}
	category, ok := findCategoryByID(categories, *id)
	return category, ok, nil
}

func resourceLookupError(ctx context.Context, err error) (ToolResult, error) {
	if ctxErr := ctx.Err(); ctxErr != nil {
		return ToolResult{}, ctxErr
	}
	if err != nil {
		return storeError(), nil
	}
	return ToolResult{}, nil
}

func resourceMutationError(ctx context.Context, err error) (ToolResult, error) {
	if ctxErr := ctx.Err(); ctxErr != nil {
		return ToolResult{}, ctxErr
	}
	return mutationStoreError(err), nil
}

func findBudgetByID(items []store.Budget, id string) (store.Budget, bool) {
	for _, item := range items {
		if item.ID == id {
			return item, true
		}
	}
	return store.Budget{}, false
}

func findSavingsGoalByID(items []store.SavingsGoal, id string) (store.SavingsGoal, bool) {
	for _, item := range items {
		if item.ID == id {
			return item, true
		}
	}
	return store.SavingsGoal{}, false
}

func findRecurringByID(items []store.RecurringTransaction, id string) (store.RecurringTransaction, bool) {
	for _, item := range items {
		if item.ID == id {
			return item, true
		}
	}
	return store.RecurringTransaction{}, false
}

func findMSIPurchaseByID(items []store.MSIPurchase, id string) (store.MSIPurchase, bool) {
	for _, item := range items {
		if item.ID == id {
			return item, true
		}
	}
	return store.MSIPurchase{}, false
}

// --- budgets ---

type createBudgetArgs struct {
	CategoryID  *string `json:"categoryId"`
	AmountCents int64   `json:"amountCents"`
	Period      string  `json:"period"`
	StartDate   string  `json:"startDate"`
}

type updateBudgetArgs struct {
	BudgetID    string  `json:"budgetId"`
	CategoryID  *string `json:"categoryId"`
	AmountCents int64   `json:"amountCents"`
	Period      string  `json:"period"`
	StartDate   string  `json:"startDate"`
}

type deleteBudgetArgs struct {
	BudgetID string `json:"budgetId"`
}

func validateBudgetMutation(categoryID *string, amount int64, period, startDate string) string {
	if categoryID != nil && strings.TrimSpace(*categoryID) == "" {
		return "categoryId no puede quedar vacío; usa null para un presupuesto general."
	}
	if amount <= 0 {
		return "amountCents debe ser mayor a cero."
	}
	if period != "weekly" && period != "monthly" && period != "yearly" {
		return "period debe ser weekly, monthly o yearly."
	}
	if err := validateOptionalDate(startDate); err != nil || startDate == "" {
		return "startDate debe ser una fecha válida YYYY-MM-DD."
	}
	return ""
}

func budgetCategoryProposal(category store.Category, categoryID *string) map[string]any {
	if categoryID == nil {
		return map[string]any{"categoryId": nil, "categoryName": "General"}
	}
	return map[string]any{"categoryId": *categoryID, "categoryName": category.Name}
}

func newCreateBudgetTool(data Store, confirmer *Confirmer, userID string) Tool {
	const toolName = "create_budget"
	return Tool{
		Definition: ToolDefinition{
			Name:        toolName,
			Description: "Crea un presupuesto semanal, mensual o anual. categoryId null crea uno general. Requiere confirmación explícita.",
			InputSchema: json.RawMessage(`{
				"type":"object","additionalProperties":false,
				"required":["categoryId","amountCents","period","startDate"],
				"properties":{
					"categoryId":{"type":["string","null"],"description":"ID de categoría de gasto resuelto con list_categories; null para presupuesto general"},
					"amountCents":{"type":"integer","minimum":1},
					"period":{"type":"string","enum":["weekly","monthly","yearly"]},
					"startDate":{"type":"string","description":"Fecha válida YYYY-MM-DD"}
				}
			}`),
		},
		Handler: func(ctx context.Context, raw json.RawMessage) (ToolResult, error) {
			args, bad := decodeToolArgs[createBudgetArgs](raw)
			if bad != nil {
				return *bad, nil
			}
			if msg := validateBudgetMutation(args.CategoryID, args.AmountCents, args.Period, args.StartDate); msg != "" {
				return errorResult(msg, false), nil
			}
			category, ok, err := lookupCategory(ctx, data, userID, args.CategoryID)
			if err != nil {
				return resourceLookupError(ctx, err)
			}
			if !ok || (args.CategoryID != nil && category.Kind != "expense") {
				return errorResult("La categoría de gasto indicada no existe o no pertenece al usuario.", false), nil
			}
			proposal := budgetCategoryProposal(category, args.CategoryID)
			proposal["amountCents"] = args.AmountCents
			proposal["period"] = args.Period
			proposal["startDate"] = args.StartDate
			return confirmedMutation(ctx, confirmer, userID, toolName, raw,
				"Creación de presupuesto pendiente de confirmación.", proposal,
				func() (ToolResult, error) {
					key := stableIdempotencyKey(ConfirmationTokenFromContext(ctx))
					created, err := data.CreateBudget(ctx, userID, store.BudgetInput{
						CategoryID: args.CategoryID, Amount: args.AmountCents, Period: args.Period, StartDate: args.StartDate,
						IdempotencyKey: &key,
					})
					if err != nil {
						if result, resultErr, ok := idempotentDeletedReplayResult(err, "El presupuesto ya se había creado y después fue eliminado; no se recreó.", "budgetId"); ok {
							return result, resultErr
						}
						return resourceMutationError(ctx, err)
					}
					return successResult("Presupuesto creado.", map[string]any{"executed": true, "budgetId": created.ID})
				})
		},
	}
}

func newUpdateBudgetTool(data Store, confirmer *Confirmer, userID string) Tool {
	const toolName = "update_budget"
	return Tool{
		Definition: ToolDefinition{
			Name:        toolName,
			Description: "Reemplaza categoría, monto, periodo y fecha de inicio de un presupuesto existente. Usa list_budgets para conservar campos no mencionados por el usuario. Requiere confirmación explícita.",
			InputSchema: json.RawMessage(`{
				"type":"object","additionalProperties":false,
				"required":["budgetId","categoryId","amountCents","period","startDate"],
				"properties":{
					"budgetId":{"type":"string"},
					"categoryId":{"type":["string","null"]},
					"amountCents":{"type":"integer","minimum":1},
					"period":{"type":"string","enum":["weekly","monthly","yearly"]},
					"startDate":{"type":"string"}
				}
			}`),
		},
		Handler: func(ctx context.Context, raw json.RawMessage) (ToolResult, error) {
			args, bad := decodeToolArgs[updateBudgetArgs](raw)
			if bad != nil {
				return *bad, nil
			}
			if strings.TrimSpace(args.BudgetID) == "" {
				return errorResult("budgetId es requerido.", false), nil
			}
			if msg := validateBudgetMutation(args.CategoryID, args.AmountCents, args.Period, args.StartDate); msg != "" {
				return errorResult(msg, false), nil
			}
			budgets, err := data.ListBudgets(ctx, userID)
			if err != nil {
				return resourceLookupError(ctx, err)
			}
			if _, ok := findBudgetByID(budgets, args.BudgetID); !ok {
				return errorResult("El presupuesto indicado no existe.", false), nil
			}
			category, ok, err := lookupCategory(ctx, data, userID, args.CategoryID)
			if err != nil {
				return resourceLookupError(ctx, err)
			}
			if !ok || (args.CategoryID != nil && category.Kind != "expense") {
				return errorResult("La categoría de gasto indicada no existe o no pertenece al usuario.", false), nil
			}
			proposal := budgetCategoryProposal(category, args.CategoryID)
			proposal["budgetId"] = args.BudgetID
			proposal["amountCents"] = args.AmountCents
			proposal["period"] = args.Period
			proposal["startDate"] = args.StartDate
			return confirmedMutation(ctx, confirmer, userID, toolName, raw,
				"Actualización de presupuesto pendiente de confirmación.", proposal,
				func() (ToolResult, error) {
					amount, period, startDate := args.AmountCents, args.Period, args.StartDate
					updated, err := data.UpdateBudget(ctx, userID, args.BudgetID, store.BudgetPatch{
						CategoryID: store.Field[string]{Set: true, Value: args.CategoryID},
						Amount:     &amount, Period: &period, StartDate: &startDate,
					})
					if err != nil {
						if result, resultErr, ok := idempotentDeletedReplayResult(err, "La meta ya se había creado y después fue eliminada; no se recreó.", "goalId"); ok {
							return result, resultErr
						}
						return resourceMutationError(ctx, err)
					}
					return successResult("Presupuesto actualizado.", map[string]any{"executed": true, "budgetId": updated.ID})
				})
		},
	}
}

func newDeleteBudgetTool(data Store, confirmer *Confirmer, userID string) Tool {
	const toolName = "delete_budget"
	return Tool{
		Definition: ToolDefinition{
			Name:        toolName,
			Description: "Elimina un presupuesto existente. Requiere confirmación explícita.",
			InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"required":["budgetId"],"properties":{"budgetId":{"type":"string"}}}`),
		},
		Handler: func(ctx context.Context, raw json.RawMessage) (ToolResult, error) {
			args, bad := decodeToolArgs[deleteBudgetArgs](raw)
			if bad != nil {
				return *bad, nil
			}
			budgets, err := data.ListBudgets(ctx, userID)
			if err != nil {
				return resourceLookupError(ctx, err)
			}
			existing, ok := findBudgetByID(budgets, args.BudgetID)
			if token := ConfirmationTokenFromContext(ctx); token != "" && confirmer.Verify(token, userID, toolName, raw) == nil {
				err := data.DeleteBudget(ctx, userID, args.BudgetID)
				if err != nil && !errors.Is(err, store.ErrNotFound) {
					return resourceMutationError(ctx, err)
				}
				return successResult("Presupuesto eliminado.", map[string]any{"executed": true, "budgetId": args.BudgetID})
			}
			if strings.TrimSpace(args.BudgetID) == "" || !ok {
				return errorResult("El presupuesto indicado no existe.", false), nil
			}
			return confirmedMutation(ctx, confirmer, userID, toolName, raw,
				"Eliminación de presupuesto pendiente de confirmación.",
				map[string]any{"budgetId": existing.ID, "amountCents": existing.Amount, "period": existing.Period},
				func() (ToolResult, error) { return ToolResult{}, errors.New("unreachable confirmed delete") })
		},
	}
}

// --- savings goals ---

type createSavingsGoalArgs struct {
	Name              string  `json:"name"`
	TargetAmountCents int64   `json:"targetAmountCents"`
	TargetDate        *string `json:"targetDate"`
	AccountID         *string `json:"accountId"`
	Order             int     `json:"order"`
}

type updateSavingsGoalArgs struct {
	GoalID            string  `json:"goalId"`
	Name              string  `json:"name"`
	TargetAmountCents int64   `json:"targetAmountCents"`
	TargetDate        *string `json:"targetDate"`
	AccountID         *string `json:"accountId"`
	Order             int     `json:"order"`
}

type deleteSavingsGoalArgs struct {
	GoalID string `json:"goalId"`
}

func validateSavingsGoalMutation(name string, target int64, targetDate, accountID *string, order int) string {
	if msg := validateRequiredText("name", name, maxResourceNameLength); msg != "" {
		return msg
	}
	if target <= 0 {
		return "targetAmountCents debe ser mayor a cero."
	}
	if targetDate != nil {
		if err := validateOptionalDate(*targetDate); err != nil || *targetDate == "" {
			return "targetDate debe ser null o una fecha válida YYYY-MM-DD."
		}
	}
	if accountID != nil && strings.TrimSpace(*accountID) == "" {
		return "accountId no puede quedar vacío; usa null si la meta no tiene cuenta."
	}
	if order < 0 {
		return "order no puede ser negativo."
	}
	return ""
}

func savingsGoalProposal(name string, target int64, targetDate, accountID *string, order int, accountName string) map[string]any {
	return map[string]any{
		"name": name, "targetAmountCents": target, "targetDate": targetDate,
		"accountId": accountID, "accountName": accountName, "order": order,
	}
}

func validateSavingsAccount(ctx context.Context, data Store, userID string, accountID *string, requireActive bool) (string, *ToolResult, error) {
	if accountID == nil {
		return "", nil, nil
	}
	account, ok, err := lookupAccount(ctx, data, userID, *accountID)
	if err != nil {
		result, resultErr := resourceLookupError(ctx, err)
		return "", &result, resultErr
	}
	if !ok || account.Type != "debit" || (requireActive && !account.IsActive) {
		result := errorResult("La cuenta de ahorro debe ser una cuenta de débito del usuario, activa al asignarla.", false)
		return "", &result, nil
	}
	return account.Name, nil, nil
}

func newCreateSavingsGoalTool(data Store, confirmer *Confirmer, userID string) Tool {
	const toolName = "create_savings_goal"
	return Tool{
		Definition: ToolDefinition{
			Name:        toolName,
			Description: "Crea una meta de ahorro con saldo inicial cero. Requiere confirmación explícita.",
			InputSchema: json.RawMessage(`{
				"type":"object","additionalProperties":false,
				"required":["name","targetAmountCents","targetDate","accountId","order"],
				"properties":{
					"name":{"type":"string","minLength":1,"maxLength":120},
					"targetAmountCents":{"type":"integer","minimum":1},
					"targetDate":{"type":["string","null"]},
					"accountId":{"type":["string","null"],"description":"Cuenta de débito activa resuelta con list_accounts; null si no aplica"},
					"order":{"type":"integer","minimum":0}
				}
			}`),
		},
		Handler: func(ctx context.Context, raw json.RawMessage) (ToolResult, error) {
			args, bad := decodeToolArgs[createSavingsGoalArgs](raw)
			if bad != nil {
				return *bad, nil
			}
			if msg := validateSavingsGoalMutation(args.Name, args.TargetAmountCents, args.TargetDate, args.AccountID, args.Order); msg != "" {
				return errorResult(msg, false), nil
			}
			accountName, badResult, err := validateSavingsAccount(ctx, data, userID, args.AccountID, true)
			if badResult != nil || err != nil {
				if badResult != nil {
					return *badResult, err
				}
				return ToolResult{}, err
			}
			proposal := savingsGoalProposal(args.Name, args.TargetAmountCents, args.TargetDate, args.AccountID, args.Order, accountName)
			return confirmedMutation(ctx, confirmer, userID, toolName, raw,
				"Creación de meta de ahorro pendiente de confirmación.", proposal,
				func() (ToolResult, error) {
					key := stableIdempotencyKey(ConfirmationTokenFromContext(ctx))
					created, err := data.CreateSavingsGoal(ctx, userID, store.SavingsGoalInput{
						Name: strings.TrimSpace(args.Name), TargetAmount: args.TargetAmountCents,
						CurrentAmount: 0, TargetDate: args.TargetDate, AccountID: args.AccountID, SortOrder: args.Order,
						IdempotencyKey: &key,
					})
					if err != nil {
						if result, resultErr, ok := idempotentDeletedReplayResult(err, "La meta ya se había creado y después fue eliminada; no se recreó.", "goalId"); ok {
							return result, resultErr
						}
						return resourceMutationError(ctx, err)
					}
					return successResult("Meta de ahorro creada.", map[string]any{"executed": true, "goalId": created.ID})
				})
		},
	}
}

func newUpdateSavingsGoalTool(data Store, confirmer *Confirmer, userID string) Tool {
	const toolName = "update_savings_goal"
	return Tool{
		Definition: ToolDefinition{
			Name:        toolName,
			Description: "Reemplaza nombre, objetivo, fecha, cuenta y orden de una meta. No modifica el saldo ahorrado. Usa list_savings_goals para conservar campos no mencionados. Requiere confirmación explícita.",
			InputSchema: json.RawMessage(`{
				"type":"object","additionalProperties":false,
				"required":["goalId","name","targetAmountCents","targetDate","accountId","order"],
				"properties":{
					"goalId":{"type":"string"},"name":{"type":"string","minLength":1,"maxLength":120},
					"targetAmountCents":{"type":"integer","minimum":1},"targetDate":{"type":["string","null"]},
					"accountId":{"type":["string","null"]},"order":{"type":"integer","minimum":0}
				}
			}`),
		},
		Handler: func(ctx context.Context, raw json.RawMessage) (ToolResult, error) {
			args, bad := decodeToolArgs[updateSavingsGoalArgs](raw)
			if bad != nil {
				return *bad, nil
			}
			if strings.TrimSpace(args.GoalID) == "" {
				return errorResult("goalId es requerido.", false), nil
			}
			if msg := validateSavingsGoalMutation(args.Name, args.TargetAmountCents, args.TargetDate, args.AccountID, args.Order); msg != "" {
				return errorResult(msg, false), nil
			}
			goals, err := data.ListSavingsGoals(ctx, userID)
			if err != nil {
				return resourceLookupError(ctx, err)
			}
			existing, ok := findSavingsGoalByID(goals, args.GoalID)
			if !ok {
				return errorResult("La meta de ahorro indicada no existe.", false), nil
			}
			accountChanged := !equalOptionalID(existing.AccountID, args.AccountID)
			accountName, badResult, err := validateSavingsAccount(ctx, data, userID, args.AccountID, accountChanged)
			if badResult != nil || err != nil {
				if badResult != nil {
					return *badResult, err
				}
				return ToolResult{}, err
			}
			proposal := savingsGoalProposal(args.Name, args.TargetAmountCents, args.TargetDate, args.AccountID, args.Order, accountName)
			proposal["goalId"] = args.GoalID
			return confirmedMutation(ctx, confirmer, userID, toolName, raw,
				"Actualización de meta de ahorro pendiente de confirmación.", proposal,
				func() (ToolResult, error) {
					name, target, order := strings.TrimSpace(args.Name), args.TargetAmountCents, args.Order
					updated, err := data.UpdateSavingsGoal(ctx, userID, args.GoalID, store.SavingsGoalPatch{
						Name: &name, TargetAmount: &target,
						TargetDate: store.Field[string]{Set: true, Value: args.TargetDate},
						AccountID:  store.Field[string]{Set: true, Value: args.AccountID}, SortOrder: &order,
					})
					if err != nil {
						return resourceMutationError(ctx, err)
					}
					return successResult("Meta de ahorro actualizada.", map[string]any{"executed": true, "goalId": updated.ID})
				})
		},
	}
}

func equalOptionalID(first, second *string) bool {
	return first == nil && second == nil || first != nil && second != nil && *first == *second
}

func newDeleteSavingsGoalTool(data Store, confirmer *Confirmer, userID string) Tool {
	const toolName = "delete_savings_goal"
	return Tool{
		Definition: ToolDefinition{Name: toolName, Description: "Elimina una meta de ahorro. Requiere confirmación explícita.", InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"required":["goalId"],"properties":{"goalId":{"type":"string"}}}`)},
		Handler: func(ctx context.Context, raw json.RawMessage) (ToolResult, error) {
			args, bad := decodeToolArgs[deleteSavingsGoalArgs](raw)
			if bad != nil {
				return *bad, nil
			}
			goals, err := data.ListSavingsGoals(ctx, userID)
			if err != nil {
				return resourceLookupError(ctx, err)
			}
			existing, ok := findSavingsGoalByID(goals, args.GoalID)
			if token := ConfirmationTokenFromContext(ctx); token != "" && confirmer.Verify(token, userID, toolName, raw) == nil {
				err := data.DeleteSavingsGoal(ctx, userID, args.GoalID)
				if err != nil && !errors.Is(err, store.ErrNotFound) {
					return resourceMutationError(ctx, err)
				}
				return successResult("Meta de ahorro eliminada.", map[string]any{"executed": true, "goalId": args.GoalID})
			}
			if strings.TrimSpace(args.GoalID) == "" || !ok {
				return errorResult("La meta de ahorro indicada no existe.", false), nil
			}
			return confirmedMutation(ctx, confirmer, userID, toolName, raw,
				"Eliminación de meta de ahorro pendiente de confirmación.",
				map[string]any{"goalId": existing.ID, "name": existing.Name, "currentAmountCents": existing.CurrentAmount},
				func() (ToolResult, error) { return ToolResult{}, errors.New("unreachable confirmed delete") })
		},
	}
}

// --- recurring transactions ---

type recurringMutationArgs struct {
	AccountID   string  `json:"accountId"`
	CategoryID  *string `json:"categoryId"`
	Description string  `json:"description"`
	Merchant    *string `json:"merchant"`
	AmountCents int64   `json:"amountCents"`
	Frequency   string  `json:"frequency"`
	StartDate   string  `json:"startDate"`
}

type updateRecurringArgs struct {
	RecurringID string  `json:"recurringId"`
	AccountID   string  `json:"accountId"`
	CategoryID  *string `json:"categoryId"`
	Description string  `json:"description"`
	Merchant    *string `json:"merchant"`
	AmountCents int64   `json:"amountCents"`
	Frequency   string  `json:"frequency"`
	StartDate   string  `json:"startDate"`
	IsActive    bool    `json:"isActive"`
}

type deleteRecurringArgs struct {
	RecurringID string `json:"recurringId"`
}

func validateRecurringMutation(accountID string, categoryID *string, description string, merchant *string, amount int64, frequency, startDate string) string {
	if strings.TrimSpace(accountID) == "" {
		return "accountId es requerido."
	}
	if categoryID != nil && strings.TrimSpace(*categoryID) == "" {
		return "categoryId no puede quedar vacío; usa null si no aplica."
	}
	if msg := validateRequiredText("description", description, maxResourceDescriptionLength); msg != "" {
		return msg
	}
	if msg := validateOptionalText("merchant", merchant, maxMerchantLength); msg != "" {
		return msg
	}
	if amount <= 0 {
		return "amountCents debe ser mayor a cero."
	}
	if frequency != "monthly" && frequency != "yearly" {
		return "frequency debe ser monthly o yearly."
	}
	if err := validateOptionalDate(startDate); err != nil || startDate == "" {
		return "startDate debe ser una fecha válida YYYY-MM-DD."
	}
	return ""
}

func validateRecurringReferences(ctx context.Context, data Store, userID, accountID string, categoryID *string, requireActive bool) (store.Account, store.Category, *ToolResult, error) {
	account, ok, err := lookupAccount(ctx, data, userID, accountID)
	if err != nil {
		result, resultErr := resourceLookupError(ctx, err)
		return store.Account{}, store.Category{}, &result, resultErr
	}
	if !ok || (requireActive && !account.IsActive) {
		result := errorResult("La cuenta indicada no existe, no pertenece al usuario o debe estar activa para esta operación.", false)
		return store.Account{}, store.Category{}, &result, nil
	}
	category, ok, err := lookupCategory(ctx, data, userID, categoryID)
	if err != nil {
		result, resultErr := resourceLookupError(ctx, err)
		return store.Account{}, store.Category{}, &result, resultErr
	}
	if !ok || (categoryID != nil && category.Kind != "expense") {
		result := errorResult("La categoría de gasto indicada no existe o no pertenece al usuario.", false)
		return store.Account{}, store.Category{}, &result, nil
	}
	return account, category, nil, nil
}

func recurringProposal(args recurringMutationArgs, account store.Account, category store.Category) map[string]any {
	proposal := map[string]any{
		"accountId": args.AccountID, "accountName": account.Name, "categoryId": args.CategoryID,
		"description": strings.TrimSpace(args.Description), "merchant": args.Merchant,
		"amountCents": args.AmountCents, "frequency": args.Frequency, "startDate": args.StartDate,
	}
	if args.CategoryID != nil {
		proposal["categoryName"] = category.Name
	}
	return proposal
}

func recurringInput(args recurringMutationArgs, idempotencyKey *string) store.RecurringTransactionInput {
	return store.RecurringTransactionInput{
		AccountID: args.AccountID, CategoryID: args.CategoryID, Description: strings.TrimSpace(args.Description),
		Merchant: args.Merchant, Amount: args.AmountCents, Frequency: args.Frequency, StartDate: args.StartDate,
		IdempotencyKey: idempotencyKey,
	}
}

const recurringInputSchemaProperties = `
	"accountId":{"type":"string"},"categoryId":{"type":["string","null"]},
	"description":{"type":"string","minLength":1,"maxLength":240},"merchant":{"type":["string","null"],"maxLength":120},
	"amountCents":{"type":"integer","minimum":1},"frequency":{"type":"string","enum":["monthly","yearly"]},
	"startDate":{"type":"string"}`

func newCreateRecurringTransactionTool(data Store, confirmer *Confirmer, userID string) Tool {
	const toolName = "create_recurring_transaction"
	return Tool{
		Definition: ToolDefinition{
			Name: toolName, Description: "Crea una plantilla de gasto recurrente mensual o anual. Requiere confirmación explícita.",
			InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"required":["accountId","categoryId","description","merchant","amountCents","frequency","startDate"],"properties":{` + recurringInputSchemaProperties + `}}`),
		},
		Handler: func(ctx context.Context, raw json.RawMessage) (ToolResult, error) {
			args, bad := decodeToolArgs[recurringMutationArgs](raw)
			if bad != nil {
				return *bad, nil
			}
			if msg := validateRecurringMutation(args.AccountID, args.CategoryID, args.Description, args.Merchant, args.AmountCents, args.Frequency, args.StartDate); msg != "" {
				return errorResult(msg, false), nil
			}
			account, category, badResult, err := validateRecurringReferences(ctx, data, userID, args.AccountID, args.CategoryID, true)
			if badResult != nil || err != nil {
				if badResult != nil {
					return *badResult, err
				}
				return ToolResult{}, err
			}
			return confirmedMutation(ctx, confirmer, userID, toolName, raw,
				"Creación de gasto recurrente pendiente de confirmación.", recurringProposal(args, account, category),
				func() (ToolResult, error) {
					key := stableIdempotencyKey(ConfirmationTokenFromContext(ctx))
					created, err := data.CreateRecurringTransaction(ctx, userID, recurringInput(args, &key))
					if err != nil {
						if result, resultErr, ok := idempotentDeletedReplayResult(err, "El gasto recurrente ya se había creado y después fue eliminado; no se recreó.", "recurringId"); ok {
							return result, resultErr
						}
						return resourceMutationError(ctx, err)
					}
					return successResult("Gasto recurrente creado.", map[string]any{"executed": true, "recurringId": created.ID})
				})
		},
	}
}

func newUpdateRecurringTransactionTool(data Store, confirmer *Confirmer, userID string) Tool {
	const toolName = "update_recurring_transaction"
	return Tool{
		Definition: ToolDefinition{
			Name: toolName, Description: "Reemplaza todos los campos de una plantilla recurrente. Usa list_recurring_transactions para conservar campos no mencionados. Requiere confirmación explícita.",
			InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"required":["recurringId","accountId","categoryId","description","merchant","amountCents","frequency","startDate","isActive"],"properties":{"recurringId":{"type":"string"},` + recurringInputSchemaProperties + `,"isActive":{"type":"boolean"}}}`),
		},
		Handler: func(ctx context.Context, raw json.RawMessage) (ToolResult, error) {
			args, bad := decodeToolArgs[updateRecurringArgs](raw)
			if bad != nil {
				return *bad, nil
			}
			base := recurringMutationArgs{AccountID: args.AccountID, CategoryID: args.CategoryID, Description: args.Description, Merchant: args.Merchant, AmountCents: args.AmountCents, Frequency: args.Frequency, StartDate: args.StartDate}
			if strings.TrimSpace(args.RecurringID) == "" {
				return errorResult("recurringId es requerido.", false), nil
			}
			if msg := validateRecurringMutation(base.AccountID, base.CategoryID, base.Description, base.Merchant, base.AmountCents, base.Frequency, base.StartDate); msg != "" {
				return errorResult(msg, false), nil
			}
			items, err := data.ListRecurringTransactions(ctx, userID)
			if err != nil {
				return resourceLookupError(ctx, err)
			}
			if _, ok := findRecurringByID(items, args.RecurringID); !ok {
				return errorResult("El gasto recurrente indicado no existe.", false), nil
			}
			account, category, badResult, err := validateRecurringReferences(ctx, data, userID, args.AccountID, args.CategoryID, args.IsActive)
			if badResult != nil || err != nil {
				if badResult != nil {
					return *badResult, err
				}
				return ToolResult{}, err
			}
			proposal := recurringProposal(base, account, category)
			proposal["recurringId"] = args.RecurringID
			proposal["isActive"] = args.IsActive
			return confirmedMutation(ctx, confirmer, userID, toolName, raw,
				"Actualización de gasto recurrente pendiente de confirmación.", proposal,
				func() (ToolResult, error) {
					active := args.IsActive
					materializeOccurrences := false
					input := recurringInput(base, nil)
					updated, err := data.UpdateRecurringTransaction(ctx, userID, args.RecurringID, store.RecurringTransactionUpdateInput{
						AccountID: input.AccountID, CategoryID: input.CategoryID, Description: input.Description,
						Merchant: input.Merchant, Amount: input.Amount, Frequency: input.Frequency,
						StartDate: input.StartDate, IsActive: &active,
						MaterializeOccurrences: &materializeOccurrences,
					})
					if err != nil {
						return resourceMutationError(ctx, err)
					}
					return successResult("Gasto recurrente actualizado.", map[string]any{"executed": true, "recurringId": updated.ID})
				})
		},
	}
}

func newDeleteRecurringTransactionTool(data Store, confirmer *Confirmer, userID string) Tool {
	const toolName = "delete_recurring_transaction"
	return Tool{
		Definition: ToolDefinition{Name: toolName, Description: "Elimina una plantilla de gasto recurrente. Requiere confirmación explícita.", InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"required":["recurringId"],"properties":{"recurringId":{"type":"string"}}}`)},
		Handler: func(ctx context.Context, raw json.RawMessage) (ToolResult, error) {
			args, bad := decodeToolArgs[deleteRecurringArgs](raw)
			if bad != nil {
				return *bad, nil
			}
			items, err := data.ListRecurringTransactions(ctx, userID)
			if err != nil {
				return resourceLookupError(ctx, err)
			}
			existing, ok := findRecurringByID(items, args.RecurringID)
			if token := ConfirmationTokenFromContext(ctx); token != "" && confirmer.Verify(token, userID, toolName, raw) == nil {
				err := data.DeleteRecurringTransaction(ctx, userID, args.RecurringID)
				if err != nil && !errors.Is(err, store.ErrNotFound) {
					return resourceMutationError(ctx, err)
				}
				return successResult("Gasto recurrente eliminado.", map[string]any{"executed": true, "recurringId": args.RecurringID})
			}
			if strings.TrimSpace(args.RecurringID) == "" || !ok {
				return errorResult("El gasto recurrente indicado no existe.", false), nil
			}
			return confirmedMutation(ctx, confirmer, userID, toolName, raw,
				"Eliminación de gasto recurrente pendiente de confirmación.",
				map[string]any{"recurringId": existing.ID, "description": existing.Description, "amountCents": existing.Amount},
				func() (ToolResult, error) { return ToolResult{}, errors.New("unreachable confirmed delete") })
		},
	}
}

// --- MSI purchases ---

type msiMutationArgs struct {
	AccountID        string  `json:"accountId"`
	CategoryID       *string `json:"categoryId"`
	Description      string  `json:"description"`
	Merchant         *string `json:"merchant"`
	TotalAmountCents int64   `json:"totalAmountCents"`
	InstallmentCount int     `json:"installmentCount"`
	StartDate        string  `json:"startDate"`
}

type updateMSIPurchaseArgs struct {
	MSIPurchaseID    string  `json:"msiPurchaseId"`
	AccountID        string  `json:"accountId"`
	CategoryID       *string `json:"categoryId"`
	Description      string  `json:"description"`
	Merchant         *string `json:"merchant"`
	TotalAmountCents int64   `json:"totalAmountCents"`
	InstallmentCount int     `json:"installmentCount"`
	StartDate        string  `json:"startDate"`
}

type deleteMSIPurchaseArgs struct {
	MSIPurchaseID string `json:"msiPurchaseId"`
}

func validateMSIMutation(accountID string, categoryID *string, description string, merchant *string, total int64, installments int, startDate string) string {
	if strings.TrimSpace(accountID) == "" {
		return "accountId es requerido."
	}
	if categoryID != nil && strings.TrimSpace(*categoryID) == "" {
		return "categoryId no puede quedar vacío; usa null si no aplica."
	}
	if msg := validateRequiredText("description", description, maxResourceDescriptionLength); msg != "" {
		return msg
	}
	if msg := validateOptionalText("merchant", merchant, maxMerchantLength); msg != "" {
		return msg
	}
	if total <= 0 {
		return "totalAmountCents debe ser mayor a cero."
	}
	if installments < 2 || installments > 60 {
		return "installmentCount debe estar entre 2 y 60."
	}
	if total < int64(installments) {
		return "totalAmountCents debe permitir al menos un centavo por mensualidad."
	}
	if err := validateOptionalDate(startDate); err != nil || startDate == "" {
		return "startDate debe ser una fecha válida YYYY-MM-DD."
	}
	return ""
}

func validateMSIReferences(ctx context.Context, data Store, userID, accountID string, categoryID *string, requireActive, requireTracking bool) (store.Account, store.Category, *ToolResult, error) {
	account, ok, err := lookupAccount(ctx, data, userID, accountID)
	if err != nil {
		result, resultErr := resourceLookupError(ctx, err)
		return store.Account{}, store.Category{}, &result, resultErr
	}
	if !ok || account.Type != "credit" || (requireActive && !account.IsActive) {
		result := errorResult("La compra MSI requiere una cuenta de crédito del usuario, activa para cambios de saldo o calendario.", false)
		return store.Account{}, store.Category{}, &result, nil
	}
	if requireTracking && !account.BalanceTrackingEnabled {
		result := errorResult("La cuenta MSI requiere seguimiento de saldo habilitado.", false)
		return store.Account{}, store.Category{}, &result, nil
	}
	category, ok, err := lookupCategory(ctx, data, userID, categoryID)
	if err != nil {
		result, resultErr := resourceLookupError(ctx, err)
		return store.Account{}, store.Category{}, &result, resultErr
	}
	if !ok || (categoryID != nil && category.Kind != "expense") {
		result := errorResult("La categoría de gasto indicada no existe o no pertenece al usuario.", false)
		return store.Account{}, store.Category{}, &result, nil
	}
	return account, category, nil, nil
}

func msiProposal(args msiMutationArgs, account store.Account, category store.Category) map[string]any {
	proposal := map[string]any{
		"accountId": args.AccountID, "accountName": account.Name, "categoryId": args.CategoryID,
		"description": strings.TrimSpace(args.Description), "merchant": args.Merchant,
		"totalAmountCents": args.TotalAmountCents, "installmentCount": args.InstallmentCount, "startDate": args.StartDate,
	}
	if args.CategoryID != nil {
		proposal["categoryName"] = category.Name
	}
	return proposal
}

func msiInput(args msiMutationArgs, idempotencyKey *string) store.MSIPurchaseInput {
	return store.MSIPurchaseInput{
		AccountID: args.AccountID, CategoryID: args.CategoryID, Description: strings.TrimSpace(args.Description),
		Merchant: args.Merchant, TotalAmount: args.TotalAmountCents, InstallmentCount: args.InstallmentCount,
		StartDate: args.StartDate, IdempotencyKey: idempotencyKey,
	}
}

const msiInputSchemaProperties = `
	"accountId":{"type":"string"},"categoryId":{"type":["string","null"]},
	"description":{"type":"string","minLength":1,"maxLength":240},"merchant":{"type":["string","null"],"maxLength":120},
	"totalAmountCents":{"type":"integer","minimum":1},"installmentCount":{"type":"integer","minimum":2,"maximum":60},
	"startDate":{"type":"string"}`

func newCreateMSIPurchaseTool(data Store, confirmer *Confirmer, userID string) Tool {
	const toolName = "create_msi_purchase"
	return Tool{
		Definition: ToolDefinition{
			Name: toolName, Description: "Registra una compra a meses sin intereses en una tarjeta con seguimiento de saldo. Requiere confirmación explícita.",
			InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"required":["accountId","categoryId","description","merchant","totalAmountCents","installmentCount","startDate"],"properties":{` + msiInputSchemaProperties + `}}`),
		},
		Handler: func(ctx context.Context, raw json.RawMessage) (ToolResult, error) {
			args, bad := decodeToolArgs[msiMutationArgs](raw)
			if bad != nil {
				return *bad, nil
			}
			if msg := validateMSIMutation(args.AccountID, args.CategoryID, args.Description, args.Merchant, args.TotalAmountCents, args.InstallmentCount, args.StartDate); msg != "" {
				return errorResult(msg, false), nil
			}
			account, category, badResult, err := validateMSIReferences(ctx, data, userID, args.AccountID, args.CategoryID, true, true)
			if badResult != nil || err != nil {
				if badResult != nil {
					return *badResult, err
				}
				return ToolResult{}, err
			}
			return confirmedMutation(ctx, confirmer, userID, toolName, raw,
				"Registro de compra MSI pendiente de confirmación.", msiProposal(args, account, category),
				func() (ToolResult, error) {
					token := ConfirmationTokenFromContext(ctx)
					key := stableIdempotencyKey(token)
					created, err := data.CreateMSIPurchase(ctx, userID, msiInput(args, &key))
					if err != nil {
						if result, resultErr, ok := idempotentDeletedReplayResult(err, "La compra MSI ya se había registrado y después fue eliminada; no se recreó.", "msiPurchaseId"); ok {
							return result, resultErr
						}
						return resourceMutationError(ctx, err)
					}
					return successResult("Compra MSI registrada.", map[string]any{"executed": true, "msiPurchaseId": created.ID})
				})
		},
	}
}

func newUpdateMSIPurchaseTool(data Store, confirmer *Confirmer, userID string) Tool {
	const toolName = "update_msi_purchase"
	return Tool{
		Definition: ToolDefinition{
			Name: toolName, Description: "Reemplaza todos los campos de una compra MSI sin mensualidades pagadas. Usa list_msi_purchases para conservar campos no mencionados. Requiere confirmación explícita.",
			InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"required":["msiPurchaseId","accountId","categoryId","description","merchant","totalAmountCents","installmentCount","startDate"],"properties":{"msiPurchaseId":{"type":"string"},` + msiInputSchemaProperties + `}}`),
		},
		Handler: func(ctx context.Context, raw json.RawMessage) (ToolResult, error) {
			args, bad := decodeToolArgs[updateMSIPurchaseArgs](raw)
			if bad != nil {
				return *bad, nil
			}
			base := msiMutationArgs{AccountID: args.AccountID, CategoryID: args.CategoryID, Description: args.Description, Merchant: args.Merchant, TotalAmountCents: args.TotalAmountCents, InstallmentCount: args.InstallmentCount, StartDate: args.StartDate}
			if strings.TrimSpace(args.MSIPurchaseID) == "" {
				return errorResult("msiPurchaseId es requerido.", false), nil
			}
			if msg := validateMSIMutation(base.AccountID, base.CategoryID, base.Description, base.Merchant, base.TotalAmountCents, base.InstallmentCount, base.StartDate); msg != "" {
				return errorResult(msg, false), nil
			}
			items, err := data.ListMSIPurchases(ctx, userID)
			if err != nil {
				return resourceLookupError(ctx, err)
			}
			existing, ok := findMSIPurchaseByID(items, args.MSIPurchaseID)
			if !ok {
				return errorResult("La compra MSI indicada no existe.", false), nil
			}
			if existing.InstallmentsPaid > 0 {
				return errorResult("No se puede reemplazar una compra MSI que ya tiene mensualidades pagadas.", false), nil
			}
			balanceOrScheduleChanged := args.AccountID != existing.AccountID ||
				args.TotalAmountCents != existing.TotalAmount ||
				args.InstallmentCount != existing.InstallmentCount ||
				args.StartDate != existing.StartDate
			account, category, badResult, err := validateMSIReferences(ctx, data, userID, args.AccountID, args.CategoryID, balanceOrScheduleChanged, false)
			if badResult != nil || err != nil {
				if badResult != nil {
					return *badResult, err
				}
				return ToolResult{}, err
			}
			proposal := msiProposal(base, account, category)
			proposal["msiPurchaseId"] = args.MSIPurchaseID
			return confirmedMutation(ctx, confirmer, userID, toolName, raw,
				"Actualización de compra MSI pendiente de confirmación.", proposal,
				func() (ToolResult, error) {
					updated, err := data.UpdateMSIPurchase(ctx, userID, args.MSIPurchaseID, msiInput(base, nil))
					if err != nil {
						return resourceMutationError(ctx, err)
					}
					return successResult("Compra MSI actualizada.", map[string]any{"executed": true, "msiPurchaseId": updated.ID})
				})
		},
	}
}

func newDeleteMSIPurchaseTool(data Store, confirmer *Confirmer, userID string) Tool {
	const toolName = "delete_msi_purchase"
	return Tool{
		Definition: ToolDefinition{Name: toolName, Description: "Elimina una compra MSI. Requiere confirmación explícita.", InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"required":["msiPurchaseId"],"properties":{"msiPurchaseId":{"type":"string"}}}`)},
		Handler: func(ctx context.Context, raw json.RawMessage) (ToolResult, error) {
			args, bad := decodeToolArgs[deleteMSIPurchaseArgs](raw)
			if bad != nil {
				return *bad, nil
			}
			items, err := data.ListMSIPurchases(ctx, userID)
			if err != nil {
				return resourceLookupError(ctx, err)
			}
			existing, ok := findMSIPurchaseByID(items, args.MSIPurchaseID)
			if token := ConfirmationTokenFromContext(ctx); token != "" && confirmer.Verify(token, userID, toolName, raw) == nil {
				err := data.DeleteMSIPurchase(ctx, userID, args.MSIPurchaseID)
				if err != nil && !errors.Is(err, store.ErrNotFound) {
					return resourceMutationError(ctx, err)
				}
				return successResult("Compra MSI eliminada.", map[string]any{"executed": true, "msiPurchaseId": args.MSIPurchaseID})
			}
			if strings.TrimSpace(args.MSIPurchaseID) == "" || !ok {
				return errorResult("La compra MSI indicada no existe.", false), nil
			}
			return confirmedMutation(ctx, confirmer, userID, toolName, raw,
				"Eliminación de compra MSI pendiente de confirmación.",
				map[string]any{"msiPurchaseId": existing.ID, "description": existing.Description, "totalAmountCents": existing.TotalAmount},
				func() (ToolResult, error) { return ToolResult{}, errors.New("unreachable confirmed delete") })
		},
	}
}
