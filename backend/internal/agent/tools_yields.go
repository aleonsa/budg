package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/aleonsa/budg/backend/internal/store"
)

type accountYieldView struct {
	AccountID              string            `json:"accountId"`
	AccountName            string            `json:"accountName"`
	BalanceCents           int64             `json:"balanceCents"`
	AnnualYieldBps         *int              `json:"annualYieldBps"`
	AnnualYieldTiers       []store.YieldTier `json:"annualYieldTiers"`
	BlendedAnnualYieldBps  *int              `json:"blendedAnnualYieldBps"`
	LastReconciledOn       *string           `json:"lastReconciledOn"`
	EstimatedAccruedCents  int64             `json:"estimatedAccruedCents"`
	EstimatedMonthlyCents  int64             `json:"estimatedMonthlyCents"`
	YieldYearToDateCents   int64             `json:"yieldYearToDateCents"`
	EffectiveAnnualRateBps *int64            `json:"effectiveAnnualRateBps"`
	BalanceTrackingEnabled bool              `json:"balanceTrackingEnabled"`
}

func newListAccountYieldsTool(data ReadStore, userID, currentDate string) Tool {
	return Tool{
		Definition: ToolDefinition{
			Name: "list_account_yields",
			Description: "Lista cuentas de ahorro con tasa de rendimiento: saldo, tasa anual configurada (bps, 100 = 1%; puede ser " +
				"por tramos, ej. 15% hasta $25,000 y 7% después), tasa combinada al saldo actual, rendimiento estimado acumulado " +
				"desde la última conciliación, estimado mensual, rendimientos registrados en el año y tasa efectiva real de los " +
				"últimos 12 meses.",
			InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{}}`),
		},
		Handler: func(ctx context.Context, raw json.RawMessage) (ToolResult, error) {
			if _, bad := decodeToolArgs[struct{}](raw); bad != nil {
				return *bad, nil
			}
			accounts, err := data.ListAccounts(ctx, userID)
			if err != nil {
				return resourceLookupError(ctx, err)
			}
			reconciliations, err := data.ListYieldReconciliations(ctx, userID)
			if err != nil {
				return resourceLookupError(ctx, err)
			}
			today, err := time.Parse(time.DateOnly, currentDate)
			if err != nil {
				return storeError(), nil
			}
			views := buildAccountYieldViews(accounts, reconciliations, today)
			return successResult(fmt.Sprintf("%d cuenta(s) con rendimientos", len(views)), map[string]any{"accounts": views})
		},
	}
}

func buildAccountYieldViews(accounts []store.Account, reconciliations []store.YieldReconciliation, today time.Time) []accountYieldView {
	byAccount := map[string][]store.YieldReconciliation{}
	for _, rec := range reconciliations {
		byAccount[rec.AccountID] = append(byAccount[rec.AccountID], rec)
	}
	yearStart := time.Date(today.Year(), 1, 1, 0, 0, 0, 0, time.UTC).Format(time.DateOnly)
	windowStart := today.AddDate(-1, 0, 0).Format(time.DateOnly)

	views := []accountYieldView{}
	for _, account := range accounts {
		history := byAccount[account.ID]
		if !account.IsActive || account.Type != "debit" ||
			(account.AnnualYieldBps == nil && len(account.AnnualYieldTiers) == 0 && len(history) == 0) {
			continue
		}
		balance := int64(0)
		if account.BalanceCents != nil {
			balance = *account.BalanceCents
		}
		view := accountYieldView{
			AccountID: account.ID, AccountName: account.Name, BalanceCents: balance,
			AnnualYieldBps: account.AnnualYieldBps, AnnualYieldTiers: account.AnnualYieldTiers,
			LastReconciledOn:       account.YieldReconciledOn,
			BalanceTrackingEnabled: account.BalanceTrackingEnabled,
			EstimatedMonthlyCents:  store.EstimateYieldCentsTiered(balance, account.AnnualYieldBps, account.AnnualYieldTiers, 30),
			BlendedAnnualYieldBps:  store.BlendedAnnualYieldBps(balance, account.AnnualYieldBps, account.AnnualYieldTiers),
		}
		start := account.YieldReconciledOn
		if start == nil && account.BalanceTrackingStartedAt != nil {
			startedOn := account.BalanceTrackingStartedAt.UTC().Format(time.DateOnly)
			start = &startedOn
		}
		if start != nil {
			if from, err := time.Parse(time.DateOnly, *start); err == nil && today.After(from) {
				view.EstimatedAccruedCents = store.EstimateYieldCentsTiered(balance, account.AnnualYieldBps, account.AnnualYieldTiers, int(today.Sub(from).Hours()/24))
			}
		}
		var weightedBalanceDays float64
		var windowYield int64
		for _, rec := range history {
			if rec.Date >= yearStart {
				view.YieldYearToDateCents += rec.YieldCents
			}
			if rec.Date < windowStart {
				continue
			}
			from, errFrom := time.Parse(time.DateOnly, rec.PeriodStart)
			to, errTo := time.Parse(time.DateOnly, rec.Date)
			days := to.Sub(from).Hours() / 24
			if errFrom != nil || errTo != nil || days <= 0 || rec.BalanceBeforeCents <= 0 {
				continue
			}
			weightedBalanceDays += float64(rec.BalanceBeforeCents) * days
			windowYield += rec.YieldCents
		}
		if weightedBalanceDays > 0 {
			bps := int64(math.Round(float64(windowYield) / weightedBalanceDays * 365 * 10_000))
			view.EffectiveAnnualRateBps = &bps
		}
		views = append(views, view)
	}
	return views
}

type reconcileYieldArgs struct {
	AccountID                string  `json:"accountId"`
	ExpectedBudgBalanceCents int64   `json:"expectedBudgBalanceCents"`
	CurrentBalanceCents      int64   `json:"currentBalanceCents"`
	YieldAmountCents         *int64  `json:"yieldAmountCents"`
	CategoryID               *string `json:"categoryId"`
	Date                     *string `json:"date"`
}

func newReconcileAccountYieldTool(data Store, confirmer *Confirmer, userID, currentDate string) Tool {
	const toolName = "reconcile_account_yield"
	return Tool{
		Definition: ToolDefinition{
			Name: toolName,
			Description: "Concilia el saldo real de una cuenta de ahorro con seguimiento de saldo. La diferencia positiva se registra " +
				"como ingreso de rendimientos (repartido proporcionalmente a las metas de esa cuenta) y el resto como ajuste. " +
				"yieldAmountCents null usa toda la diferencia positiva como rendimiento. Requiere confirmación explícita.",
			InputSchema: json.RawMessage(`{
				"type":"object","additionalProperties":false,
				"required":["accountId","expectedBudgBalanceCents","currentBalanceCents","yieldAmountCents","categoryId","date"],
				"properties":{
					"accountId":{"type":"string","description":"Cuenta de débito resuelta con list_accounts o list_account_yields"},
					"expectedBudgBalanceCents":{"type":"integer","description":"Saldo actual de budg para la cuenta, tal como lo devolvió list_account_yields; si cambió, se rechaza"},
					"currentBalanceCents":{"type":"integer","description":"Saldo real que muestra el banco, en centavos"},
					"yieldAmountCents":{"type":["integer","null"],"minimum":0,"description":"Parte de la diferencia que es rendimiento; null = toda la diferencia positiva"},
					"categoryId":{"type":["string","null"],"description":"Categoría de ingreso para el rendimiento; null si no aplica"},
					"date":{"type":["string","null"],"description":"YYYY-MM-DD; null usa hoy"}
				}
			}`),
		},
		Handler: func(ctx context.Context, raw json.RawMessage) (ToolResult, error) {
			args, bad := decodeToolArgs[reconcileYieldArgs](raw)
			if bad != nil {
				return *bad, nil
			}
			if strings.TrimSpace(args.AccountID) == "" {
				return errorResult("accountId es requerido.", false), nil
			}
			date := currentDate
			if args.Date != nil {
				if err := validateOptionalDate(*args.Date); err != nil || *args.Date == "" || *args.Date > currentDate {
					return errorResult("date debe ser null o una fecha YYYY-MM-DD no futura.", false), nil
				}
				date = *args.Date
			}
			account, ok, err := lookupAccount(ctx, data, userID, args.AccountID)
			if err != nil {
				return resourceLookupError(ctx, err)
			}
			if !ok || account.Type != "debit" || !account.IsActive || account.BalanceCents == nil {
				return errorResult("La cuenta debe ser una cuenta de débito activa del usuario.", false), nil
			}
			if !account.BalanceTrackingEnabled {
				return errorResult("Activa el seguimiento de saldo de la cuenta antes de conciliar rendimientos.", false), nil
			}
			if args.CategoryID != nil {
				category, found, err := lookupCategory(ctx, data, userID, args.CategoryID)
				if err != nil {
					return resourceLookupError(ctx, err)
				}
				if !found || category.Kind != "income" {
					return errorResult("La categoría debe ser una categoría de ingreso del usuario.", false), nil
				}
			}

			balance := *account.BalanceCents
			if balance != args.ExpectedBudgBalanceCents {
				return errorResult("El saldo de budg cambió desde la consulta; vuelve a consultar list_account_yields y propone de nuevo.", false), nil
			}
			difference := args.CurrentBalanceCents - balance
			yield := int64(0)
			if difference > 0 {
				yield = difference
			}
			if args.YieldAmountCents != nil {
				yield = *args.YieldAmountCents
			}
			if yield < 0 || (difference >= 0 && yield > difference) || (difference < 0 && yield != 0) {
				return errorResult("El rendimiento debe estar entre 0 y la diferencia positiva.", false), nil
			}
			estimate := int64(0)
			start := account.YieldReconciledOn
			if start == nil && account.BalanceTrackingStartedAt != nil {
				startedOn := account.BalanceTrackingStartedAt.UTC().Format(time.DateOnly)
				start = &startedOn
			}
			if start != nil {
				from, errFrom := time.Parse(time.DateOnly, *start)
				to, errTo := time.Parse(time.DateOnly, date)
				if errFrom == nil && errTo == nil && to.After(from) {
					estimate = store.EstimateYieldCentsTiered(balance, account.AnnualYieldBps, account.AnnualYieldTiers, int(to.Sub(from).Hours()/24))
				}
			}

			proposal := map[string]any{
				"accountId": account.ID, "accountName": account.Name, "date": date,
				"budgBalanceCents": balance, "bankBalanceCents": args.CurrentBalanceCents,
				"differenceCents": difference, "yieldCents": yield, "adjustmentCents": difference - yield,
				"estimatedYieldCents": estimate, "categoryId": args.CategoryID,
			}
			return confirmedMutation(ctx, confirmer, userID, toolName, raw,
				"Conciliación de rendimientos pendiente de confirmación.", proposal,
				func() (ToolResult, error) {
					key := stableIdempotencyKey(ConfirmationTokenFromContext(ctx))
					result, err := data.ReconcileYield(ctx, userID, account.ID, store.YieldReconciliationInput{
						CurrentBalanceCents: args.CurrentBalanceCents, YieldCents: yield,
						CategoryID: args.CategoryID, Date: date, IdempotencyKey: &key,
					})
					if err != nil {
						if replay, replayErr, ok := idempotentDeletedReplayResult(err, "La conciliación ya se había registrado y después se deshizo; no se repitió.", "reconciliationId"); ok {
							return replay, replayErr
						}
						return resourceMutationError(ctx, err)
					}
					return successResult("Rendimientos conciliados.", map[string]any{
						"executed": true, "reconciliationId": result.Reconciliation.ID,
						"yieldCents": result.Reconciliation.YieldCents, "adjustmentCents": result.Reconciliation.AdjustmentCents,
						"goalAllocations": result.Reconciliation.Allocations,
					})
				})
		},
	}
}
