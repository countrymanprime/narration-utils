package evidence

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// Mapping store v2 (daw-chapter-track-auto-sync PRD Phase 2): every link says
// where it came from, an undone auto-link is remembered so sync never makes it
// again, and a re-import carries the old links forward for re-linking.

func TestAConfirmedLinkIsManualWithNoMatch(t *testing.T) {
	store := NewMappingStore(t.TempDir())
	mapping, err := store.Confirm("doc-1", "track-a", "c-0001", "Chapter One")
	if err != nil {
		t.Fatal(err)
	}
	if mapping.Origin != OriginManual || mapping.Match != nil {
		t.Fatalf("Confirm = %#v, want a manual link with no match", mapping)
	}
	set, err := store.SetChapter("doc-1", "c-0002", "Chapter Two", "track-b")
	if err != nil {
		t.Fatal(err)
	}
	if set.Link.Origin != OriginManual {
		t.Fatalf("SetChapter = %#v, want a manual link", set.Link)
	}
}

func TestAVersionOneFileReadsAsManualLinks(t *testing.T) {
	project := t.TempDir()
	path := MappingFile(project)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	v1 := `{"schemaVersion":1,"documentId":"doc-1","mappings":[{"trackGuid":"track-a","chapterId":"c-0001","chapterTitle":"Chapter One","confirmedAt":"2026-01-01T00:00:00Z"}]}`
	if err := os.WriteFile(path, []byte(v1), 0o600); err != nil {
		t.Fatal(err)
	}
	list, err := NewMappingStore(project).List("doc-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].Origin != OriginManual {
		t.Fatalf("List = %#v, want the v1 link read as manual", list)
	}
}

