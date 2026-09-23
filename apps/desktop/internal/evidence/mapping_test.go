package evidence

import (
	"os"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/chaptermatch"
)

// --- Confirm / List / Get round trip ---

func TestConfirmThenListReturnsTheConfirmedLink(t *testing.T) {
	store := NewMappingStore(t.TempDir())
	mapping, err := store.Confirm("doc-1", "track-guid-a", "c-0001", "Chapter One")
	if err != nil {
		t.Fatal(err)
	}
	if mapping.TrackGUID != "track-guid-a" || mapping.ChapterID != "c-0001" || mapping.ChapterTitle != "Chapter One" {
		t.Fatalf("Confirm returned %#v", mapping)
	}
	if mapping.ConfirmedAt.IsZero() {
		t.Fatal("Confirm did not stamp ConfirmedAt")
	}

	list, err := store.List("doc-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].TrackGUID != "track-guid-a" || list[0].ChapterID != "c-0001" {
		t.Fatalf("List = %#v", list)
	}
}

func TestGetReturnsOneConfirmedLinkByTrackGUID(t *testing.T) {
	store := NewMappingStore(t.TempDir())
	if _, err := store.Confirm("doc-1", "track-guid-a", "c-0001", "Chapter One"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Confirm("doc-1", "track-guid-b", "c-0002", "Chapter Two"); err != nil {
		t.Fatal(err)
	}

	got, ok := store.Get("doc-1", "track-guid-b")
	if !ok {
		t.Fatal("Get(track-guid-b) not found")
	}
	if got.ChapterID != "c-0002" {
		t.Fatalf("Get returned %#v", got)
	}
	if _, ok := store.Get("doc-1", "does-not-exist"); ok {
		t.Fatal("Get on an unlinked track reported found")
	}
}

func TestConfirmAgainForTheSameTrackReplacesItsLink(t *testing.T) {
	store := NewMappingStore(t.TempDir())
	if _, err := store.Confirm("doc-1", "track-guid-a", "c-0001", "Chapter One"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Confirm("doc-1", "track-guid-a", "c-0002", "Chapter Two"); err != nil {
		t.Fatal(err)
	}

	list, err := store.List("doc-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 {
		t.Fatalf("List = %#v, want one entry (re-confirming replaces, not appends)", list)
	}
	if list[0].ChapterID != "c-0002" || list[0].ChapterTitle != "Chapter Two" {
		t.Fatalf("List[0] = %#v, want the newer confirmation", list[0])
	}
}

func TestTwoTracksMayConfirmTheSameChapter(t *testing.T) {
	// D5's "several tracks per chapter, consumers treat that as unknown" is a
	// consumer rule (SR), not a constraint this store enforces (Phase 5
	// success signal: "two links to one chapter are reported as such for
	// SR" - the store must let both exist so a consumer can detect it).
	store := NewMappingStore(t.TempDir())
	if _, err := store.Confirm("doc-1", "track-guid-a", "c-0001", "Chapter One"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Confirm("doc-1", "track-guid-b", "c-0001", "Chapter One"); err != nil {
		t.Fatal(err)
	}

	list, err := store.List("doc-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Fatalf("List = %#v, want both confirmations kept", list)
	}
}

// --- Clear ---

func TestClearRemovesOnlyTheGivenTrackSLink(t *testing.T) {
	store := NewMappingStore(t.TempDir())
	if _, err := store.Confirm("doc-1", "track-guid-a", "c-0001", "Chapter One"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Confirm("doc-1", "track-guid-b", "c-0002", "Chapter Two"); err != nil {
		t.Fatal(err)
	}

	if err := store.Clear("doc-1", "track-guid-a"); err != nil {
		t.Fatal(err)
	}

	list, err := store.List("doc-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].TrackGUID != "track-guid-b" {
		t.Fatalf("List = %#v, want only track-guid-b left", list)
	}
}

func TestClearingAnUnlinkedTrackIsNotAnError(t *testing.T) {
	store := NewMappingStore(t.TempDir())
	if err := store.Clear("doc-1", "never-linked"); err != nil {
		t.Fatalf("Clear on an unlinked track returned an error: %v", err)
	}
}

// --- Restart / persistence ---

func TestAConfirmedLinkSurvivesRestart(t *testing.T) {
	project := t.TempDir()
	first := NewMappingStore(project)
	if _, err := first.Confirm("doc-1", "track-guid-a", "c-0001", "Chapter One"); err != nil {
		t.Fatal(err)
	}

	second := NewMappingStore(project) // a fresh instance, as a restarted app would construct
	list, err := second.List("doc-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].ChapterID != "c-0001" {
		t.Fatalf("List after restart = %#v", list)
	}
}

func TestWritesOneFileAtTheDocumentedPath(t *testing.T) {
	project := t.TempDir()
	store := NewMappingStore(project)
	if _, err := store.Confirm("doc-1", "track-guid-a", "c-0001", "Chapter One"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(MappingFile(project)); err != nil {
		t.Fatalf("expected a file at %s: %v", MappingFile(project), err)
	}
}

// --- Keyed by documentId (Q6) ---

func TestListForADifferentDocumentReadsAsEmptyNeverAsTheOtherDocumentSLinks(t *testing.T) {
	store := NewMappingStore(t.TempDir())
	if _, err := store.Confirm("doc-1", "track-guid-a", "c-0001", "Chapter One"); err != nil {
		t.Fatal(err)
	}

	list, err := store.List("doc-2")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 0 {
		t.Fatalf("List(doc-2) = %#v, want empty (mapping is keyed by documentId, doc-1's links are not doc-2's)", list)
	}
}

func TestConfirmingForANewDocumentReplacesTheStaleDocumentSMappings(t *testing.T) {
	project := t.TempDir()
	store := NewMappingStore(project)
	if _, err := store.Confirm("doc-1", "track-guid-a", "c-0001", "Chapter One"); err != nil {
		t.Fatal(err)
	}
	// Simulates a re-import that produced a new documentId before resetDerived
	// happened to run (Q6's keyed-by-documentId guard, not the normal path -
	// resetDerived is the normal way this file is cleared, see the
	// manuscript package's tests).
	if _, err := store.Confirm("doc-2", "track-guid-b", "c-0001", "Chapter One"); err != nil {
		t.Fatal(err)
	}

	staleList, err := store.List("doc-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(staleList) != 0 {
		t.Fatalf("List(doc-1) = %#v, want empty once the file belongs to doc-2", staleList)
	}
	freshList, err := store.List("doc-2")
	if err != nil {
		t.Fatal(err)
	}
	if len(freshList) != 1 || freshList[0].TrackGUID != "track-guid-b" {
		t.Fatalf("List(doc-2) = %#v", freshList)
	}
}

// --- Unknown schema version reads as absent (matches LedgerStore/CacheStore) ---

func TestAFileWithANewerSchemaVersionReadsAsEmpty(t *testing.T) {
	project := t.TempDir()
	store := NewMappingStore(project)
	if _, err := store.Confirm("doc-1", "track-guid-a", "c-0001", "Chapter One"); err != nil {
		t.Fatal(err)
	}
	// Corrupt the schema version in place, as a newer app's file would look
	// to this one.
	raw, err := os.ReadFile(MappingFile(project))
	if err != nil {
		t.Fatal(err)
	}
	bumped := []byte(`{"schemaVersion": 99, "documentId": "doc-1", "mappings": []}`)
	_ = raw
	if err := os.WriteFile(MappingFile(project), bumped, 0o600); err != nil {
		t.Fatal(err)
	}

	list, err := store.List("doc-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 0 {
		t.Fatalf("List over a newer schema version = %#v, want empty, not an error", list)
	}
}

// --- Suggestion (Q9: re-suggestion from stored titles after a re-import) ---

func TestSuggestFromPreviousMatchesByTheStoredChapterTitle(t *testing.T) {
	store := NewMappingStore(t.TempDir())
	if _, err := store.Confirm("doc-1", "track-guid-a", "c-0001", "Chapter One"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Confirm("doc-1", "track-guid-b", "c-0002", "Chapter Two"); err != nil {
		t.Fatal(err)
	}
	previous, err := store.List("doc-1") // the snapshot a re-import reads before resetDerived clears the file
	if err != nil {
		t.Fatal(err)
	}

	// Re-import assigns new chapter ids (Evidence: "c-%04d" regenerates with
	// a new documentId); "Chapter One" survives the re-import, "Chapter Two"
	// was retitled to something unrelated.
	newChapters := []ChapterCandidate{
		{ID: "c-0007", Title: "Chapter One"},
		{ID: "c-0008", Title: "The Long Way Round"},
		{ID: "c-0009", Title: "Chapter Three"},
	}

	suggestions := SuggestFromPrevious(previous, newChapters)
	if len(suggestions) != 1 {
		t.Fatalf("suggestions = %#v, want exactly one match (only the unchanged title)", suggestions)
	}
	if suggestions[0].TrackGUID != "track-guid-a" || suggestions[0].ChapterID != "c-0007" {
		t.Fatalf("suggestions[0] = %#v, want track-guid-a re-suggested at its title's new id", suggestions[0])
	}
}

func TestSuggestFromPreviousAfterTheStoreIsClearedStillMatchesByTitle(t *testing.T) {
	// The full Q9 flow: confirm, snapshot, clear (what resetDerived does to
	// the file), then re-suggest from the snapshot against the post-reimport
	// chapter list - the snapshot must have been taken before the clear, and
	// suggesting must not need the store at all afterward.
	project := t.TempDir()
	store := NewMappingStore(project)
	if _, err := store.Confirm("doc-1", "track-guid-a", "c-0001", "Chapter One"); err != nil {
		t.Fatal(err)
	}
	previous, err := store.List("doc-1")
	if err != nil {
		t.Fatal(err)
	}

	if err := os.Remove(MappingFile(project)); err != nil {
		t.Fatal(err)
	}

	suggestions := SuggestFromPrevious(previous, []ChapterCandidate{{ID: "c-0099", Title: "Chapter One"}})
	if len(suggestions) != 1 || suggestions[0].ChapterID != "c-0099" {
		t.Fatalf("suggestions after clear = %#v", suggestions)
	}

	// Suggesting never writes: the new document's store is still empty until
	// the narrator confirms.
	fresh, err := NewMappingStore(project).List("doc-2")
	if err != nil {
		t.Fatal(err)
	}
	if len(fresh) != 0 {
		t.Fatalf("SuggestFromPrevious wrote to the store: List(doc-2) = %#v", fresh)
	}
}

func TestSuggestFromPreviousIsCaseAndWhitespaceInsensitive(t *testing.T) {
	previous := []TrackMapping{{TrackGUID: "track-guid-a", ChapterID: "c-0001", ChapterTitle: "  Chapter One  "}}
	chapters := []ChapterCandidate{{ID: "c-0007", Title: "chapter one"}}
	suggestions := SuggestFromPrevious(previous, chapters)
	if len(suggestions) != 1 {
		t.Fatalf("suggestions = %#v, want a case/whitespace-insensitive match", suggestions)
	}
}

func TestSuggestFromPreviousFollowsATitleThatGainedASubtitle(t *testing.T) {
	previous := []TrackMapping{{TrackGUID: "track-guid-b", ChapterID: "c-0002", ChapterTitle: "Chapter Two"}}
	chapters := []ChapterCandidate{{ID: "c-0008", Title: "Chapter Two, Revised"}, {ID: "c-0009", Title: "Chapter Three"}}
	suggestions := SuggestFromPrevious(previous, chapters)
	if len(suggestions) != 1 || suggestions[0].ChapterID != "c-0008" || suggestions[0].Score != chaptermatch.ScoreContained {
		t.Fatalf("suggestions = %#v, want the retitled chapter through a whole-token prefix", suggestions)
	}
}

func TestMatchSuggesterMatchesSpelledOutAndDigitChapterNumbers(t *testing.T) {
	tracks := []TrackCandidate{{TrackGUID: "track-guid-a", Name: "Chapter 1"}, {TrackGUID: "track-guid-k", Name: "Chapter 11"}}
	chapters := []ChapterCandidate{{ID: "c-0001", Title: "CHAPTER ONE"}, {ID: "c-0011", Title: "CHAPTER ELEVEN"}}
	suggestions := MatchSuggester.Suggest(tracks, chapters)
	if len(suggestions) != 2 || suggestions[0].ChapterID != "c-0001" || suggestions[1].ChapterID != "c-0011" {
		t.Fatalf("suggestions = %#v, want Chapter 1 -> CHAPTER ONE and Chapter 11 -> CHAPTER ELEVEN", suggestions)
	}
}

func TestMatchSuggesterNeverProposesAFuzzyGuess(t *testing.T) {
	// "Chapter 1" against only "Chapter 11" is only a 0.947 fuzzy ratio in the
	// matcher, which a suggestion never trusts.
	suggestions := MatchSuggester.Suggest([]TrackCandidate{{TrackGUID: "track-guid-a", Name: "Chapter 1"}}, []ChapterCandidate{{ID: "c-0011", Title: "Chapter 11"}})
	if len(suggestions) != 0 {
		t.Fatalf("suggestions = %#v, want none", suggestions)
	}
}

func TestMatchSuggesterNeverProposesAnUnrelatedChapter(t *testing.T) {
	tracks := []TrackCandidate{{TrackGUID: "track-guid-a", Name: "Narration - Take 3"}}
	chapters := []ChapterCandidate{{ID: "c-0001", Title: "Chapter One"}}
	suggestions := MatchSuggester.Suggest(tracks, chapters)
	if len(suggestions) != 0 {
		t.Fatalf("suggestions = %#v, want none for an unrelated track name", suggestions)
	}
}

// --- ConfirmedAt uses the injected clock when set ---

func TestConfirmStampsConfirmedAtWithTheStoreSClock(t *testing.T) {
	store := NewMappingStore(t.TempDir())
	fixed := time.Date(2026, 9, 22, 12, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return fixed }

	mapping, err := store.Confirm("doc-1", "track-guid-a", "c-0001", "Chapter One")
	if err != nil {
		t.Fatal(err)
	}
	if !mapping.ConfirmedAt.Equal(fixed) {
		t.Fatalf("ConfirmedAt = %v, want %v", mapping.ConfirmedAt, fixed)
	}
}
