package agent

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/aleonsa/budg/backend/internal/store"
)

func yieldStore() *fakeWriteStore {
	data := sampleWriteStore()
	bps := 1200
	started := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	reconciled := "2026-07-15"
	data.accounts[0].AnnualYieldBps = &bps
	data.accounts[0].BalanceTrackingEnabled = true
	data.accounts[0].BalanceTrackingStartedAt = &started
	data.accounts[0].YieldReconciledOn = &reconciled
	data.categories = append(data.categories, store.Category{ID: "cat-yield", Name: "Rendimientos", Kind: "income"})
	data.yields = []store.YieldReconciliation{
		{ID: "y2", AccountID: "acc-bbva", Date: "2026-07-15", PeriodStart: "2026-06-15", BalanceBeforeCents: 2_400_000, YieldCents: 24_000},
		{ID: "y1", AccountID: "acc-bbva", Date: "2025-12-31", PeriodStart: "2025-12-01", BalanceBeforeCents: 2_000_000, YieldCents: 19_000},
	}
	return data
}

func TestListAccountYieldsReportsEstimatesAndEffectiveRate(t *testing.T) {
	registry := mustMutationRegistry(t, yieldStore(), testConfirmer(t))
	result := callTool(t, registry, "list_account_yields", `{}`)

	var payload struct {
		Accounts []accountYieldView `json:"accounts"`
	}
	if err := json.Unmarshal(result.Data, &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(payload.Accounts) != 1 {
		t.Fatalf("accounts = %+v, want only the yield account", payload.Accounts)
	}
	view := payload.Accounts[0]
	if view.AccountID != "acc-bbva" || view.YieldYearToDateCents != 24_000 {
		t.Fatalf("view = %+v", view)
	}
	// 2026-07-15 -> 2026-08-14 = 30 days at 12% on 2,540,050 cents.
	want := store.EstimateYieldCents(2_540_050, view.AnnualYieldBps, 30)
	if view.EstimatedAccruedCents != want || view.EstimatedMonthlyCents != want {
		t.Fatalf("estimates = %d/%d, want %d", view.EstimatedAccruedCents, view.EstimatedMonthlyCents, want)
	}
	// Window includes both reconciliations (after 2025-08-14).
	if view.EffectiveAnnualRateBps == nil || *view.EffectiveAnnualRateBps < 1100 || *view.EffectiveAnnualRateBps > 1250 {
		t.Fatalf("effective rate = %v, want ~1180 bps", view.EffectiveAnnualRateBps)
	}
}

func TestReconcileAccountYieldProposesThenExecutes(t *testing.T) {
	data := yieldStore()
	registry := mustMutationRegistry(t, data, testConfirmer(t))
	tool, _ := registry.lookup("reconcile_account_yield")
	args := json.RawMessage(`{"accountId":"acc-bbva","expectedBudgBalanceCents":2540050,"currentBalanceCents":2565050,"yieldAmountCents":null,"categoryId":"cat-yield","date":"2026-08-14"}`)

	proposed, err := tool.Handler(context.Background(), args)
	if err != nil {
		t.Fatalf("propose: %v", err)
	}
	proposal := decodeProposal(t, proposed)
	var detail map[string]any
	if err := json.Unmarshal(proposal.Proposal, &detail); err != nil {
		t.Fatalf("decode proposal: %v", err)
	}
	if detail["yieldCents"].(float64) != 25_000 || detail["adjustmentCents"].(float64) != 0 {
		t.Fatalf("proposal = %+v", detail)
	}
	if data.yieldCalls != 0 {
		t.Fatal("ReconcileYield executed before confirmation")
	}

	ctx := WithConfirmationToken(context.Background(), proposal.ConfirmationToken)
	if _, err := tool.Handler(ctx, args); err != nil {
		t.Fatalf("confirm: %v", err)
	}
	firstKey := *data.yieldInput.IdempotencyKey
	if _, err := tool.Handler(ctx, args); err != nil {
		t.Fatalf("confirm again: %v", err)
	}
	in := data.yieldInput
	if data.yieldCalls != 2 || data.yieldAccountID != "acc-bbva" || in.YieldCents != 25_000 ||
		in.CurrentBalanceCents != 2_565_050 || in.Date != "2026-08-14" || *in.IdempotencyKey != firstKey {
		t.Fatalf("captured = %d %s %+v", data.yieldCalls, data.yieldAccountID, in)
	}
}

func TestReconcileAccountYieldRejectsInvalidRequests(t *testing.T) {
	cases := map[string]string{
		"yield above difference": `{"accountId":"acc-bbva","expectedBudgBalanceCents":2540050,"currentBalanceCents":2550050,"yieldAmountCents":20000,"categoryId":null,"date":null}`,
		"yield on negative diff": `{"accountId":"acc-bbva","expectedBudgBalanceCents":2540050,"currentBalanceCents":2500000,"yieldAmountCents":10,"categoryId":null,"date":null}`,
		"expense category":       `{"accountId":"acc-bbva","expectedBudgBalanceCents":2540050,"currentBalanceCents":2550050,"yieldAmountCents":null,"categoryId":"cat-food","date":null}`,
		"credit account":         `{"accountId":"acc-banamex","expectedBudgBalanceCents":0,"currentBalanceCents":1,"yieldAmountCents":null,"categoryId":null,"date":null}`,
		"stale budg balance":     `{"accountId":"acc-bbva","expectedBudgBalanceCents":1,"currentBalanceCents":2550050,"yieldAmountCents":null,"categoryId":null,"date":null}`,
		"future date":            `{"accountId":"acc-bbva","expectedBudgBalanceCents":2540050,"currentBalanceCents":2550050,"yieldAmountCents":null,"categoryId":null,"date":"2026-08-15"}`,
		"unknown account":        `{"accountId":"nope","expectedBudgBalanceCents":0,"currentBalanceCents":1,"yieldAmountCents":null,"categoryId":null,"date":null}`,
	}
	for name, args := range cases {
		t.Run(name, func(t *testing.T) {
			data := yieldStore()
			registry := mustMutationRegistry(t, data, testConfirmer(t))
			tool, _ := registry.lookup("reconcile_account_yield")
			result, err := tool.Handler(context.Background(), json.RawMessage(args))
			if err != nil {
				t.Fatalf("handler: %v", err)
			}
			if result.Status != ToolStatusError || data.yieldCalls != 0 {
				t.Fatalf("status = %q calls = %d", result.Status, data.yieldCalls)
			}
		})
	}

	untracked := yieldStore()
	untracked.accounts[0].BalanceTrackingEnabled = false
	registry := mustMutationRegistry(t, untracked, testConfirmer(t))
	tool, _ := registry.lookup("reconcile_account_yield")
	result, _ := tool.Handler(context.Background(), json.RawMessage(`{"accountId":"acc-bbva","expectedBudgBalanceCents":2540050,"currentBalanceCents":2550050,"yieldAmountCents":null,"categoryId":null,"date":null}`))
	if result.Status != ToolStatusError {
		t.Fatal("untracked account should be rejected")
	}
}

func TestCashFlowForecastIncludesExpectedYield(t *testing.T) {
	registry := mustMutationRegistry(t, yieldStore(), testConfirmer(t))
	result := callTool(t, registry, "get_cash_flow_forecast", `{"daysAhead":30}`)
	var payload struct {
		ExpectedYieldCents             int64 `json:"expectedYieldCents"`
		ProjectedBalanceCents          int64 `json:"projectedBalanceCents"`
		ProjectedBalanceWithYieldCents int64 `json:"projectedBalanceWithYieldCents"`
	}
	if err := json.Unmarshal(result.Data, &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if payload.ExpectedYieldCents <= 0 || payload.ProjectedBalanceWithYieldCents != payload.ProjectedBalanceCents+payload.ExpectedYieldCents {
		t.Fatalf("payload = %+v", payload)
	}
}
