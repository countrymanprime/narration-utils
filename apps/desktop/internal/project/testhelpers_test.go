package project

import "time"

// fixedNow is a stable creation timestamp shared by tests that don't care about
// the exact value, so each test doesn't need to invent its own.
func fixedNow() time.Time {
	return time.Date(2026, 9, 21, 12, 0, 0, 0, time.UTC)
}
