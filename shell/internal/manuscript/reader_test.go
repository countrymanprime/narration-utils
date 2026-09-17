package manuscript

import (
	"path/filepath"
	"testing"
)

func importReaderFixture(t *testing.T) (*Service, string, string) {
	t.Helper()
	project := t.TempDir()
	service := New(project)
	source := filepath.Join("..", "..", "..", "shared", "test-fixtures", "alice.md")
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
