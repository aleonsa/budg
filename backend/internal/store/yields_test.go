package store

import "testing"

func TestEstimateYieldCents(t *testing.T) {
	bps := 1200 // 12% annual
	if got := EstimateYieldCents(100_000_00, &bps, 30); got < 99_000 || got > 99_200 {
		t.Fatalf("30-day estimate on $100,000 at 12%% = %d cents, want ~99,120", got)
	}
	if got := EstimateYieldCents(100_000_00, &bps, 365); got < 1_274_000 || got > 1_276_000 {
		t.Fatalf("1-year daily compounding = %d cents, want ~1,274,700", got)
	}
	zero := 0
	for name, got := range map[string]int64{
		"nil rate":         EstimateYieldCents(100_00, nil, 30),
		"zero rate":        EstimateYieldCents(100_00, &zero, 30),
		"negative balance": EstimateYieldCents(-100_00, &bps, 30),
		"zero days":        EstimateYieldCents(100_00, &bps, 0),
	} {
		if got != 0 {
			t.Errorf("%s = %d, want 0", name, got)
		}
	}
}

func int64Ptr(v int64) *int64 { return &v }

func TestEstimateYieldCentsTiered(t *testing.T) {
	// 15% up to $25,000, then 7%: each portion compounds at its own rate.
	tiers := []YieldTier{
		{UpToCents: int64Ptr(2_500_000), AnnualYieldBps: 1500},
		{UpToCents: nil, AnnualYieldBps: 700},
	}
	below := EstimateYieldCentsTiered(2_500_000, nil, tiers, 30)
	if below != 30_908 {
		t.Fatalf("at first-tier cap = %d, want 30908", below)
	}
	above := EstimateYieldCentsTiered(5_000_000, nil, tiers, 30)
	if above != 45_331 {
		t.Fatalf("across tiers = %d, want 45331", above)
	}
	if crossing := EstimateYieldCentsTiered(2_500_000, nil, tiers, 365); crossing != 388_398 {
		t.Fatalf("interest crossing the cap = %d, want 388398", crossing)
	}
	// Tiers take precedence over the flat rate.
	flatOnly := EstimateYieldCentsTiered(1_000_000, int64PtrBps(100), nil, 10)
	if flatOnly != EstimateYieldCents(1_000_000, int64PtrBps(100), 10) {
		t.Fatalf("flat fallback = %d", flatOnly)
	}
	if EstimateYieldCentsTiered(0, nil, tiers, 30) != 0 || EstimateYieldCentsTiered(100, nil, tiers, 0) != 0 {
		t.Fatal("zero balance or days must yield zero")
	}
}

func int64PtrBps(v int64) *int { bps := int(v); return &bps }

func TestBlendedAnnualYieldBps(t *testing.T) {
	tiers := []YieldTier{
		{UpToCents: int64Ptr(2_500_000), AnnualYieldBps: 1500},
		{UpToCents: nil, AnnualYieldBps: 700},
	}
	// $50,000: half at 15%, half at 7% -> 11%.
	if got := BlendedAnnualYieldBps(5_000_000, nil, tiers); got == nil || *got != 1100 {
		t.Fatalf("blended = %v, want 1100", got)
	}
	if got := BlendedAnnualYieldBps(2_500_000, nil, tiers); got == nil || *got != 1500 {
		t.Fatalf("blended below cap = %v, want 1500", got)
	}
	flat := 900
	if got := BlendedAnnualYieldBps(1_000_000, &flat, nil); got == nil || *got != 900 {
		t.Fatalf("flat blended = %v", got)
	}
	if BlendedAnnualYieldBps(0, &flat, tiers) != nil || BlendedAnnualYieldBps(100, nil, nil) != nil {
		t.Fatal("zero balance or no config must return nil")
	}
}

func TestValidYieldTiers(t *testing.T) {
	valid := []YieldTier{
		{UpToCents: int64Ptr(2_500_000), AnnualYieldBps: 1500},
		{UpToCents: nil, AnnualYieldBps: 700},
	}
	if !validYieldTiers("debit", valid) {
		t.Fatal("valid ladder rejected")
	}
	if !validYieldTiers("debit", nil) {
		t.Fatal("absent ladder rejected")
	}
	invalid := map[string][]YieldTier{
		"single capped":     {{UpToCents: int64Ptr(100), AnnualYieldBps: 100}},
		"cap not last":      {{UpToCents: nil, AnnualYieldBps: 100}, {UpToCents: int64Ptr(100), AnnualYieldBps: 100}},
		"non increasing":    {{UpToCents: int64Ptr(200), AnnualYieldBps: 100}, {UpToCents: int64Ptr(100), AnnualYieldBps: 100}, {UpToCents: nil, AnnualYieldBps: 100}},
		"rate out of range": {{UpToCents: int64Ptr(100), AnnualYieldBps: 20_001}, {UpToCents: nil, AnnualYieldBps: 100}},
		"too many":          make([]YieldTier, 9),
	}
	for name, tiers := range invalid {
		if validYieldTiers("debit", tiers) {
			t.Fatalf("%s ladder accepted", name)
		}
	}
	if validYieldTiers("credit", valid) {
		t.Fatal("credit ladder accepted")
	}
}

func TestYieldShares(t *testing.T) {
	shares := YieldShares(1_000, 100_000, map[string]int64{"b": 20_000, "a": 40_000, "empty": 0})
	if len(shares) != 2 || shares[0] != (YieldAllocation{GoalID: "a", Amount: 400}) ||
		shares[1] != (YieldAllocation{GoalID: "b", Amount: 200}) {
		t.Fatalf("shares = %+v", shares)
	}

	// Allocations exceeding the balance scale by total allocated so the sum
	// never exceeds the yield.
	over := YieldShares(1_000, 50_000, map[string]int64{"a": 60_000, "b": 40_000})
	var total int64
	for _, share := range over {
		total += share.Amount
	}
	if total > 1_000 || over[0].Amount != 600 || over[1].Amount != 400 {
		t.Fatalf("over-allocated shares = %+v", over)
	}

	// Rounds down; leftover cents stay unallocated.
	odd := YieldShares(10, 30, map[string]int64{"a": 10, "b": 10, "c": 10})
	for _, share := range odd {
		if share.Amount != 3 {
			t.Fatalf("odd shares = %+v", odd)
		}
	}
	if len(YieldShares(0, 100, map[string]int64{"a": 10})) != 0 || len(YieldShares(10, 0, map[string]int64{})) != 0 {
		t.Fatal("expected no shares")
	}
	if len(YieldShares(1_000, 1_000_000_000_000, map[string]int64{"a": 1})) != 0 {
		t.Fatal("sub-cent share should be dropped")
	}
}
