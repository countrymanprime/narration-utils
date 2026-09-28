package continuity

import (
	"errors"
	"fmt"
	"math"
	"slices"

	"github.com/countrymanprime/narration-utils/shell/internal/acoustic"
)

// The Q6 calibration from the Phase 1 trial
// (docs/research/character-continuity-acoustic-trial.md), provisional until
// the real-corpus re-run on #510 (D70/D71).
const (
	// DefaultMinReferences is the fewest usable approved clips a baseline
	// is built from; below it no flag is raised ("insufficient reference").
	DefaultMinReferences = 3
	// DefaultPercentile is the percentile of the reference set's own
	// leave-one-out distances used as the outlier threshold.
	DefaultPercentile = 90.0
	// MinimumThreshold floors the threshold, in standard deviations of the
	// pooled reference scale: a reference set whose clips measure almost
	// identically would otherwise flag every tiny difference. The trial's
	// same-character median distance was 0.91.
	MinimumThreshold = 0.5
)

// relativeStdFloor floors a feature's pooled standard deviation at this
// share of its mean magnitude, so a feature that barely varies across the
// references does not turn a 1% change into many standard deviations.
const relativeStdFloor = 0.01

// ErrInsufficientReference is returned for a subject with fewer usable
// references than the rule's minimum.
var ErrInsufficientReference = errors.New("insufficient reference")

var featureNames = []string{
	"f0_median_hz",
	"f0_p10_p90_range_hz",
	"rate_voiced_runs_per_second",
	"rms_mean",
	"spectral_centroid_hz",
	"band_low_fraction",
	"band_mid_fraction",
	"band_high_fraction",
}

// FeatureNames lists the compared features in vector order, matching the
// trial's feature_vector (features_baseline.py).
func FeatureNames() []string { return slices.Clone(featureNames) }

// Vector is the comparable feature vector for f, in FeatureNames order. It
// is unavailable (false) when the clip had no measurable pitch: the trial's
// "unavailable evidence" path, never a fabricated number.
func Vector(f acoustic.Features) ([]float64, bool) {
	if f.F0MedianHz == nil {
		return nil, false
	}
	spread := 0.0
	if f.F0P10Hz != nil && f.F0P90Hz != nil {
		spread = *f.F0P90Hz - *f.F0P10Hz
	}
	return []float64{
		*f.F0MedianHz, spread, f.RateVoicedRunsPerSecond, f.RMSMean,
		f.SpectralCentroidHz, f.BandLowFraction, f.BandMidFraction, f.BandHighFraction,
	}, true
}

// Rule is the outlier rule: the minimum usable references and the
// percentile of the references' own distances that sets the threshold.
// Lowering Percentile tightens the threshold, trading more false rejects
// on in-voice lines for fewer missed drifts - the trade-off the trial asks
// Phase 5 to expose rather than hard-code.
type Rule struct {
	MinReferences int     `json:"min_references"`
	Percentile    float64 `json:"percentile"`
}

// DefaultRule is the trial's provisional calibration.
func DefaultRule() Rule {
	return Rule{MinReferences: DefaultMinReferences, Percentile: DefaultPercentile}
}

// Validate reports a rule no baseline can be built with. Two references
// are the least a leave-one-out distance needs.
func (r Rule) Validate() error {
	if r.MinReferences < 2 {
		return fmt.Errorf("a baseline needs at least 2 references, not %d", r.MinReferences)
	}
	if !(r.Percentile > 0 && r.Percentile <= 100) { // also rejects NaN
		return fmt.Errorf("percentile %v is outside (0, 100]", r.Percentile)
	}
	return nil
}

// Scale standardizes feature vectors: the mean and standard deviation of
// every usable reference in the project, pooled across characters and
// narration, as the trial's z-scoring did.
type Scale struct {
	Mean []float64
	Std  []float64
}

