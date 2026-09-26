package editing

import (
	"testing"
)

func TestEmptySpaceFindingShape(t *testing.T) {
	candidate := EmptySpaceCandidate{
		Range: TimelineInterval{Start: 4, End: 7}, Class: ClassGap,
		Parts: []CandidatePart{
			{Kind: PartItemSilence, ItemGUID: "item-a", SourceStart: 4, SourceEnd: 5, Length: 1},
			{Kind: PartTrackGap, Length: 1},
			{Kind: PartItemSilence, ItemGUID: "item-b", SourceStart: 0, SourceEnd: 1, Length: 1},
		},
		ItemGUIDs: []string{"item-a", "item-b"},
	}
	files := map[string]string{"item-a": "/audio/a.wav", "item-b": "/audio/b.wav"}
	takes := map[string]string{"item-a": "take-a", "item-b": "take-b"}
	policy := Policy{MaxGapSeconds: sec(2)}

	finding := EmptySpaceFinding("doc-1", "chapter-1", "Chapter One", candidate, files, takes, policy)
	if err := finding.Validate(); err != nil {
		t.Fatalf("finding failed Validate(): %v\n%+v", err, finding)
	}
	if finding.Category != "silence_cleanup" {
		t.Fatalf("Category = %q, want silence_cleanup", finding.Category)
	}
	if finding.Evidence["class"] != "silence" {
		t.Fatalf("Evidence[class] = %v, want \"silence\"", finding.Evidence["class"])
	}
	if finding.Source.ItemGUID != "item-a" || finding.Source.File != "/audio/a.wav" || finding.Source.TakeGUID != "take-a" {
		t.Fatalf("Source = %+v, want the first touched item", finding.Source)
	}
	if finding.TimeRange == nil || finding.TimeRange.Start != 4 || finding.TimeRange.End != 7 {
		t.Fatalf("TimeRange = %+v, want project-seconds [4,7)", finding.TimeRange)
	}
	if finding.TimeRange.SourceStart == nil || *finding.TimeRange.SourceStart != 0 || finding.TimeRange.SourceEnd == nil || *finding.TimeRange.SourceEnd != 5 {
		t.Fatalf("TimeRange source-relative = [%v,%v), want [0,5) (widest item_silence part span)", finding.TimeRange.SourceStart, finding.TimeRange.SourceEnd)
	}
	if finding.Manuscript == nil || finding.Manuscript.ChapterID != "chapter-1" {
		t.Fatalf("Manuscript = %+v, want chapter-1", finding.Manuscript)
	}
	if finding.SuggestedAction == nil || !finding.SuggestedAction.RequiresConfirmation {
		t.Fatalf("SuggestedAction = %+v, want a confirmation-required proposal", finding.SuggestedAction)
	}
	if finding.Review.Status != "unreviewed" {
		t.Fatalf("Review.Status = %q, want unreviewed", finding.Review.Status)
	}
}

// TestEmptySpaceFindingIDStableAcrossUnrelatedMoves proves the Q7 B property
// this package aims for: two candidates with the same parts (same item
// GUIDs, same source-relative ranges) but a different outer timeline Range
// (as if an earlier, unrelated item in the chapter moved, shifting every
// later item's timeline position) must get the same finding ID.
func TestEmptySpaceFindingIDStableAcrossUnrelatedMoves(t *testing.T) {
	base := EmptySpaceCandidate{
		Class:     ClassGap,
		Parts:     []CandidatePart{{Kind: PartItemSilence, ItemGUID: "item-a", SourceStart: 1, SourceEnd: 2, Length: 1}},
		ItemGUIDs: []string{"item-a"},
	}
	shifted := base
	shifted.Range = TimelineInterval{Start: 100, End: 101} // only the timeline position differs

	base.Range = TimelineInterval{Start: 4, End: 5}
	idBase := EmptySpaceEvidenceVersion(base)
	idShifted := EmptySpaceEvidenceVersion(shifted)
	if idBase != idShifted {
		t.Fatalf("EmptySpaceEvidenceVersion differed after only the timeline position changed: %q vs %q", idBase, idShifted)
	}
}

// TestEmptySpaceFindingIDChangesWithSourceRange proves the other half: the
// version DOES change when the actual audio content (source-relative range)
// changes, so a re-scan after the narrator actually edited that stretch asks
// again rather than silently keeping an old dismissal.
func TestEmptySpaceFindingIDChangesWithSourceRange(t *testing.T) {
	a := EmptySpaceCandidate{Class: ClassGap, Parts: []CandidatePart{{Kind: PartItemSilence, ItemGUID: "item-a", SourceStart: 1, SourceEnd: 2, Length: 1}}}
	b := EmptySpaceCandidate{Class: ClassGap, Parts: []CandidatePart{{Kind: PartItemSilence, ItemGUID: "item-a", SourceStart: 1, SourceEnd: 3, Length: 2}}}
	if EmptySpaceEvidenceVersion(a) == EmptySpaceEvidenceVersion(b) {
		t.Fatalf("EmptySpaceEvidenceVersion did not change when the source-relative range changed")
	}
}

func TestEmptySpaceFindingNoItemTouchHasNilSourceRange(t *testing.T) {
	candidate := EmptySpaceCandidate{
		Range: TimelineInterval{Start: 0, End: 3}, Class: ClassHead,
		Parts: []CandidatePart{{Kind: PartTrackGap, Length: 3}},
	}
	finding := EmptySpaceFinding("doc-1", "chapter-1", "Chapter One", candidate, nil, nil, Policy{HeadMaxSeconds: sec(1)})
	if finding.TimeRange.SourceStart != nil || finding.TimeRange.SourceEnd != nil {
		t.Fatalf("TimeRange source-relative = [%v,%v), want nil,nil (no item touches this candidate)", finding.TimeRange.SourceStart, finding.TimeRange.SourceEnd)
	}
	if err := finding.Validate(); err != nil {
		t.Fatalf("finding failed Validate(): %v", err)
	}
}
