package agent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/aleonsa/budg/backend/internal/store"
)

// WriteStore is the minimal mutation surface the mutation tools depend on.
// Like ReadStore, it is a narrow interface (not the concrete repository) so
// tools stay testable with fakes.
type WriteStore interface {
	CreateTransaction(ctx context.Context, userID string, in store.TransactionInput) (store.Transaction, error)
	UpdateTransaction(ctx context.Context, userID, id string, patch store.TransactionPatch) (store.Transaction, error)
	DeleteTransaction(ctx context.Context, userID, id string) error
}

// Store is everything the full (read + mutation) tool set needs.
type Store interface {
	ReadStore
	WriteStore
}

// RegisterMutationTools adds create_transaction, update_transaction, and
// delete_transaction to an existing registry. Every one of them requires
// explicit confirmation before it ever writes to the store -- see the
// "Política de mutaciones" section of docs/agentic/phase-2-backend-agent.md.
func RegisterMutationTools(registry *ToolRegistry, data Store, confirmer *Confirmer, userID string) error {
	if registry == nil {
		return errors.New("registry is required")
	}
	if data == nil {
		return errors.New("store is required")
	}
	if confirmer == nil {
		return errors.New("confirmer is required")
	}
	if userID == "" {
		return errors.New("user id is required")
	}

	tools := []Tool{
		newCreateTransactionTool(data, confirmer, userID),
		newUpdateTransactionTool(data, confirmer, userID),
		newDeleteTransactionTool(data, confirmer, userID),
	}
	for _, tool := range tools {
		if err := registry.Register(tool); err != nil {
			return err
		}
	}
	return nil
}

// proposalResult builds the uniform "pending confirmation" tool result every
// mutation tool returns when it has not executed. extractPendingConfirmation
// (loop.go) recognizes the confirmationToken key by convention -- this is
// the one place that shape is assembled, so all three mutation tools stay
// consistent.
func proposalResult(summary string, proposal any, token string, expiresAt time.Time) (ToolResult, error) {
	payload, err := json.Marshal(map[string]any{
		"proposal":              proposal,
		"confirmationToken":     token,
		"confirmationExpiresAt": expiresAt.UTC().Format(time.RFC3339),
		"requiresConfirmation":  true,
	})
	if err != nil {
		return ToolResult{}, fmt.Errorf("marshal proposal: %w", err)
	}
	return ToolResult{Status: ToolStatusSuccess, Summary: summary, Data: payload, NextActions: []string{}}, nil
}

// mutationStoreError translates a store error from a mutation into a safe,
// user-facing tool result, mirroring writeTransactionClientError in
// internal/httpapi/transactions.go so the agent and the direct HTTP API give
// consistent messages for the same underlying failure.
func mutationStoreError(err error) ToolResult {
	switch {
	case errors.Is(err, store.ErrNotFound):
		return errorResult("El recurso indicado ya no existe.", false)
	case errors.Is(err, store.ErrInvalidTransactionShape):
		return errorResult("Los datos del movimiento no forman una transacción válida.", false)
	case errors.Is(err, store.ErrTransferCurrencyMismatch):
		return errorResult("Las cuentas de la transferencia deben usar la misma moneda.", false)
	case errors.Is(err, store.ErrInvalidAccountShape):
		return errorResult("La cuenta tiene un estado de saldo inválido para esta operación.", false)
	case errors.Is(err, store.ErrIdempotencyConflict):
		return errorResult("La confirmación ya se usó con datos distintos; pide una nueva propuesta.", false)
	case errors.Is(err, store.ErrBalanceTrackingNotEnabled):
		return errorResult("Esta operación requiere seguimiento de saldo habilitado en la cuenta.", false)
	default:
		return storeError()
	}
}

