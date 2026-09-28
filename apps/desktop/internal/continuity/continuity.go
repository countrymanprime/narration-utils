// Package continuity implements Phase 5 of
// docs/prds/character-continuity-review.prd.md: baselines built only from
// the narrator's approved voice references, candidate dialogue lines located
// through the manuscript's dialogue cues and aligned words, the outlier rule
// calibrated by the Phase 1 trial (Q6), the recording-chain check that
// suppresses a drift flag instead of raising one, and the adapter that turns
// what it measured into character_continuity findings.
//
// Every finding is a neutral measurement - "this line measures outside the
// approved reference" - with the reference ids, a per-feature table, the
// sample size and a stated confidence reason. Nothing here identifies a
// speaker from audio or judges a performance, and nothing leaves the
// machine (D72).
//
// The package depends on roles, never on concrete adapters: a
// ReferenceSource (character.Service), a ReferenceAudio resolver
// (SavedProjectAudio over the saved .rpp), a CueAligner (TR-3's persisted
// aligned words, not built yet, so production has no aligner and Phase 6
// wires one in once it exists) and a ClipMeasurer (FileMeasurer over the
// acoustic and measure packages).
package continuity

import (
	"github.com/countrymanprime/narration-utils/shell/internal/acoustic"
	"github.com/countrymanprime/narration-utils/shell/internal/character"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

// AnalyzerName is the findings analyzer (and findings-store folder) name.
const AnalyzerName = "character-continuity"

// AnalyzerVersion changes when a finding's meaning changes: the feature
// vector, the distance, the rule or the chain check. It is part of every
// finding's evidence version, so a change re-opens old decisions honestly.
const AnalyzerVersion = 1

// Clip is a stretch of one source audio file.
type Clip struct {
	File  string        `json:"file"`
	Range measure.Range `json:"range"`
}

// Measurement is what a ClipMeasurer reports for one clip: the explainable
// features and the two levels the recording-chain check compares. A nil
// level is unmeasurable, never guessed.
type Measurement struct {
	Features       acoustic.Features `json:"features"`
	RMSdBFS        *float64          `json:"rms_dbfs"`
	NoiseFloordBFS *float64          `json:"noise_floor_dbfs"`
}

// ReferenceSource lists the narrator's references, each saying whether its
// region changed since approval. *character.Service satisfies it.
type ReferenceSource interface {
	References() ([]character.ApprovedReference, error)
}

// ReferenceAudio resolves an approved reference to the source audio its
// region covers, or says why it cannot.
type ReferenceAudio interface {
	Resolve(reference character.Reference) (Clip, error)
}

// CueAligner locates a dialogue cue in the recorded audio through aligned
// words (TR-3). An unreliable alignment is not an error: it is reported
// with Reliable false and a reason, and the line yields no candidate.
type CueAligner interface {
	Align(cue Cue) (Alignment, error)
}

// ClipMeasurer measures a clip.
type ClipMeasurer interface {
	Measure(clip Clip) (Measurement, error)
}

// FindingsWriter is the findings store role Save needs.
// *findings.Store satisfies it.
type FindingsWriter interface {
	SaveAnalyzerFindings(analyzer, scope string, fresh []findings.Finding) ([]findings.Finding, error)
}

// Alignment is where a cue was read: the audio to measure, the source
// identity a finding navigates by, and the project time range.
type Alignment struct {
	Reliable  bool
	Reason    string
	Clip      Clip
	Source    findings.Source
	TimeRange findings.TimeRange
}
