package manuscript

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/layout"
)

func importReaderFixture(t *testing.T) (*Service, string, string) {
	t.Helper()
	project := t.TempDir()
	service := New(project)
	source := layout.RepoFile(layout.FixturesDir + "/alice.md")
	job := service.Begin(source)
	preview, err := service.Preview(job.ID, 1)
	if err != nil || preview.Phase != "ready" {
		t.Fatalf("preview = %#v, %v", preview, err)
	}
	completed, err := service.Commit(job.ID, false, nil)
	if err != nil || completed.Phase != "success" {
		t.Fatalf("commit = %#v, %v", completed, err)
	}
	data, err := service.Load()
	if err != nil {
		t.Fatal(err)
	}
	chapters := objects(data["chapters"])
	paragraphs := objects(data["paragraphs"])
	return service, text(chapters[0], "id"), text(paragraphs[0], "id")
}

func TestReaderStateAndBookmarksRoundTrip(t *testing.T) {
	service, chapterID, _ := importReaderFixture(t)
	saved, err := service.SaveReaderState(chapterID, nil, []string{chapterID}, true)
	if err != nil {
		t.Fatal(err)
	}
	if got := objects(saved["bookmarks"]); len(got) != 0 {
		t.Fatalf("bookmarks = %#v", got)
	}
	if got := stringListValue(saved["expandedChapters"]); len(got) != 1 || got[0] != chapterID {
		t.Fatalf("expanded = %#v", saved["expandedChapters"])
	}
	bookmark, err := service.CreateBookmark(map[string]any{"kind": "chapter", "chapter": "Opening pages", "chapterId": chapterID})
	if err != nil {
		t.Fatal(err)
	}
	duplicate, err := service.CreateBookmark(map[string]any{"kind": "chapter", "chapter": "Opening pages", "chapterId": chapterID})
	if err != nil {
		t.Fatal(err)
	}
	if text(bookmark, "id") != text(duplicate, "id") {
		t.Fatalf("duplicate bookmark was recreated")
	}
	if err := service.DeleteBookmark(text(bookmark, "id")); err != nil {
		t.Fatal(err)
	}
	if got := objects(service.ReaderState()["bookmarks"]); len(got) != 0 {
		t.Fatalf("bookmarks = %#v", got)
	}
}

func TestReaderNotesStatusAndSearch(t *testing.T) {
	service, chapterID, paragraphID := importReaderFixture(t)
	status, err := service.SetChapterStatus(chapterID, "recording")
	if err != nil || text(status, "status") != "recording" {
		t.Fatalf("status = %#v, %v", status, err)
	}
	note, err := service.CreateNote(chapterID, paragraphID, "Check this", pointer(1), pointer(4), "heck")
	if err != nil {
		t.Fatal(err)
	}
	if got := service.Notes(chapterID); len(got) != 1 || text(got[0], "id") != text(note, "id") {
		t.Fatalf("notes = %#v", got)
	}
	reader, err := service.Reader()
	if err != nil {
		t.Fatal(err)
	}
	if len(objects(reader["chapters"])) == 0 || len(objects(reader["paragraphs"])) == 0 {
		t.Fatalf("reader = %#v", reader)
	}
	hits, err := service.Search("alice")
	if err != nil || len(hits) == 0 {
		t.Fatalf("hits = %#v, %v", hits, err)
	}
	if err := service.DeleteNote(text(note, "id")); err != nil {
		t.Fatal(err)
	}
}

// Phase 2 of the reader search and controls PRD: the search cache (keyed by the file's own mtime
// and size), the result cap, and the match offset the PRD's windowing helper (Phase 3) needs.