// stableIdempotencyKey derives a deterministic key from the confirmation
// token so that confirming the SAME token twice (e.g. a client retry after a
// flaky network response) maps to the same store-level idempotency key.
// TransactionRepository.Create already treats a repeated key with identical
// material fields as a no-op replay (returns the existing row), which is
// exactly what "Repetir confirmación sin duplicar movimiento" requires --
// see createTransactionWithLockedAccounts in internal/store/transactions.go.
func stableIdempotencyKey(token string) string {
	sum := sha256.Sum256([]byte(token))
	return "agent:" + hex.EncodeToString(sum[:])
}

func findAccountByID(accounts []store.Account, id string) (store.Account, bool) {
	for _, account := range accounts {
		if account.ID == id {
			return account, true
		}
	}
	return store.Account{}, false
}

func findCategoryByID(categories []store.Category, id string) (store.Category, bool) {
	for _, category := range categories {
		if category.ID == id {
			return category, true
		}
	}
	return store.Category{}, false
}

func findTransactionByID(transactions []store.Transaction, id string) (store.Transaction, bool) {
	for _, transaction := range transactions {
		if transaction.ID == id {
			return transaction, true
		}
	}
	return store.Transaction{}, false
}

// --- create_transaction ---

type createTransactionArgs struct {
	Type                string  `json:"type"`
	AmountCents         int64   `json:"amountCents"`
	AccountID           string  `json:"accountId"`
	CategoryID          *string `json:"categoryId"`
	Date                string  `json:"date"`
	Description         string  `json:"description"`
	Merchant            *string `json:"merchant"`
	TransferToAccountID *string `json:"transferToAccountId"`
}

func validateCreateTransactionArgs(args createTransactionArgs) string {
	switch args.Type {
	case "expense", "income", "transfer":
	default:
		return "type debe ser expense, income o transfer."
	}
	if args.AmountCents <= 0 {
		return "El monto debe ser mayor a cero."
	}
	if strings.TrimSpace(args.AccountID) == "" {
		return "accountId es requerido."
	}
	if err := validateOptionalDate(args.Date); err != nil || args.Date == "" {
		return "date debe tener formato YYYY-MM-DD."
	}
	if strings.TrimSpace(args.Description) == "" {
		return "description es requerido."
	}
	if args.Type == "transfer" {
		if args.TransferToAccountID == nil || strings.TrimSpace(*args.TransferToAccountID) == "" {
			return "transferToAccountId es requerido para transferencias."
		}
		if *args.TransferToAccountID == args.AccountID {
			return "No se puede transferir a la misma cuenta."
		}
		if args.CategoryID != nil {
			return "Las transferencias no llevan categoría."
		}
	} else if args.TransferToAccountID != nil {
		return "transferToAccountId solo aplica para transferencias."
	}
	return ""
}

