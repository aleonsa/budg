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