func TestSearchReturnsTheMatchOffset(t *testing.T) {
	service, _, _ := importReaderFixture(t)
	hits, err := service.Search("alice")
	if err != nil || len(hits) == 0 {
		t.Fatalf("hits = %#v, %v", hits, err)
	}
	for _, hit := range hits {
		excerpt, _ := hit["excerpt"].(string)
		// A rune count (matchStart is a JS/UTF-16 index - see the multi-byte test below), so the
		// fixture's real curly quotes and em dashes must be sliced by rune, not by Go byte string.
		runes := []rune(excerpt)
		offset, ok := hit["matchStart"].(int)
		if !ok {
			t.Fatalf("hit has no int matchStart: %#v", hit)
		}
		if offset < 0 || offset+len("alice") > len(runes) {
			t.Fatalf("matchStart %d out of range for %q (%d runes)", offset, excerpt, len(runes))
		}
		if !strings.EqualFold(string(runes[offset:offset+len("alice")]), "alice") {
			t.Fatalf("matchStart %d does not point at the match in %q", offset, excerpt)
		}
	}
}

// matchStart travels to the UI as a JS string index (UTF-16 code units). strings.Index returns a
// UTF-8 byte offset, which agrees with the rune count only while every character before the match
// is ASCII - a curly quote, an em dash or an accented letter (all ordinary in a manuscript) is
// multiple bytes but one UTF-16 unit, so a byte offset would land the frontend's highlight short of
// the real match. This proves the offset is a rune count, simulated here as a JS caller would slice
// it (Go's []rune conversion, one element per code point - identical to a JS UTF-16 index for every
// character in the Basic Multilingual Plane, which covers ordinary manuscript prose).
func TestSearchMatchOffsetSurvivesMultiByteCharactersBeforeTheMatch(t *testing.T) {
	project := t.TempDir()
	text := "‘Well,’ she thought — a café with rabbits in it." // curly quotes, an em dash, an accented e
	writeManuscript(t, project, []map[string]any{
		{"id": "p0", "chapterId": "c1", "chapter": "Chapter One", "chapterTitle": "Chapter One", "index": 0, "text": text},
	})
	hits, err := New(project).Search("rabbits")
	if err != nil || len(hits) != 1 {
		t.Fatalf("hits = %#v, %v", hits, err)
	}
	offset, ok := hits[0]["matchStart"].(int)
	if !ok {
		t.Fatalf("hit has no int matchStart: %#v", hits[0])
	}
	runes := []rune(text)
	if offset < 0 || offset+len("rabbits") > len(runes) {
		t.Fatalf("matchStart %d out of range for %d runes", offset, len(runes))
	}
	if got := string(runes[offset : offset+len("rabbits")]); got != "rabbits" {
		t.Fatalf("matchStart %d (as a rune/UTF-16 index) points at %q, not the match", offset, got)
	}
}

func writeManuscript(t *testing.T, project string, paragraphs []map[string]any) string {
	t.Helper()
	dir := filepath.Join(project, "narration-utils", "manuscript")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "manuscript.json")
	bytes, err := json.Marshal(map[string]any{"schemaVersion": 1, "chapters": []any{}, "paragraphs": paragraphs})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, bytes, 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestSearchCapsResultsAtTheLimit(t *testing.T) {
	project := t.TempDir()
	paragraphs := make([]map[string]any, 0, maxSearchResults+50)
	for i := range maxSearchResults + 50 {
		paragraphs = append(paragraphs, map[string]any{
			"id": "p", "chapterId": "c1", "chapter": "Chapter One", "chapterTitle": "Chapter One", "index": i, "text": "the quick fox",
		})
	}
	writeManuscript(t, project, paragraphs)
	hits, err := New(project).Search("fox")
	if err != nil {
		t.Fatal(err)
	}
	if len(hits) != maxSearchResults {
		t.Fatalf("hits = %d, want the cap of %d", len(hits), maxSearchResults)
	}
}

