// Package findings implements the record shape from
// docs/architecture/findings-contract.md: the DAW-neutral boundary every
// analyzer writes and the REAPER dashboard reads. It deliberately covers only
// the record, its validation, stable identity, and review state. Analyzers
// build findings without importing REAPER APIs, and a finding may suggest an
// action but never executes one.
package findings

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"slices"
	"strconv"
)

// SchemaVersion is the only record version this package reads or writes.
const SchemaVersion = 1

// stableIDBytes is how much of the SHA-256 digest a finding ID keeps.
const stableIDBytes = 12

type Category string

const (
	CategoryTranscriptDiscrepancy Category = "transcript_discrepancy"
	CategoryPronunciation         Category = "pronunciation"
	CategoryEntity                Category = "entity"
	CategoryPickup                Category = "pickup"
	CategoryDuplicateRead         Category = "duplicate_read"
	CategoryTakeComparison        Category = "take_comparison"
	CategoryCharacterContinuity   Category = "character_continuity"
	CategoryPacing                Category = "pacing"
	CategoryAudioQuality          Category = "audio_quality"
	CategoryDeliveryQC            Category = "delivery_qc"
	CategorySilenceCleanup        Category = "silence_cleanup"
	CategoryLevelConsistency      Category = "level_consistency"
)

// Categories lists every category the contract documents.
func Categories() []Category {
	return []Category{
		CategoryTranscriptDiscrepancy, CategoryPronunciation, CategoryEntity,
		CategoryPickup, CategoryDuplicateRead, CategoryTakeComparison,
		CategoryCharacterContinuity, CategoryPacing, CategoryAudioQuality,
		CategoryDeliveryQC, CategorySilenceCleanup, CategoryLevelConsistency,
	}
}

type Severity string

const (
	SeverityInfo    Severity = "info"
	SeverityWarning Severity = "warning"
	SeverityError   Severity = "error"
)

type Status string

const (
	StatusUnreviewed Status = "unreviewed"
	StatusAccepted   Status = "accepted"
	StatusDismissed  Status = "dismissed"
	StatusDeferred   Status = "deferred"
)

// Project identifies the project a finding came from and where its
// sidecar output lives, relative to the project folder.
type Project struct {
	Path       string `json:"path,omitempty"`
	OutputPath string `json:"output_path,omitempty"`
}

// Source is the DAW-neutral audio source identity plus optional REAPER GUIDs.
// GUIDs are preferred for navigation; TimeRange is only the stale-project
// fallback.
type Source struct {
	File      string `json:"file,omitempty"`
	TrackGUID string `json:"track_guid,omitempty"`
	ItemGUID  string `json:"item_guid,omitempty"`
	TakeGUID  string `json:"take_guid,omitempty"`
}

// TimeRange is in project seconds. SourceStart and SourceEnd are the same
// window expressed as source-file-relative offsets (docs/architecture/
// findings-contract.md), which stay meaningful when the project timeline
// shifts; both are nil when the analyzer has no source-relative offsets to
// give.
type TimeRange struct {
	Start       float64  `json:"start"`
	End         float64  `json:"end"`
	SourceStart *float64 `json:"source_start,omitempty"`
	SourceEnd   *float64 `json:"source_end,omitempty"`
}

type Manuscript struct {
	ChapterID    string `json:"chapter_id,omitempty"`
	ChapterTitle string `json:"chapter_title,omitempty"`
	Expected     string `json:"expected,omitempty"`
	Recorded     string `json:"recorded,omitempty"`
	// Span locates Expected within the manuscript paragraph, closing the
	// contract's "text span" gap. Combined with ChapterID it gives a
	// manuscript-anchored id scheme everything it needs: chapter,
	// paragraph, and an ordinal for repeated matches within one paragraph.
	Span *Span `json:"span,omitempty"`
}

// Span is a manuscript-relative text locator.
type Span struct {
	ParagraphID string `json:"paragraph_id,omitempty"`
	Start       int    `json:"start,omitempty"`
	End         int    `json:"end,omitempty"`
	// Ordinal distinguishes repeats of the same expected text within one
	// paragraph (the first occurrence is 0), so the id does not collide
	// when a line repeats a word or phrase.
	Ordinal int `json:"ordinal,omitempty"`
}

// SuggestedAction is a proposal only; the REAPER adapter owns execution and
// undo blocks.
type SuggestedAction struct {
	Kind                 string         `json:"kind"`
	Parameters           map[string]any `json:"parameters,omitempty"`
	RequiresConfirmation bool           `json:"requires_confirmation"`
}

type ReviewState struct {
	Status    Status `json:"status"`
	Note      string `json:"note,omitempty"`
	Timestamp string `json:"timestamp,omitempty"`
}