// NewScale pools vectors (all the same length) into a Scale.
func NewScale(vectors [][]float64) Scale {
	if len(vectors) == 0 {
		return Scale{}
	}
	n := len(vectors[0])
	scale := Scale{Mean: make([]float64, n), Std: make([]float64, n)}
	for _, v := range vectors {
		for i := range n {
			scale.Mean[i] += v[i]
		}
	}
	for i := range n {
		scale.Mean[i] /= float64(len(vectors))
	}
	for _, v := range vectors {
		for i := range n {
			d := v[i] - scale.Mean[i]
			scale.Std[i] += d * d
		}
	}
	for i := range n {
		std := math.Sqrt(scale.Std[i] / float64(len(vectors)))
		scale.Std[i] = max(std, relativeStdFloor*math.Abs(scale.Mean[i]), 1e-9)
	}
	return scale
}

// distance is the Euclidean distance between a and b in scale's
// standardized space.
func (s Scale) distance(a, b []float64) float64 {
	sum := 0.0
	for i := range a {
		d := (a[i] - b[i]) / s.Std[i]
		sum += d * d
	}
	return math.Sqrt(sum)
}

// Sample is one usable reference clip's vector.
type Sample struct {
	ReferenceID string
	Vector      []float64
}

// Baseline is one subject's (a character's, or narration's) reference
// distribution: the per-feature median, min and max across its clips, and
// the outlier threshold from the clips' own leave-one-out distances.
type Baseline struct {
	CharacterID  string
	ReferenceIDs []string
	Median       []float64
	Min          []float64
	Max          []float64
	Threshold    float64
	Percentile   float64
}

// BuildBaseline builds characterID's baseline from its usable samples. It
// returns ErrInsufficientReference below rule.MinReferences.
func BuildBaseline(characterID string, samples []Sample, scale Scale, rule Rule) (Baseline, error) {
	if err := rule.Validate(); err != nil {
		return Baseline{}, err
	}
	if len(samples) < rule.MinReferences {
		return Baseline{}, fmt.Errorf("%w: %d of the %d approved clips needed", ErrInsufficientReference, len(samples), rule.MinReferences)
	}
	vectors := make([][]float64, len(samples))
	baseline := Baseline{CharacterID: characterID, Percentile: rule.Percentile}
	for i, sample := range samples {
		vectors[i] = sample.Vector
		baseline.ReferenceIDs = append(baseline.ReferenceIDs, sample.ReferenceID)
	}
	baseline.Median, baseline.Min, baseline.Max = columnSummary(vectors)

	// Each reference against the median of the others: a reference is never
	// compared with a baseline it helped build, so the threshold is not
	// optimistically tight.
	distances := make([]float64, len(vectors))
	for i := range vectors {
		others := append(slices.Clone(vectors[:i]), vectors[i+1:]...)
		median, _, _ := columnSummary(others)
		distances[i] = scale.distance(vectors[i], median)
	}
	baseline.Threshold = max(percentile(distances, rule.Percentile), MinimumThreshold)
	return baseline, nil
}

// Distance is vector's standardized distance from the baseline's median.
func (b Baseline) Distance(scale Scale, vector []float64) float64 {
	return scale.distance(vector, b.Median)
}

// columnSummary is the per-feature median, min and max of vectors.
func columnSummary(vectors [][]float64) (median, lo, hi []float64) {
	n := len(vectors[0])
	median, lo, hi = make([]float64, n), make([]float64, n), make([]float64, n)
	column := make([]float64, len(vectors))
	for i := range n {
		for j, v := range vectors {
			column[j] = v[i]
		}
		median[i] = percentile(column, 50)
		lo[i], hi[i] = slices.Min(column), slices.Max(column)
	}
	return median, lo, hi
}

// percentile is the p-th percentile of values with linear interpolation
// between closest ranks (numpy's default), without reordering values.
func percentile(values []float64, p float64) float64 {
	sorted := slices.Clone(values)
	slices.Sort(sorted)
	rank := p / 100 * float64(len(sorted)-1)
	lower := int(math.Floor(rank))
	upper := min(lower+1, len(sorted)-1)
	return sorted[lower] + (rank-float64(lower))*(sorted[upper]-sorted[lower])
}
