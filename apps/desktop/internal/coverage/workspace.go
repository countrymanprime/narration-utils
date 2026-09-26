package coverage

import (
	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// AlignmentParagraph is one of the chapter's paragraphs, for the workspace to
// show against the tokens.
type AlignmentParagraph struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

// AlignmentItem is one manifest item's current played range, joined by item
// GUID against the saved project (tracks.Item's edit-and-proof-workspace PRD
// Phase 1 fields: TakeGUID, SourceStart, PlayRate). Live is false when the
// saved project no longer has an item with this GUID (deleted, or the track
// relinked): the workspace can still show the item's tokens, but cannot map
// them to a played range or send a REAPER command for them any more.
type AlignmentItem struct {
	Index       int     `json:"index"`
	ItemGUID    string  `json:"itemGuid"`
	Live        bool    `json:"live"`
	TakeGUID    string  `json:"takeGuid,omitempty"`
	SourceStart float64 `json:"sourceStart,omitempty"`
	PlayRate    float64 `json:"playRate,omitempty"`
	Position    float64 `json:"position,omitempty"`
	Length      float64 `json:"length,omitempty"`
}

// AlignmentView is a chapter's stored word alignment (edit-and-proof-workspace
// PRD Phase 1, ADR 0242) as the WorkspaceAlignment binding sends it: the same
// state, reasons and basis CoverageResult answers (an alignment is only ever
// as current as the coverage result it was written with), the chapter's
// paragraphs, the per-token alignment and extra runs, and each analyzed
// item's current played range. NeedsAlignAgain is set when the newest current
// or stale result has no stored alignment yet (align-again re-aligns from
// cached words alone, EP3 C, without running the check again).
type AlignmentView struct {
	ChapterID       string                  `json:"chapterId"`
	State           evidence.EvaluatorState `json:"state"`
	Reasons         []string                `json:"reasons"`
	Basis           *BasisView              `json:"basis,omitempty"`
	NeedsAlignAgain bool                    `json:"needsAlignAgain"`
	Paragraphs      []AlignmentParagraph    `json:"paragraphs"`
	Tokens          []TokenLine             `json:"tokens"`
	Extras          []ExtraLine             `json:"extras"`
	Items           []AlignmentItem         `json:"items"`
}

// Alignment reads a chapter's stored word alignment back and joins it with
// the chapter's current paragraphs and its items' current played ranges. It
// never runs anything (Q14), exactly like Result, whose state, reasons and
// basis it shares: an alignment newer than the coverage result it came from
// cannot exist, so a chapter that is current, stale or never for Result reads
// exactly the same way here.
func (s *Service) Alignment(chapterID string, alignment AlignmentParams) (AlignmentView, error) {
	result, err := s.Result(chapterID, alignment)
	if err != nil {
		return AlignmentView{}, err
	}
	view := AlignmentView{ChapterID: chapterID, State: result.State, Reasons: nonNil(result.Reasons)}
	if result.Basis != nil {
		view.Basis = &BasisView{Label: result.Basis.Label, ModifiedAt: result.Basis.ProjectFile.ModTime, Stale: result.Basis.Stale}
	}
	if result.Result == nil {
		return view, nil
	}
	report := result.Result.Report
	view.NeedsAlignAgain = !report.HasAlignment()
	view.Tokens, view.Extras = nonNil(report.Tokens), nonNil(report.Extras)
	paragraphs, err := s.chapterParagraphs(chapterID)
	if err != nil {
		return AlignmentView{}, err
	}
	view.Paragraphs = paragraphs
	project, _, err := s.savedProject()
	if err != nil {
		return AlignmentView{}, err
	}
	view.Items = alignmentItems(report.Items, project)
	return view, nil
}

// chapterParagraphs is the chapter's paragraph texts, in manuscript order:
// chapterBasis (chapter.go) hashes the same paragraphs but keeps only the
// hash, so this reads them again for the text itself.
func (s *Service) chapterParagraphs(chapterID string) ([]AlignmentParagraph, error) {
	if s.config.LoadManuscript == nil {
		return nil, unknown(ReasonNoManuscript, "import a manuscript before reading the chapter's alignment")
	}
	data, err := s.config.LoadManuscript()
	if err != nil {
		return nil, unknown(ReasonNoManuscript, err.Error())
	}
	var paragraphs []AlignmentParagraph
	rawParagraphs, _ := data["paragraphs"].([]any)
	for _, raw := range rawParagraphs {
		paragraph, _ := raw.(map[string]any)
		if owner, _ := paragraph["chapterId"].(string); owner != chapterID {
			continue
		}
		id, _ := paragraph["id"].(string)
		text, _ := paragraph["text"].(string)
		paragraphs = append(paragraphs, AlignmentParagraph{ID: id, Text: text})
	}
	return nonNil(paragraphs), nil
}

// alignmentItems joins the stored report's items (COVERAGE_ITEM lines, one
// per manifest item, muted ones included) to their current played range in
// the saved project, by item GUID.
func alignmentItems(items []ItemLine, project tracks.Project) []AlignmentItem {
	out := make([]AlignmentItem, 0, len(items))
	for _, line := range items {
		view := AlignmentItem{Index: line.Index, ItemGUID: line.ItemGUID}
		if _, item, ok := project.ItemByGUID(line.ItemGUID); ok {
			view.Live = true
			view.TakeGUID, view.SourceStart, view.PlayRate = item.TakeGUID, item.SourceStart, item.PlayRate
			view.Position, view.Length = item.Position, item.Length
		}
		out = append(out, view)
	}
	return out
}
