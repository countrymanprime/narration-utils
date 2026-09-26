package coverage

import "fmt"

// tokenStatuses are every status a COVERAGE_TOKEN line carries: the check's
// own read/misread/heading (recording_coverage.READ, MISREAD, HEADING_STATUS)
// plus the region kinds a missing token takes (regionKinds, report.go).
var tokenStatuses = map[string]bool{
	"read": true, "misread": true, "heading": true,
	"head": true, "tail": true, "skip": true, "short_read": true, "different_text": true,
}

// heardStatuses are the statuses a token may be heard for: an audio item,
// start and end are set only for these (coverage_mode._alignment_lines).
var heardStatuses = map[string]bool{"read": true, "misread": true, "heading": true}

// TokenLine is one COVERAGE_TOKEN line (edit-and-proof-workspace PRD Phase 1,
// ADR 0242): one chapter token as the check aligned it. ParagraphID is nil for
// a title or subtitle token (recording_coverage.HEADING); Word is the ordinal
// of its whitespace word in that paragraph's (or the heading's) text, so a
// screen finds it with text.split()[w] rather than re-tokenizing. Item, Start
// and End are nil for a token nothing was heard for (a missing region, or an
// optional heading never read); Heard is set only for a misread.
type TokenLine struct {
	Index       int      `json:"i"`
	ParagraphID *string  `json:"p"`
	Word        int      `json:"w"`
	Text        string   `json:"text"`
	Status      string   `json:"status"`
	Heard       *string  `json:"heard"`
	Item        *int     `json:"item"`
	Start       *float64 `json:"start"`
	End         *float64 `json:"end"`
}

// ExtraLine is one COVERAGE_EXTRA line: one run of transcript words the
// chapter's tokens do not account for (a retake, a false start, an aside).
// AfterToken is the doc token index of the last token heard before this run,
// or nil when the run comes before anything was heard.
type ExtraLine struct {
	Text       string         `json:"text"`
	Tokens     int            `json:"tokens"`
	Start      RegionPosition `json:"start"`
	End        RegionPosition `json:"end"`
	AfterToken *int           `json:"afterToken"`
}

// HasAlignment reports whether the results carry the per-token alignment at
// all: false for a report stored before the sidecar wrote COVERAGE_TOKEN
// lines (ADR 0242 shipped them as additive output, so an older stored result,
// or one from a sidecar run before this PRD's slice landed, has none). The
// read binding answers such a report with needsAlignAgain, since align-again
// re-aligns from cached words alone (EP3 C) rather than re-running the check.
func (r Report) HasAlignment() bool {
	return len(r.Tokens) > 0
}

// checkAlignment validates the COVERAGE_TOKEN and COVERAGE_EXTRA lines a
// results file carried, when it carried any: a token's status is one the
// check assigns, its index is its position in the file (the sidecar writes
// them in order), and it names a source position only when its status is one
// that may be heard. An extra run's token count must be positive and its
// AfterToken, when set, must name an earlier token.
func (r Report) checkAlignment() error {
	for i, token := range r.Tokens {
		if !tokenStatuses[token.Status] {
			return fmt.Errorf("coverage token %d has an invalid %q status", i, token.Status)
		}
		if token.Index != i {
			return fmt.Errorf("coverage token %d is out of order (index %d)", i, token.Index)
		}
		heard := token.Item != nil && token.Start != nil && token.End != nil
		if heard && !heardStatuses[token.Status] {
			return fmt.Errorf("coverage token %d (%s) has a source position it should not", i, token.Status)
		}
		if token.Heard != nil && token.Status != "misread" {
			return fmt.Errorf("coverage token %d (%s) has a heard word it should not", i, token.Status)
		}
	}
	for i, extra := range r.Extras {
		if extra.Tokens <= 0 {
			return fmt.Errorf("coverage extra run %d has no tokens", i)
		}
		if extra.AfterToken != nil && (*extra.AfterToken < 0 || *extra.AfterToken >= len(r.Tokens)) {
			return fmt.Errorf("coverage extra run %d follows a token index out of range", i)
		}
	}
	return nil
}
