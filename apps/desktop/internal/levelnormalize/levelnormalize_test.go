package levelnormalize

import (
	"math"
	"testing"
)

func value(v float64) *float64 { return &v }

func TestGainDeltaDBProposesTheDifferenceWhenOutsideTolerance(t *testing.T) {
	target := Target{Metric: MetricIntegratedLUFS, ValueDB: -18, ToleranceDB: 0.5}
	delta, needs, ok := GainDeltaDB(value(-21), target)
	if !ok || !needs || delta != 3 {
		t.Fatalf("delta=%v needs=%v ok=%v, want +3 dB needed", delta, needs, ok)
	}
}

func TestGainDeltaDBNeedsNoChangeWithinTolerance(t *testing.T) {
	target := Target{Metric: MetricIntegratedLUFS, ValueDB: -18, ToleranceDB: 0.5}
	delta, needs, ok := GainDeltaDB(value(-18.3), target)
	if !ok || needs || delta != 0 {
		t.Fatalf("delta=%v needs=%v ok=%v, want no change within tolerance", delta, needs, ok)
	}
}

func TestGainDeltaDBAtExactlyTheToleranceBoundaryNeedsNoChange(t *testing.T) {
	target := Target{Metric: MetricRMS, ValueDB: -20, ToleranceDB: 1}
	delta, needs, ok := GainDeltaDB(value(-21), target)
	if !ok || needs || delta != 0 {
		t.Fatalf("delta=%v needs=%v ok=%v, want no change exactly at the tolerance edge", delta, needs, ok)
	}
}

func TestGainDeltaDBIsNegativeWhenTooLoud(t *testing.T) {
	target := Target{Metric: MetricRMS, ValueDB: -20, ToleranceDB: 0.5}
	delta, needs, ok := GainDeltaDB(value(-14), target)
	if !ok || !needs || delta != -6 {
		t.Fatalf("delta=%v needs=%v ok=%v, want -6 dB", delta, needs, ok)
	}
}

func TestGainDeltaDBIsNotOKForAnUnmeasuredValue(t *testing.T) {
	target := Target{Metric: MetricIntegratedLUFS, ValueDB: -18, ToleranceDB: 0.5}
	if _, _, ok := GainDeltaDB(nil, target); ok {
		t.Fatal("want ok=false for a nil (unmeasurable) value, never a fabricated 0 dB")
	}
}

func TestGainDeltaDBIsNotOKForANonFiniteValue(t *testing.T) {
	target := Target{Metric: MetricIntegratedLUFS, ValueDB: -18, ToleranceDB: 0.5}
	nan := math.NaN()
	if _, _, ok := GainDeltaDB(&nan, target); ok {
		t.Fatal("want ok=false for NaN")
	}
	inf := math.Inf(-1)
	if _, _, ok := GainDeltaDB(&inf, target); ok {
		t.Fatal("want ok=false for -Inf")
	}
}
