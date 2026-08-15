package store

import (
	"testing"
	"time"
)

func TestRecurringOccurrenceDatePreservesOriginalCalendarDay(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		start      string
		frequency  string
		occurrence int
		want       string
	}{
		{name: "month end February", start: "2025-01-31", frequency: "monthly", occurrence: 1, want: "2025-02-28"},
		{name: "month end recovers", start: "2025-01-31", frequency: "monthly", occurrence: 2, want: "2025-03-31"},
		{name: "leap day clamps", start: "2024-02-29", frequency: "yearly", occurrence: 1, want: "2025-02-28"},
		{name: "leap day recovers", start: "2024-02-29", frequency: "yearly", occurrence: 4, want: "2028-02-29"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			got, err := recurringOccurrenceDate(test.start, test.frequency, test.occurrence)
			if err != nil || got != test.want {
				t.Fatalf("recurringOccurrenceDate() = %q, %v; want %q, nil", got, err, test.want)
			}
		})
	}
}

func TestAlignRecurringScheduleReturnsFirstFutureOccurrence(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		start     string
		frequency string
		today     string
		wantCount int
		wantDate  string
	}{
		{name: "future start", start: "2026-09-30", frequency: "monthly", today: "2026-08-14", wantCount: 0, wantDate: "2026-09-30"},
		{name: "future date this month", start: "2025-01-31", frequency: "monthly", today: "2026-08-14", wantCount: 19, wantDate: "2026-08-31"},
		{name: "due today advances", start: "2025-01-31", frequency: "monthly", today: "2026-08-31", wantCount: 20, wantDate: "2026-09-30"},
		{name: "annual due today advances", start: "2025-08-14", frequency: "yearly", today: "2026-08-14", wantCount: 2, wantDate: "2027-08-14"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			today, err := time.Parse("2006-01-02", test.today)
			if err != nil {
				t.Fatal(err)
			}
			count, date, err := alignRecurringSchedule(test.start, test.frequency, today)
			if err != nil || count != test.wantCount || date != test.wantDate {
				t.Fatalf("alignRecurringSchedule() = %d, %q, %v; want %d, %q, nil", count, date, err, test.wantCount, test.wantDate)
			}
		})
	}
}
