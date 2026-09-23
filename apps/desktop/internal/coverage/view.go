package coverage

import (
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
)

// RefusalReasons are every Reason a refusal or the result reader can name, in
// a fixed order: the UI's schema lists the same words (a contract test pins
// them), so a new Reason is a contract change.
var RefusalReasons = []Reason{
	ReasonNoProject, ReasonNoProjectFile, ReasonProjectUnreadable, ReasonNoManuscript, ReasonChapterNotFound,
	ReasonNotNarration, ReasonUnmapped, ReasonMultipleTracks, ReasonMappedTrackMissing, ReasonNoItems,
	ReasonUnsupportedItem, ReasonSourceMissing, ReasonItemUnreadable, ReasonBusy, ReasonSidecarMissing,
	ReasonInvalidParams, ReasonManuscriptChanged, ReasonResultMissing,
}

// ResultView is a ChapterResult as the CoverageResult binding sends it
// (recording-coverage-analysis.prd.md Phase 5): the state and its reasons, the
// basis every result states (Q8), which run it is, and the stored report with
// the labels the parameter hash leaves out (model and language, Q13). The
// ledger record's fingerprints and the stored hashes stay in the host.
type ResultView struct {
	ChapterID string                  `json:"chapterId"`
	State     evidence.EvaluatorState `json:"state"`
	Reasons   []string                `json:"reasons"`
	Basis     *BasisView              `json:"basis,omitempty"`
	Record    *RecordView             `json:"record,omitempty"`
	Result    *ReportView             `json:"result,omitempty"`
	// RecordedFraction is the chapter's share of body words present, only for
	// a current result (D11): the same number the chapter payload carries.
	RecordedFraction *float64 `json:"recordedFraction,omitempty"`
}

// BasisView is "saved project, file modified <time>" and whether the saved
// file is older than the newest evidence or audio (Q8 B).
type BasisView struct {
	Label      string    `json:"label"`
	ModifiedAt time.Time `json:"modifiedAt"`
	Stale      bool      `json:"stale"`
}

// RecordView names the ledger record a result was compared against.
type RecordView struct {
	ID          string                 `json:"id"`
	Outcome     evidence.LedgerOutcome `json:"outcome"`
	StartedAt   time.Time              `json:"startedAt"`
	CompletedAt time.Time              `json:"completedAt"`
}

// ReportView is a stored report: counts, per-item, per-paragraph and region
// lines as the sidecar wrote them, and how the words were made.
type ReportView struct {
	Model             string          `json:"model"`
	Language          string          `json:"language,omitempty"`
	Alignment         AlignmentParams `json:"alignment"`
	BodyTokens        int             `json:"bodyTokens"`
	PresentTokens     int             `json:"presentTokens"`
	MissingTokens     int             `json:"missingTokens"`
	ExtraTokens       int             `json:"extraTokens"`
	LongestMissingRun int             `json:"longestMissingRun"`
	PlayedSeconds     float64         `json:"playedSeconds"`
	Items             []ItemLine      `json:"items"`
	Paragraphs        []ParagraphLine `json:"paragraphs"`
	Regions           []RegionLine    `json:"regions"`
}

// View is the result as the binding sends it.
func (r ChapterResult) View(chapterID string) ResultView {
	view := ResultView{ChapterID: chapterID, State: r.State, Reasons: r.Reasons}
	if view.Reasons == nil {
		view.Reasons = []string{}
	}
	if r.Basis != nil {
		view.Basis = &BasisView{Label: r.Basis.Label, ModifiedAt: r.Basis.ProjectFile.ModTime, Stale: r.Basis.Stale}
	}
	if r.Record != nil {
		view.Record = &RecordView{ID: r.Record.ID, Outcome: r.Record.Outcome, StartedAt: r.Record.StartedAt, CompletedAt: r.Record.CompletedAt}
	}
	if r.Result != nil {
		report := r.Result.Report
		view.Result = &ReportView{
			Model: r.Result.Model, Language: r.Result.Language, Alignment: r.Result.Alignment,
			BodyTokens: report.Summary.BodyTokens, PresentTokens: report.Summary.PresentTokens,
			MissingTokens: report.Summary.MissingTokens, ExtraTokens: report.Summary.ExtraTokens,
			LongestMissingRun: report.Summary.LongestMissingRun, PlayedSeconds: report.Summary.Items.PlayedSeconds,
			Items: nonNil(report.Items), Paragraphs: nonNil(report.Paragraphs), Regions: regionViews(report.Regions),
		}
	}
	if r.Current() {
		fraction := r.Result.Report.PresentFraction()
		view.RecordedFraction = &fraction
	}
	return view
}

// regionViews copies the regions with a list, never null, of paragraph ids.
func regionViews(regions []RegionLine) []RegionLine {
	views := make([]RegionLine, 0, len(regions))
	for _, region := range regions {
		region.ParagraphIDs = nonNil(region.ParagraphIDs)
		views = append(views, region)
	}
	return views
}

func nonNil[T any](values []T) []T {
	if values == nil {
		return []T{}
	}
	return values
}