func TestLoadCachesTheManuscriptUntilTheFileActuallyChanges(t *testing.T) {
	project := t.TempDir()
	paragraph := func(text string) []map[string]any {
		return []map[string]any{{"id": "p0", "chapterId": "c1", "chapter": "Chapter One", "chapterTitle": "Chapter One", "index": 0, "text": text}}
	}
	// Same byte length both times, so a same-size rewrite below can be pinned to the exact same
	// mtime and size as the first write - proving the second Load() came from the cache, not a
	// coincidence of timing (mtime resolution can be too coarse to tell two quick writes apart).
	path := writeManuscript(t, project, paragraph("AAAAAAAAAAAAAA"))
	stamp := time.Now().Truncate(time.Second)
	if err := os.Chtimes(path, stamp, stamp); err != nil {
		t.Fatal(err)
	}
	service := New(project)
	first, err := service.Load()
	if err != nil {
		t.Fatal(err)
	}
	if got := text(objects(first["paragraphs"])[0], "text"); got != "AAAAAAAAAAAAAA" {
		t.Fatalf("first paragraph text = %q", got)
	}

	writeManuscript(t, project, paragraph("BBBBBBBBBBBBBB"))
	if err := os.Chtimes(path, stamp, stamp); err != nil { // same mtime as before, same size (14 chars either way)
		t.Fatal(err)
	}
	second, err := service.Load()
	if err != nil {
		t.Fatal(err)
	}
	if got := text(objects(second["paragraphs"])[0], "text"); got != "AAAAAAAAAAAAAA" {
		t.Fatalf("Load() re-read an unchanged (by mtime and size) file instead of serving the cache: got %q", got)
	}

	future := stamp.Add(time.Minute)
	if err := os.Chtimes(path, future, future); err != nil {
		t.Fatal(err)
	}
	third, err := service.Load()
	if err != nil {
		t.Fatal(err)
	}
	if got := text(objects(third["paragraphs"])[0], "text"); got != "BBBBBBBBBBBBBB" {
		t.Fatalf("Load() kept serving the cache after the file's mtime changed: got %q", got)
	}
}

func pointer(value int) *int { return &value }
func stringListValue(value any) []string {
	raw, _ := value.([]string)
	if raw != nil {
		return raw
	}
	items, _ := value.([]any)
	result := []string{}
	for _, item := range items {
		if text, ok := item.(string); ok {
			result = append(result, text)
		}
	}
	return result
}

func TestChapterIDByTitleAndParagraphIDResolveAgainstTheImportedManuscript(t *testing.T) {
	service, chapterID, paragraphID := importReaderFixture(t)
	data, err := service.Load()
	if err != nil {
		t.Fatal(err)
	}
	chapters := objects(data["chapters"])
	paragraphs := objects(data["paragraphs"])

	if id, ambiguous, ok := service.ChapterIDByTitle(text(chapters[0], "title")); !ok || ambiguous || id != chapterID {
		t.Fatalf("ChapterIDByTitle = %q, %v, %v; want %q, false, true", id, ambiguous, ok, chapterID)
	}
	if _, _, ok := service.ChapterIDByTitle("No Such Chapter"); ok {
		t.Fatal("an unknown title must not resolve")
	}

	index, _ := paragraphs[0]["index"].(float64)
	if id, ok := service.ParagraphID(chapterID, int(index)); !ok || id != paragraphID {
		t.Fatalf("ParagraphID = %q, %v; want %q, true", id, ok, paragraphID)
	}
	if _, ok := service.ParagraphID(chapterID, -1); ok {
		t.Fatal("an index no paragraph has must not resolve")
	}
	if _, ok := service.ParagraphID("not-a-chapter", int(index)); ok {
		t.Fatal("a paragraph of another chapter must not resolve")
	}
}

func TestChapterIDByTitleFlagsATitleSharedByTwoChapters(t *testing.T) {
	project := t.TempDir()
	dir := filepath.Join(project, "narration-utils", "manuscript")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(map[string]any{
		"schemaVersion": 1,
		"chapters":      []any{map[string]any{"id": "c-1", "title": "Interlude"}, map[string]any{"id": "c-2", "title": "Interlude"}},
		"paragraphs":    []any{},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "manuscript.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}
	if id, ambiguous, ok := New(project).ChapterIDByTitle("Interlude"); !ok || !ambiguous || id != "c-1" {
		t.Fatalf("ChapterIDByTitle = %q, %v, %v; want the first match, flagged ambiguous", id, ambiguous, ok)
	}
}

func TestChapterIDByTitleAndParagraphIDFailWithoutAManuscript(t *testing.T) {
	service := New(t.TempDir())
	if _, _, ok := service.ChapterIDByTitle("Anything"); ok {
		t.Fatal("no manuscript: nothing resolves")
	}
	if _, ok := service.ParagraphID("c-1", 0); ok {
		t.Fatal("no manuscript: nothing resolves")
	}
}