type Finding struct {
	SchemaVersion int         `json:"schema_version"`
	ID            string      `json:"id"`
	Analyzer      string      `json:"analyzer"`
	Project       Project     `json:"project"`
	Source        Source      `json:"source"`
	TimeRange     *TimeRange  `json:"time_range,omitempty"`
	Manuscript    *Manuscript `json:"manuscript,omitempty"`
	Category      Category    `json:"category"`
	Severity      Severity    `json:"severity"`
	// Confidence is nullable: an analyzer that cannot produce a numeric
	// score reports that honestly (nil) rather than fabricating one
	// (findings-contract.md: "must identify uncertain or unavailable
	// evidence rather than fabricate a score"). ConfidenceReason is
	// required either way, so a nil score still explains why.
	Confidence *float64 `json:"confidence"`
	// EvidenceVersion hashes the evidence a decision was made against
	// (recorded text, source file identity, timing beyond a tolerance).
	// A store keeps a decision when the id and EvidenceVersion both match
	// a later run, and returns the finding to unreviewed (keeping the
	// earlier note) when only EvidenceVersion has changed.
	EvidenceVersion  string           `json:"evidence_version,omitempty"`
	ConfidenceReason string           `json:"confidence_reason"`
	Evidence         map[string]any   `json:"evidence,omitempty"`
	SuggestedAction  *SuggestedAction `json:"suggested_action,omitempty"`
	Review           ReviewState      `json:"review"`
	// NotInLatestRun is a store-computed merge flag, never set by an
	// analyzer: a finding the latest run did not reproduce, kept for audit
	// (findings-contract.md: dismissed findings stay auditable) rather
	// than deleted.
	NotInLatestRun bool `json:"not_in_latest_run,omitempty"`
}

// Validate reports the first way the record breaks the contract.
func (f Finding) Validate() error {
	switch {
	case f.SchemaVersion != SchemaVersion:
		return fmt.Errorf("schema_version %d is not supported (want %d)", f.SchemaVersion, SchemaVersion)
	case f.ID == "":
		return fmt.Errorf("id is required")
	case f.Analyzer == "":
		return fmt.Errorf("analyzer is required")
	case !slices.Contains(Categories(), f.Category):
		return fmt.Errorf("category %q is not a documented category", f.Category)
	case f.Severity != SeverityInfo && f.Severity != SeverityWarning && f.Severity != SeverityError:
		return fmt.Errorf("severity %q is not info, warning, or error", f.Severity)
	case f.Confidence != nil && !(*f.Confidence >= 0 && *f.Confidence <= 1): // also rejects NaN
		return fmt.Errorf("confidence %v is outside 0 to 1", *f.Confidence)
	case f.ConfidenceReason == "":
		return fmt.Errorf("confidence_reason is required so the score is explainable")
	case !validStatus(f.Review.Status):
		return fmt.Errorf("review status %q is not recognised", f.Review.Status)
	case f.TimeRange != nil && !validRange(*f.TimeRange):
		return fmt.Errorf("time_range %v to %v is not a forward, non-negative range", f.TimeRange.Start, f.TimeRange.End)
	}
	return nil
}

// validRange accepts only finite, forward, non-negative ranges; NaN fails
// every comparison, so it must be excluded explicitly. Source-relative
// offsets, when given, are checked the same way.
func validRange(r TimeRange) bool {
	if !finiteRange(r.Start, r.End) || r.Start < 0 || r.End < r.Start {
		return false
	}
	if r.SourceStart == nil && r.SourceEnd == nil {
		return true
	}
	if r.SourceStart == nil || r.SourceEnd == nil {
		return false
	}
	return finiteRange(*r.SourceStart, *r.SourceEnd) && *r.SourceStart >= 0 && *r.SourceEnd >= *r.SourceStart
}

func finiteRange(start, end float64) bool {
	return !math.IsNaN(start) && !math.IsNaN(end) && !math.IsInf(start, 0) && !math.IsInf(end, 0)
}

func validStatus(status Status) bool {
	switch status {
	case StatusUnreviewed, StatusAccepted, StatusDismissed, StatusDeferred:
		return true
	}
	return false
}

// WithReview returns a copy carrying the narrator's decision. The ID is left
// untouched so a dismissed finding stays auditable rather than reappearing as
// a new one.
func (f Finding) WithReview(status Status, note, timestamp string) (Finding, error) {
	if !validStatus(status) {
		return Finding{}, fmt.Errorf("review status %q is not recognised", status)
	}
	f.Review = ReviewState{Status: status, Note: note, Timestamp: timestamp}
	return f, nil
}

// StableID derives a deterministic ID from the analyzer and the identifying
// parts of a finding, so re-running an analyzer on unchanged evidence yields
// the same ID. Each part is length-prefixed so ("ab","c") and ("a","bc")
// cannot collide.
func StableID(analyzer string, parts ...string) string {
	hash := sha256.New()
	for _, part := range append([]string{analyzer}, parts...) {
		hash.Write([]byte(strconv.Itoa(len(part))))
		hash.Write([]byte{':'})
		hash.Write([]byte(part))
	}
	return hex.EncodeToString(hash.Sum(nil)[:stableIDBytes])
}
