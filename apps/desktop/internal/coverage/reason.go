package coverage

import (
	"errors"
	"fmt"
)

// Reason is a typed cause for a chapter whose coverage cannot be measured (or
// read as current) right now. The PRD's signal maps every one of them to
// `unknown` (D2: unknown is never met); the UI (Phase 6) names it.
type Reason string

const (
	ReasonNoProject          Reason = "no_project"
	ReasonNoProjectFile      Reason = "no_project_file"
	ReasonProjectUnreadable  Reason = "project_unreadable"
	ReasonNoManuscript       Reason = "no_manuscript"
	ReasonChapterNotFound    Reason = "chapter_not_found"
	ReasonNotNarration       Reason = "not_narration"
	ReasonUnmapped           Reason = "unmapped"
	ReasonMultipleTracks     Reason = "multiple_tracks"
	ReasonMappedTrackMissing Reason = "mapped_track_missing"
	ReasonNoItems            Reason = "no_items"
	ReasonUnsupportedItem    Reason = "unsupported_item"
	ReasonSourceMissing      Reason = "source_missing"
	ReasonItemUnreadable     Reason = "item_unreadable"
	ReasonBusy               Reason = "busy"
	ReasonSidecarMissing     Reason = "sidecar_missing"
	ReasonInvalidParams      Reason = "invalid_params"
	// ReasonManuscriptChanged is a staleness reason of the result reader: the
	// record's document id or chapter text hash no longer matches.
	ReasonManuscriptChanged Reason = "manuscript_changed"
	// ReasonResultMissing is a result reader reason: the ledger has a complete
	// record but its stored report cannot be read.
	ReasonResultMissing Reason = "result_missing"
)

// UnknownError is a refusal with a typed Reason: nothing was run and nothing
// was written.
type UnknownError struct {
	Reason Reason
	Detail string
}

func (e *UnknownError) Error() string { return e.Detail }

func unknown(reason Reason, detail string) error {
	return &UnknownError{Reason: reason, Detail: detail}
}

func unknownf(reason Reason, format string, args ...any) error {
	return unknown(reason, fmt.Sprintf(format, args...))
}

// ReasonOf returns err's Reason when it is (or wraps) an UnknownError.
func ReasonOf(err error) (Reason, bool) {
	var refusal *UnknownError
	if errors.As(err, &refusal) {
		return refusal.Reason, true
	}
	return "", false
}