func TestAutoLinkWritesAutoLinksWithTheirMatch(t *testing.T) {
	store := NewMappingStore(t.TempDir())
	written, err := store.AutoLink("doc-1", []AutoLinkRequest{
		{TrackGUID: "track-a", ChapterID: "c-0001", ChapterTitle: "Chapter One", Match: LinkMatch{Score: 1, Kind: MatchExact}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(written) != 1 || written[0].Origin != OriginAuto || written[0].Match == nil || written[0].Match.Kind != MatchExact {
		t.Fatalf("AutoLink = %#v", written)
	}
	list, _ := store.List("doc-1")
	if len(list) != 1 || list[0].Origin != OriginAuto || list[0].ConfirmedAt.IsZero() {
		t.Fatalf("List = %#v", list)
	}
}

func TestAutoLinkNeverOverwritesALinkedTrackOrChapter(t *testing.T) {
	store := NewMappingStore(t.TempDir())
	if _, err := store.Confirm("doc-1", "track-a", "c-0001", "Chapter One"); err != nil {
		t.Fatal(err)
	}
	written, err := store.AutoLink("doc-1", []AutoLinkRequest{
		{TrackGUID: "track-a", ChapterID: "c-0002", ChapterTitle: "Chapter Two"},
		{TrackGUID: "track-b", ChapterID: "c-0001", ChapterTitle: "Chapter One"},
		{TrackGUID: "track-c", ChapterID: "c-0003", ChapterTitle: "Chapter Three"},
		{TrackGUID: "track-d", ChapterID: "c-0003", ChapterTitle: "Chapter Three"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(written) != 1 || written[0].TrackGUID != "track-c" {
		t.Fatalf("AutoLink wrote %#v, want only track-c (a free track to a free chapter, first one wins)", written)
	}
	list, _ := store.List("doc-1")
	if len(list) != 2 {
		t.Fatalf("List = %#v", list)
	}
	for _, link := range list {
		if link.TrackGUID == "track-a" && (link.ChapterID != "c-0001" || link.Origin != OriginManual) {
			t.Fatalf("the manual link changed: %#v", link)
		}
	}
}

func TestUndoRemovesAnAutoLinkAndRejectsThePair(t *testing.T) {
	store := NewMappingStore(t.TempDir())
	if _, err := store.AutoLink("doc-1", []AutoLinkRequest{{TrackGUID: "track-a", ChapterID: "c-0001", ChapterTitle: "Chapter One"}}); err != nil {
		t.Fatal(err)
	}
	undone, err := store.Undo("doc-1", "track-a")
	if err != nil {
		t.Fatal(err)
	}
	if undone.ChapterID != "c-0001" {
		t.Fatalf("Undo = %#v", undone)
	}
	if list, _ := store.List("doc-1"); len(list) != 0 {
		t.Fatalf("List after Undo = %#v", list)
	}
	rejected, _ := store.Rejected("doc-1")
	if len(rejected) != 1 || rejected[0].TrackGUID != "track-a" || rejected[0].ChapterTitle != "Chapter One" || rejected[0].RejectedAt.IsZero() {
		t.Fatalf("Rejected = %#v", rejected)
	}
	again, err := store.AutoLink("doc-1", []AutoLinkRequest{{TrackGUID: "track-a", ChapterID: "c-0001", ChapterTitle: "Chapter One"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(again) != 0 {
		t.Fatalf("a rejected pair was linked again: %#v", again)
	}
}

func TestUndoRefusesAManualLinkAndAnUnlinkedTrack(t *testing.T) {
	store := NewMappingStore(t.TempDir())
	if _, err := store.Confirm("doc-1", "track-a", "c-0001", "Chapter One"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Undo("doc-1", "track-a"); err == nil {
		t.Fatal("Undo removed a manual link")
	}
	if _, err := store.Undo("doc-1", "track-z"); err == nil {
		t.Fatal("Undo on an unlinked track did not refuse")
	}
	if list, _ := store.List("doc-1"); len(list) != 1 {
		t.Fatalf("List = %#v", list)
	}
}

func TestClearingALinkOfEitherOriginRejectsThePair(t *testing.T) {
	store := NewMappingStore(t.TempDir())
	if _, err := store.AutoLink("doc-1", []AutoLinkRequest{{TrackGUID: "track-a", ChapterID: "c-0001", ChapterTitle: "Chapter One"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Confirm("doc-1", "track-b", "c-0002", "Chapter Two"); err != nil {
		t.Fatal(err)
	}
	if err := store.Clear("doc-1", "track-a"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ClearChapter("doc-1", "c-0002"); err != nil {
		t.Fatal(err)
	}
	rejected, _ := store.Rejected("doc-1")
	if len(rejected) != 2 || !isRejected(rejected, "track-a", "Chapter One") || !isRejected(rejected, "track-b", "Chapter Two") {
		t.Fatalf("Rejected = %#v, want both cleared links", rejected)
	}
}

func TestConfirmingARejectedPairLiftsTheRejection(t *testing.T) {
	store := NewMappingStore(t.TempDir())
	if _, err := store.AutoLink("doc-1", []AutoLinkRequest{{TrackGUID: "track-a", ChapterID: "c-0001", ChapterTitle: "Chapter One"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Undo("doc-1", "track-a"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Confirm("doc-1", "track-a", "c-0001", "Chapter One"); err != nil {
		t.Fatal(err)
	}
	if rejected, _ := store.Rejected("doc-1"); len(rejected) != 0 {
		t.Fatalf("Rejected = %#v, want the narrator's own link to lift it", rejected)
	}
}

func TestCarryOverKeepsTheOldLinksAndRejectionsForTheNewDocument(t *testing.T) {
	project := t.TempDir()
	store := NewMappingStore(project)
	if _, err := store.Confirm("doc-old", "track-a", "c-0001", "Chapter One"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.AutoLink("doc-old", []AutoLinkRequest{{TrackGUID: "track-b", ChapterID: "c-0002", ChapterTitle: "Chapter Two"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Undo("doc-old", "track-b"); err != nil {
		t.Fatal(err)
	}

	carry := ReadCarryOver(project)
	if err := os.Remove(MappingFile(project)); err != nil { // resetDerived's part
		t.Fatal(err)
	}
	if err := store.Carry("doc-new", carry); err != nil {
		t.Fatal(err)
	}

	if list, _ := store.List("doc-new"); len(list) != 0 {
		t.Fatalf("List = %#v, want no links until a sync re-links them", list)
	}
	previous, _ := store.Previous("doc-new")
	if len(previous) != 1 || previous[0].TrackGUID != "track-a" || previous[0].ChapterTitle != "Chapter One" {
		t.Fatalf("Previous = %#v", previous)
	}
	rejected, _ := store.Rejected("doc-new")
	if len(rejected) != 1 || rejected[0].TrackGUID != "track-b" {
		t.Fatalf("Rejected = %#v", rejected)
	}
	if previous, _ := store.Previous("doc-other"); len(previous) != 0 {
		t.Fatalf("another document read the carried links: %#v", previous)
	}
}

func TestCarryOverOfAProjectWithNoMappingIsEmpty(t *testing.T) {
	carry := ReadCarryOver(t.TempDir())
	if len(carry.Links) != 0 || len(carry.Rejected) != 0 {
		t.Fatalf("carry = %#v", carry)
	}
}

func TestTheFileIsWrittenAtVersionTwoWithOriginAndMatch(t *testing.T) {
	project := t.TempDir()
	store := NewMappingStore(project)
	if _, err := store.AutoLink("doc-1", []AutoLinkRequest{{TrackGUID: "track-a", ChapterID: "c-0001", ChapterTitle: "Chapter One", Match: LinkMatch{Score: 0.95, Kind: MatchContained}}}); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(MappingFile(project))
	if err != nil {
		t.Fatal(err)
	}
	var shape struct {
		SchemaVersion int `json:"schemaVersion"`
		Mappings      []struct {
			Origin string `json:"origin"`
			Match  struct {
				Score float64 `json:"score"`
				Kind  string  `json:"kind"`
			} `json:"match"`
		} `json:"mappings"`
	}
	if err := json.Unmarshal(raw, &shape); err != nil {
		t.Fatal(err)
	}
	if shape.SchemaVersion != 2 || len(shape.Mappings) != 1 || shape.Mappings[0].Origin != "auto" || shape.Mappings[0].Match.Kind != "contained" {
		t.Fatalf("file = %s", raw)
	}
}