func newCreateTransactionTool(data Store, confirmer *Confirmer, userID string) Tool {
	const toolName = "create_transaction"
	return Tool{
		Definition: ToolDefinition{
			Name: toolName,
			Description: "Crea un gasto, ingreso o transferencia. Requiere confirmación explícita: la primera " +
				"llamada solo propone la operación, nunca la ejecuta.",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"additionalProperties": false,
				"required": ["type", "amountCents", "accountId", "categoryId", "date", "description", "merchant", "transferToAccountId"],
				"properties": {
					"type": {"type": "string", "enum": ["expense", "income", "transfer"]},
					"amountCents": {"type": "integer", "minimum": 1, "description": "Monto en centavos, siempre positivo. Ej. 10000 = MXN 100.00"},
					"accountId": {"type": "string", "description": "ID de cuenta origen, resuelto con list_accounts"},
					"categoryId": {"type": ["string", "null"], "description": "ID de categoría resuelto con list_categories. null si no aplica o es transferencia"},
					"date": {"type": "string", "description": "Fecha YYYY-MM-DD"},
					"description": {"type": "string", "description": "Descripción breve del movimiento"},
					"merchant": {"type": ["string", "null"], "description": "Comercio o contraparte. null si no aplica"},
					"transferToAccountId": {"type": ["string", "null"], "description": "Requerido solo si type es transfer. null en otro caso"}
				}
			}`),
		},
		Handler: func(ctx context.Context, raw json.RawMessage) (ToolResult, error) {
			args, bad := decodeToolArgs[createTransactionArgs](raw)
			if bad != nil {
				return *bad, nil
			}
			if msg := validateCreateTransactionArgs(args); msg != "" {
				return errorResult(msg, false), nil
			}

			accounts, err := data.ListAccounts(ctx, userID)
			if err != nil {
				if ctxErr := ctx.Err(); ctxErr != nil {
					return ToolResult{}, ctxErr
				}
				return storeError(), nil
			}
			account, ok := findAccountByID(accounts, args.AccountID)
			if !ok {
				return errorResult("La cuenta indicada no existe o no pertenece al usuario.", false), nil
			}

			var categoryName string
			if args.CategoryID != nil {
				categories, err := data.ListCategories(ctx, userID)
				if err != nil {
					if ctxErr := ctx.Err(); ctxErr != nil {
						return ToolResult{}, ctxErr
					}
					return storeError(), nil
				}
				category, ok := findCategoryByID(categories, *args.CategoryID)
				if !ok {
					return errorResult("La categoría indicada no existe o no pertenece al usuario.", false), nil
				}
				categoryName = category.Name
			}

			var transferToName string
			if args.Type == "transfer" {
				destination, ok := findAccountByID(accounts, *args.TransferToAccountID)
				if !ok {
					return errorResult("La cuenta destino no existe o no pertenece al usuario.", false), nil
				}
				transferToName = destination.Name
			}

			if token := ConfirmationTokenFromContext(ctx); token != "" {
				if verifyErr := confirmer.Verify(token, userID, toolName, raw); verifyErr == nil {
					idempotencyKey := stableIdempotencyKey(token)
					created, err := data.CreateTransaction(ctx, userID, store.TransactionInput{
						AccountID:         args.AccountID,
						Type:              args.Type,
						Amount:            args.AmountCents,
						CategoryID:        args.CategoryID,
						Date:              args.Date,
						Description:       args.Description,
						Merchant:          args.Merchant,
						TransferToAccount: args.TransferToAccountID,
						IdempotencyKey:    &idempotencyKey,
					})
					if err != nil {
						if ctxErr := ctx.Err(); ctxErr != nil {
							return ToolResult{}, ctxErr
						}
						return mutationStoreError(err), nil
					}
					return successResult("Movimiento registrado.", map[string]any{
						"executed":      true,
						"transactionId": created.ID,
					})
				}
				// Falls through: missing, expired, or mismatched token
				// (including changed arguments) re-proposes with a fresh
				// token instead of executing or hard-failing.
			}

			token, expiresAt, err := confirmer.Issue(userID, toolName, raw)
			if err != nil {
				return ToolResult{}, fmt.Errorf("issue confirmation token: %w", err)
			}
			proposal := map[string]any{
				"type":        args.Type,
				"amountCents": args.AmountCents,
				"accountName": account.Name,
				"date":        args.Date,
				"description": args.Description,
			}
			if categoryName != "" {
				proposal["categoryName"] = categoryName
			}
			if args.Merchant != nil {
				proposal["merchant"] = *args.Merchant
			}
			if transferToName != "" {
				proposal["transferToAccountName"] = transferToName
			}
			return proposalResult(
				fmt.Sprintf("Propuesta de %s pendiente de confirmación.", args.Type),
				proposal, token, expiresAt,
			)
		},
	}
}

// --- update_transaction ---

type updateTransactionArgs struct {
	TransactionID string  `json:"transactionId"`
	AmountCents   *int64  `json:"amountCents"`
	CategoryID    *string `json:"categoryId"`
	Date          *string `json:"date"`
	Description   *string `json:"description"`
	Merchant      *string `json:"merchant"`
}

func newUpdateTransactionTool(data Store, confirmer *Confirmer, userID string) Tool {
	const toolName = "update_transaction"
	return Tool{
		Definition: ToolDefinition{
			Name: toolName,
			Description: "Corrige campos de un movimiento existente (monto, categoría, fecha, descripción o " +
				"comercio). Un campo en null significa 'no cambiar'; esta herramienta no puede limpiar un campo a " +
				"vacío. Requiere confirmación explícita antes de ejecutarse.",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"additionalProperties": false,
				"required": ["transactionId", "amountCents", "categoryId", "date", "description", "merchant"],
				"properties": {
					"transactionId": {"type": "string", "description": "ID del movimiento, resuelto con search_transactions"},
					"amountCents": {"type": ["integer", "null"], "minimum": 1, "description": "Nuevo monto en centavos. null para no cambiarlo"},
					"categoryId": {"type": ["string", "null"], "description": "Nueva categoría. null para no cambiarla"},
					"date": {"type": ["string", "null"], "description": "Nueva fecha YYYY-MM-DD. null para no cambiarla"},
					"description": {"type": ["string", "null"], "description": "Nueva descripción. null para no cambiarla"},
					"merchant": {"type": ["string", "null"], "description": "Nuevo comercio. null para no cambiarlo"}
				}
			}`),
		},
		Handler: func(ctx context.Context, raw json.RawMessage) (ToolResult, error) {
			args, bad := decodeToolArgs[updateTransactionArgs](raw)
			if bad != nil {
				return *bad, nil
			}
			if strings.TrimSpace(args.TransactionID) == "" {
				return errorResult("transactionId es requerido.", false), nil
			}
			if args.AmountCents == nil && args.CategoryID == nil && args.Date == nil &&
				args.Description == nil && args.Merchant == nil {
				return errorResult("No hay cambios que aplicar; especifica al menos un campo distinto de null.", false), nil
			}
			if args.AmountCents != nil && *args.AmountCents <= 0 {
				return errorResult("El monto debe ser mayor a cero.", false), nil
			}
			if args.Date != nil {
				if err := validateOptionalDate(*args.Date); err != nil {
					return errorResult("date debe tener formato YYYY-MM-DD.", false), nil
				}
			}
			if args.Description != nil && strings.TrimSpace(*args.Description) == "" {
				return errorResult("description no puede quedar vacío.", false), nil
			}

			transactions, err := data.ListTransactions(ctx, userID)
			if err != nil {
				if ctxErr := ctx.Err(); ctxErr != nil {
					return ToolResult{}, ctxErr
				}
				return storeError(), nil
			}
			if _, ok := findTransactionByID(transactions, args.TransactionID); !ok {
				return errorResult("El movimiento indicado no existe.", false), nil
			}

			var categoryName string
			if args.CategoryID != nil {
				categories, err := data.ListCategories(ctx, userID)
				if err != nil {
					if ctxErr := ctx.Err(); ctxErr != nil {
						return ToolResult{}, ctxErr
					}
					return storeError(), nil
				}
				category, ok := findCategoryByID(categories, *args.CategoryID)
				if !ok {
					return errorResult("La categoría indicada no existe o no pertenece al usuario.", false), nil
				}
				categoryName = category.Name
			}

			if token := ConfirmationTokenFromContext(ctx); token != "" {
				if verifyErr := confirmer.Verify(token, userID, toolName, raw); verifyErr == nil {
					patch := store.TransactionPatch{}
					if args.AmountCents != nil {
						patch.Amount = args.AmountCents
					}
					if args.Date != nil {
						patch.Date = args.Date
					}
					if args.Description != nil {
						patch.Description = args.Description
					}
					if args.CategoryID != nil {
						patch.CategoryID = store.Field[string]{Set: true, Value: args.CategoryID}
					}
					if args.Merchant != nil {
						patch.Merchant = store.Field[string]{Set: true, Value: args.Merchant}
					}
					updated, err := data.UpdateTransaction(ctx, userID, args.TransactionID, patch)
					if err != nil {
						if ctxErr := ctx.Err(); ctxErr != nil {
							return ToolResult{}, ctxErr
						}
						return mutationStoreError(err), nil
					}
					return successResult("Movimiento corregido.", map[string]any{
						"executed":      true,
						"transactionId": updated.ID,
					})
				}
			}

			token, expiresAt, err := confirmer.Issue(userID, toolName, raw)
			if err != nil {
				return ToolResult{}, fmt.Errorf("issue confirmation token: %w", err)
			}
			proposal := map[string]any{"transactionId": args.TransactionID}
			if args.AmountCents != nil {
				proposal["amountCents"] = *args.AmountCents
			}
			if categoryName != "" {
				proposal["categoryName"] = categoryName
			}
			if args.Date != nil {
				proposal["date"] = *args.Date
			}
			if args.Description != nil {
				proposal["description"] = *args.Description
			}
			if args.Merchant != nil {
				proposal["merchant"] = *args.Merchant
			}
			return proposalResult("Corrección pendiente de confirmación.", proposal, token, expiresAt)
		},
	}
}

