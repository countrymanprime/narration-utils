package continuity

import (
	"fmt"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/acoustic"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

// ChainShiftDB is how far outside the references' own range a line's noise
// floor or overall level must sit before the recording chain is taken to
// differ (a different microphone, gain or room). Provisional: session
// baselines are later work, and this is only a guard against reporting a
// chain change as voice drift.
const ChainShiftDB = 6.0

// ConfidentReferenceCount is the reference count at which confidence from
// sample size stops rising: the trial's reference-count sweep shows
// diminishing returns after 5 clips.
const ConfidentReferenceCount = 5

// chainConfidenceFactor is how much a chain difference lowers confidence.
const chainConfidenceFactor = 0.5

// SuggestedActionAudition is the only action a character_continuity
// finding suggests: play the line against its references. It changes
// nothing, so it needs no confirmation.
const SuggestedActionAudition = "audition_reference"

// ChainCheck compares a line's noise floor and level with its references'.
// A shift is the line's value minus the references' median; it only counts
// when the line sits more than ChainShiftDB outside the references' range.
type ChainCheck struct {
	Differs           bool     `json:"differs"`
	Reasons           []string `json:"reasons,omitempty"`
	NoiseFloorShiftDB *float64 `json:"noise_floor_shift_db,omitempty"`
	LevelShiftDB      *float64 `json:"level_shift_db,omitempty"`
}

// CheckChain compares candidate with the references it is measured
// against. A level that is unmeasured on either side is not compared.
func CheckChain(candidate Measurement, references []Measurement) ChainCheck {
	var check ChainCheck
	compare := func(label string, value *float64, pick func(Measurement) *float64) *float64 {
		if value == nil {
			return nil
		}
		var levels []float64
		for _, reference := range references {
			if level := pick(reference); level != nil {
				levels = append(levels, *level)
			}
		}
		if len(levels) == 0 {
			return nil
		}
		shift := round(*value - percentile(levels, 50))
		lo, hi := slices.Min(levels), slices.Max(levels)
		if *value > hi+ChainShiftDB || *value < lo-ChainShiftDB {
			check.Differs = true
			check.Reasons = append(check.Reasons, fmt.Sprintf("the %s is %+.1f dB from the references'", label, shift))
		}
		return &shift
	}
	check.NoiseFloorShiftDB = compare("noise floor", candidate.NoiseFloordBFS, func(m Measurement) *float64 { return m.NoiseFloordBFS })
	check.LevelShiftDB = compare("overall level", candidate.RMSdBFS, func(m Measurement) *float64 { return m.RMSdBFS })
	return check
}

// FeatureEvidence is one row of a finding's feature table: the line's
// value against its references' median and range.
type FeatureEvidence struct {
	Name            string  `json:"name"`
	Value           float64 `json:"value"`
	ReferenceMedian float64 `json:"reference_median"`
	ReferenceMin    float64 `json:"reference_min"`
	ReferenceMax    float64 `json:"reference_max"`
	// StandardizedDifference is (value - reference median) in pooled
	// standard deviations: which features moved, and which way.
	StandardizedDifference float64 `json:"standardized_difference"`
	SampleSize             int     `json:"sample_size"`
}

// NarrationEvidence is the line's distance to the narration baseline
// (Q9 option A), or why it is unavailable.
type NarrationEvidence struct {
	Available                bool     `json:"available"`
	Reason                   string   `json:"reason,omitempty"`
	Distance                 float64  `json:"distance,omitempty"`
	Threshold                float64  `json:"threshold,omitempty"`
	ReferenceIDs             []string `json:"reference_ids,omitempty"`
	ReferenceCount           int      `json:"reference_count,omitempty"`
	WithinNarrationReference bool     `json:"within_narration_reference"`
}

type findingInput struct {
	project     findings.Project
	candidate   Candidate
	measurement Measurement
	vector      []float64
	baseline    Baseline
	scale       Scale
	distance    float64
	chain       ChainCheck
	narration   NarrationEvidence
	rule        Rule
}

// newFinding is the character_continuity findings adapter: one outlier
// line as a finding carrying its reference ids, feature table, sample size
// and confidence reason, worded as a measurement only.
func newFinding(in findingInput) findings.Finding {
	cue, alignment := in.candidate.Cue, in.candidate.Alignment
	references := slices.Clone(in.baseline.ReferenceIDs)
	table := make([]FeatureEvidence, len(featureNames))
	for i, name := range featureNames {
		table[i] = FeatureEvidence{
			Name: name, Value: round(in.vector[i]),
			ReferenceMedian: round(in.baseline.Median[i]), ReferenceMin: round(in.baseline.Min[i]), ReferenceMax: round(in.baseline.Max[i]),
			StandardizedDifference: round((in.vector[i] - in.baseline.Median[i]) / in.scale.Std[i]),
			SampleSize:             len(references),
		}
	}

	confidence, reason := confidenceOf(in, len(references))
	severity := findings.SeverityWarning
	if in.chain.Differs {
		severity = findings.SeverityInfo
	}
	timeRange := alignment.TimeRange
	return findings.Finding{
		SchemaVersion: findings.SchemaVersion,
		ID:            findings.StableID(AnalyzerName, cue.ID, cue.SpeakerID),
		Analyzer:      AnalyzerName,
		Project:       in.project,
		Source:        alignment.Source,
		TimeRange:     &timeRange,
		Manuscript: &findings.Manuscript{
			ChapterID: cue.ChapterID, Expected: cue.QuoteText,
			Span: &findings.Span{ParagraphID: cue.ParagraphID, Start: cue.QuoteStart, End: cue.QuoteEnd},
		},
		Category:         findings.CategoryCharacterContinuity,
		Severity:         severity,
		Confidence:       &confidence,
		ConfidenceReason: reason,
		EvidenceVersion:  evidenceVersion(in, table),
		Evidence: map[string]any{
			"analyzer_version":          AnalyzerVersion,
			"feature_version":           acoustic.FeatureVersion,
			"cue_id":                    cue.ID,
			"character_id":              cue.SpeakerID,
			"speaker_source":            cue.SpeakerSource,
			"speaker_corrected":         cue.Corrected,
			"excerpt":                   cue.Excerpt,
			"distance":                  round(in.distance),
			"threshold":                 round(in.baseline.Threshold),
			"percentile":                in.rule.Percentile,
			"reference_ids":             references,
			"reference_count":           len(references),
			"features":                  table,
			"narration":                 in.narration,
			"recording_chain":           in.chain,
			"octave_ambiguous_fraction": round(in.measurement.Features.OctaveAmbiguousFraction),
			"measured_clip":             alignment.Clip,
		},
		SuggestedAction: &findings.SuggestedAction{
			Kind:                 SuggestedActionAudition,
			Parameters:           map[string]any{"reference_ids": references},
			RequiresConfirmation: false,
		},
		Review: findings.ReviewState{Status: findings.StatusUnreviewed},
	}
}

// confidenceOf scores the finding from the reference size and the pitch
// tracker's stability on the line, lowered when the recording chain may
// differ, and says why in plain measurement terms.
func confidenceOf(in findingInput, references int) (float64, string) {
	size := min(1, float64(references)/ConfidentReferenceCount)
	ambiguous := in.measurement.Features.OctaveAmbiguousFraction
	confidence := size * (1 - ambiguous)
	var reason strings.Builder
	fmt.Fprintf(&reason, "The line measures %.2f from the approved reference against a threshold of %.2f (the references' own %gth percentile). ",
		in.distance, in.baseline.Threshold, in.rule.Percentile)
	fmt.Fprintf(&reason, "Measured against %d approved reference clips (confidence from sample size is full at %d). ", references, ConfidentReferenceCount)
	fmt.Fprintf(&reason, "%.0f%% of the line's pitch readings are octave-ambiguous.", 100*ambiguous)
	if in.chain.Differs {
		confidence *= chainConfidenceFactor
		fmt.Fprintf(&reason, " The recording chain may differ from the references' (%s), so this is reported at lower confidence instead of as a voice difference.",
			strings.Join(in.chain.Reasons, "; "))
	}
	return round(confidence), reason.String()
}

// evidenceVersion hashes what a narrator's decision was made against: the
// analyzer, the line's audio and measurements, and the baseline it was
// measured against. Re-recording the line, or approving, revoking or
// re-approving a reference, changes it; a re-run on the same evidence
// does not.
func evidenceVersion(in findingInput, table []FeatureEvidence) string {
	parts := []string{
		strconv.Itoa(AnalyzerVersion), strconv.Itoa(acoustic.FeatureVersion),
		in.candidate.Alignment.Clip.File,
		format(in.candidate.Alignment.Clip.Range.StartSeconds), format(in.candidate.Alignment.Clip.Range.LengthSeconds),
		strings.Join(in.baseline.ReferenceIDs, ","),
		format(in.baseline.Threshold), format(in.rule.Percentile), strconv.Itoa(in.rule.MinReferences),
		strconv.FormatBool(in.chain.Differs),
	}
	for _, row := range table {
		parts = append(parts, format(row.Value), format(row.ReferenceMedian))
	}
	return findings.StableID(AnalyzerName+"-evidence", parts...)
}

func round(v float64) float64 { return math.Round(v*1e4) / 1e4 }

func format(v float64) string { return strconv.FormatFloat(round(v), 'g', -1, 64) }

// scopePattern mirrors the findings store's scope file-name rule.
var scopePattern = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

// scopeFor is the findings-store scope for a chapter: its id when that is a
// usable file name, a stable hash of it otherwise.
func scopeFor(chapterID string) string {
	if scopePattern.MatchString(chapterID) {
		return chapterID
	}
	return "chapter-" + findings.StableID(AnalyzerName, chapterID)
}

// Save writes result to the findings store, one full run per chapter the
// run covered: a narrator's decision is kept while the id and evidence
// version match, and a finding the run no longer raises is carried forward
// as not in the latest run rather than deleted.
func Save(store FindingsWriter, result Result) ([]findings.Finding, error) {
	var saved []findings.Finding
	for _, chapter := range result.Chapters {
		var fresh []findings.Finding
		for _, finding := range result.Findings {
			if finding.Manuscript != nil && finding.Manuscript.ChapterID == chapter {
				fresh = append(fresh, finding)
			}
		}
		merged, err := store.SaveAnalyzerFindings(AnalyzerName, scopeFor(chapter), fresh)
		if err != nil {
			return nil, err
		}
		saved = append(saved, merged...)
	}
	return saved, nil
}
