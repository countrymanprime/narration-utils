package acoustic

import (
	"math"
	"sort"
)

// percentile returns the p-th percentile (0-100) of v using linear
// interpolation between the two nearest ranks, matching numpy.percentile's
// default method - the same one the trial's Python computed its thresholds
// and F0 summary statistics with. It returns 0 for an empty v.
func percentile(v []float64, p float64) float64 {
	if len(v) == 0 {
		return 0
	}
	sorted := append([]float64(nil), v...)
	sort.Float64s(sorted)
	if len(sorted) == 1 {
		return sorted[0]
	}
	rank := p / 100 * float64(len(sorted)-1)
	lo := int(math.Floor(rank))
	hi := int(math.Ceil(rank))
	if lo == hi {
		return sorted[lo]
	}
	frac := rank - float64(lo)
	value := sorted[lo]*(1-frac) + sorted[hi]*frac
	// The two-multiply interpolation above can round to a hair outside
	// [sorted[lo], sorted[hi]] when they are extremely close together (as
	// with a sustained tone whose frame RMS barely varies): clamp so a
	// caller comparing a source value against this result with >= never
	// misses that value's own bucket because of interpolation rounding.
	return math.Min(math.Max(value, sorted[lo]), sorted[hi])
}