// --- delete_transaction ---

type deleteTransactionArgs struct {
	TransactionID string `json:"transactionId"`
}

func newDeleteTransactionTool(data Store, confirmer *Confirmer, userID string) Tool {
	const toolName = "delete_transaction"
	return Tool{
		Definition: ToolDefinition{
			Name:        toolName,
			Description: "Elimina un movimiento existente. Requiere confirmación explícita antes de ejecutarse.",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"additionalProperties": false,
				"required": ["transactionId"],
				"properties": {
					"transactionId": {"type": "string", "description": "ID del movimiento a eliminar, resuelto con search_transactions"}
				}
			}`),
		},
		Handler: func(ctx context.Context, raw json.RawMessage) (ToolResult, error) {
			args, bad := decodeToolArgs[deleteTransactionArgs](raw)
			if bad != nil {
				return *bad, nil
			}
			if strings.TrimSpace(args.TransactionID) == "" {
				return errorResult("transactionId es requerido.", false), nil
			}

			transactions, err := data.ListTransactions(ctx, userID)
			if err != nil {
				if ctxErr := ctx.Err(); ctxErr != nil {
					return ToolResult{}, ctxErr
				}
				return storeError(), nil
			}
			existing, ok := findTransactionByID(transactions, args.TransactionID)

			if token := ConfirmationTokenFromContext(ctx); token != "" {
				if verifyErr := confirmer.Verify(token, userID, toolName, raw); verifyErr == nil {
					err := data.DeleteTransaction(ctx, userID, args.TransactionID)
					if err != nil && !errors.Is(err, store.ErrNotFound) {
						if ctxErr := ctx.Err(); ctxErr != nil {
							return ToolResult{}, ctxErr
						}
						return mutationStoreError(err), nil
					}
					// A concurrent or repeated delete landing on an
					// already-gone transaction is treated as success: the
					// user's desired end state (no such transaction) already
					// holds, so surfacing an error here would be confusing
					// and would not reflect a real problem.
					return successResult("Movimiento eliminado.", map[string]any{
						"executed":      true,
						"transactionId": args.TransactionID,
					})
				}
			}

			if !ok {
				return errorResult("El movimiento indicado no existe.", false), nil
			}
			token, expiresAt, err := confirmer.Issue(userID, toolName, raw)
			if err != nil {
				return ToolResult{}, fmt.Errorf("issue confirmation token: %w", err)
			}
			return proposalResult("Eliminación pendiente de confirmación.", map[string]any{
				"transactionId": existing.ID,
				"description":   existing.Description,
				"amountCents":   existing.Amount,
				"date":          existing.Date,
			}, token, expiresAt)
		},
	}
}
