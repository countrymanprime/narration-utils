package continuity

import (
	"errors"
	"math"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/acoustic"
)

func TestVectorIsUnavailableWithoutAMeasuredPitch(t *testing.T) {
	if _, ok := Vector(acoustic.Features{VoicedFraction: 0.5, RMSMean: 0.1}); ok {
		t.Fatal("a clip with no F0 reading must have no feature vector, not a fabricated one")
	}
	vector, ok := Vector(aliceVoice.features())
	if !ok || len(vector) != len(FeatureNames()) {
		t.Fatalf("Vector = %v, %v; want %d features", vector, ok, len(FeatureNames()))
	}
	if vector[0] != 230 || vector[1] != 60 {
		t.Fatalf("f0 median and p10-p90 range = %v, %v; want 230, 60", vector[0], vector[1])
	}
}

// unitScale leaves vectors unchanged, so distances in these tests are plain
// Euclidean distances a reader can check by hand.
func unitScale(n int) Scale {
	scale := Scale{Mean: make([]float64, n), Std: make([]float64, n)}
	for i := range scale.Std {
		scale.Std[i] = 1
	}
	return scale
}

func oneFeature(values ...float64) []Sample {
	samples := make([]Sample, len(values))
	for i, value := range values {
		samples[i] = Sample{ReferenceID: string(rune('a' + i)), Vector: []float64{value}}
	}
	return samples
}

func TestABaselineNeedsTheMinimumNumberOfReferences(t *testing.T) {
	_, err := BuildBaseline("alice", oneFeature(1, 2), unitScale(1), DefaultRule())
	if !errors.Is(err, ErrInsufficientReference) {
		t.Fatalf("two references: err = %v, want ErrInsufficientReference", err)
	}
	if _, err := BuildBaseline("alice", oneFeature(1, 2, 3), unitScale(1), DefaultRule()); err != nil {
		t.Fatalf("three references (Q6's minimum): %v", err)
	}
}

func TestTheThresholdIsAPercentileOfLeaveOneOutReferenceDistances(t *testing.T) {
	// Each reference against the median of the others:
	// 0 vs median(2,4,10)=4 -> 4; 2 vs median(0,4,10)=4 -> 2;
	// 4 vs median(0,2,10)=2 -> 2; 10 vs median(0,2,4)=2 -> 8.
	// Sorted 2,2,4,8; the 90th percentile (linear) is 4 + 0.7*(8-4) = 6.8.
	baseline, err := BuildBaseline("alice", oneFeature(0, 2, 4, 10), unitScale(1), DefaultRule())
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(baseline.Threshold-6.8) > 1e-9 {
		t.Fatalf("Threshold = %v, want 6.8", baseline.Threshold)
	}
	if baseline.Median[0] != 3 || baseline.Min[0] != 0 || baseline.Max[0] != 10 {
		t.Fatalf("median/min/max = %v/%v/%v, want 3/0/10", baseline.Median[0], baseline.Min[0], baseline.Max[0])
	}
	if got := baseline.Distance(unitScale(1), []float64{10}); got != 7 {
		t.Fatalf("Distance = %v, want 7", got)
	}
}

func TestALowerPercentileTightensTheThreshold(t *testing.T) {
	// The trial asks Phase 5 to expose the false-reject / false-accept
	// trade-off rather than hard-code the 90th percentile.
	loose, _ := BuildBaseline("alice", oneFeature(0, 2, 4, 10), unitScale(1), Rule{MinReferences: 3, Percentile: 90})
	tight, _ := BuildBaseline("alice", oneFeature(0, 2, 4, 10), unitScale(1), Rule{MinReferences: 3, Percentile: 75})
	if !(tight.Threshold < loose.Threshold) {
		t.Fatalf("75th percentile threshold %v is not below the 90th's %v", tight.Threshold, loose.Threshold)
	}
}

func TestIdenticalReferencesStillGetAUsableThreshold(t *testing.T) {
	baseline, err := BuildBaseline("alice", oneFeature(5, 5, 5), unitScale(1), DefaultRule())
	if err != nil {
		t.Fatal(err)
	}
	if baseline.Threshold != MinimumThreshold {
		t.Fatalf("Threshold = %v, want the floor %v, so tiny differences are not all flagged", baseline.Threshold, MinimumThreshold)
	}
}

func TestARuleOutsideItsBoundsIsRefused(t *testing.T) {
	for _, rule := range []Rule{{MinReferences: 1, Percentile: 90}, {MinReferences: 3, Percentile: 0}, {MinReferences: 3, Percentile: 101}, {MinReferences: 3, Percentile: math.NaN()}} {
		if err := rule.Validate(); err == nil {
			t.Errorf("rule %+v validated", rule)
		}
	}
	if err := DefaultRule().Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestTheScaleFloorsAFeatureThatDoesNotVary(t *testing.T) {
	scale := NewScale([][]float64{{1, 100}, {3, 100}, {5, 100}})
	if scale.Mean[0] != 3 || scale.Mean[1] != 100 {
		t.Fatalf("Mean = %v", scale.Mean)
	}
	if scale.Std[1] <= 0 {
		t.Fatalf("a constant feature's std must be floored above zero, got %v", scale.Std[1])
	}
	// The floor is relative to the feature's own magnitude, so a 1-unit
	// difference on a 100-unit feature is not a huge standardized jump.
	if z := (101 - scale.Mean[1]) / scale.Std[1]; z > 1.01 {
		t.Fatalf("1%% change on a constant feature reads as %v standard deviations", z)
	}
}
