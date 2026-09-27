package preview

import (
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

const testSourceHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

func TestMapParagraphsToTimeMapsAStampedItemAtTheCurrentSourceHash(t *testing.T) {
	items := []StampedItem{
		{ItemGUID: "g1", LineID: composeLineID("p-000001", testSourceHash), Position: 12.5, Length: 3.25},
	}
	got := MapParagraphsToTime(items, testSourceHash, []string{"p-000001"})
	m, ok := got["p-000001"]
	if !ok || !m.Mapped {
		t.Fatalf("MapParagraphsToTime = %+v, want p-000001 mapped", got)
	}
	if m.Range.Start != 12.5 || m.Range.Length != 3.25 {
		t.Fatalf("Range = %+v, want Start 12.5 Length 3.25", m.Range)
	}
}

func TestMapParagraphsToTimeAnswersUnmappedForAParagraphNoItemNames(t *testing.T) {
	got := MapParagraphsToTime(nil, testSourceHash, []string{"p-000001"})
	m := got["p-000001"]
	if m.Mapped || m.Reason != ReasonParagraphUnmapped {
		t.Fatalf("m = %+v, want unmapped", m)
	}
}

// TestMapParagraphsToTimeAnswersStaleAfterAReimport is Q4's own currentness rule, applied here: a re-import
// changes the manuscript's source hash, so a stamp made before it can never be trusted as this paragraph's
// current time range even though exactly one item still claims it.
func TestMapParagraphsToTimeAnswersStaleAfterAReimport(t *testing.T) {
	items := []StampedItem{
		{ItemGUID: "g1", LineID: composeLineID("p-000001", "old-hash"), Position: 0, Length: 5},
	}
	got := MapParagraphsToTime(items, testSourceHash, []string{"p-000001"})
	m := got["p-000001"]
	if m.Mapped || m.Reason != ReasonParagraphStale {
		t.Fatalf("m = %+v, want stale_source", m)
	}
}

// TestMapParagraphsToTimeAnswersAmbiguousWhenTwoItemsShareAStamp is the split/duplicate case
// docs/research/reaper-spike-s0-item-extension-data.md observed against a real REAPER 7.80: both halves of a
// split, and a duplicate, keep the original's stamp - this package must never guess which one is current.
func TestMapParagraphsToTimeAnswersAmbiguousWhenTwoItemsShareAStamp(t *testing.T) {
	items := []StampedItem{
		{ItemGUID: "g1", LineID: composeLineID("p-000001", testSourceHash), Position: 0, Length: 3},
		{ItemGUID: "g2", LineID: composeLineID("p-000001", testSourceHash), Position: 3, Length: 3},
	}
	got := MapParagraphsToTime(items, testSourceHash, []string{"p-000001"})
	m := got["p-000001"]
	if m.Mapped || m.Reason != ReasonParagraphAmbiguous {
		t.Fatalf("m = %+v, want ambiguous", m)
	}
}

func TestMapParagraphsToTimeIgnoresAnUnrecognizedStampAndOtherParagraphsStayUnaffected(t *testing.T) {
	items := []StampedItem{
		{ItemGUID: "g1", LineID: "line-000002", Position: 0, Length: 3}, // no "@": an older or foreign stamp
		{ItemGUID: "g2", LineID: composeLineID("p-000002", testSourceHash), Position: 10, Length: 2},
	}
	got := MapParagraphsToTime(items, testSourceHash, []string{"p-000001", "p-000002"})
	if got["p-000001"].Mapped || got["p-000001"].Reason != ReasonParagraphUnmapped {
		t.Fatalf("p-000001 = %+v, want unmapped (the unrecognized stamp names no paragraph)", got["p-000001"])
	}
	if !got["p-000002"].Mapped {
		t.Fatalf("p-000002 = %+v, want mapped - an unrelated unrecognized stamp must not affect it", got["p-000002"])
	}
}

// TestMapParagraphsToTimeAgainstARealReaperSavedFixture is Phase 6's own scope: "REAPER-saved fixtures". This
// project (internal/tracks/testdata/reaper/line-identity.rpp) was written by REAPER 7.80 itself against the
// real bridge (docs/research/reaper-spike-s0-item-extension-data.md): one item stamped, then split, duplicated
// and chunk-copied, so four items carry the identical raw stamp "line-000002" - a real example of both the
// unrecognized-scheme case (no manuscript existed for this spike, so the id is not "<paragraph>@<hash>") and the
// same-stamp-on-several-items case, in one file, from real REAPER behaviour rather than a hand-built fixture.
func TestMapParagraphsToTimeAgainstARealReaperSavedFixture(t *testing.T) {
	project, err := tracks.Parse(filepath.Join("..", "tracks", "testdata", "reaper", "line-identity.rpp"))
	if err != nil {
		t.Fatalf("parsing the real REAPER-saved fixture: %v", err)
	}
	var items []StampedItem
	for _, track := range project.Tracks {
		for _, item := range track.Items {
			lineID, ok := item.Ext["narration_utils_line_id"]
			if !ok {
				continue
			}
			items = append(items, StampedItem{ItemGUID: item.GUID, LineID: lineID, Position: item.Position, Length: item.Length})
		}
	}
	if len(items) < 2 {
		t.Fatalf("expected the fixture's several stamped items, got %d", len(items))
	}
	got := MapParagraphsToTime(items, testSourceHash, []string{"p-000001"})
	if got["p-000001"].Mapped {
		t.Fatalf("a spike fixture with no manuscript behind it must never map to a real paragraph: %+v", got["p-000001"])
	}
}
