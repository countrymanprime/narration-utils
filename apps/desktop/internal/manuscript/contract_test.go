package manuscript

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
)

// The payloads the manuscript bindings send to the UI (ADR 0069), pinned for its contract tests. They come from a real import of
// a small Markdown file through the real service; random ids and timestamps are named or fixed by contractfile.Stabilize.
const contractSource = "# Chapter One\nRoses are *red*,  \nviolets are **blue**.\n\nA second paragraph of the first chapter.\n\n# Chapter Two\nA short line in the second chapter.\n"

func pin(t *testing.T, name string, value any) {
	t.Helper()
	stable, err := contractfile.Stabilize(value)
	if err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, name, stable)
}

func TestContractImportJobsAndReaderPayloads(t *testing.T) {
	project := t.TempDir()
	source := filepath.Join(project, "book.md")
	if err := os.WriteFile(source, []byte(contractSource), 0o600); err != nil {
		t.Fatal(err)
	}
	service := New(project)
	job := service.Begin(source)
	beginning, err := service.State(job.ID)
	if err != nil {
		t.Fatal(err)
	}
	pin(t, "manuscript-import-selected", volatileJob(beginning))

	preview, err := service.Preview(job.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	pin(t, "manuscript-import-preview", volatileJob(preview))

	committed, err := service.Commit(job.ID, false, nil)
	if err != nil || committed.Phase != "success" {
		t.Fatalf("commit = %#v, %v", committed, err)
	}
	pin(t, "manuscript-import-success", volatileJob(committed))

	chapters, err := service.Chapters()
	if err != nil {
		t.Fatal(err)
	}
	pin(t, "manuscript-chapters", chapters)
	first := chapters[0]["id"].(string)
	paragraphs, err := service.Paragraphs(first)
	if err != nil {
		t.Fatal(err)
	}
	pin(t, "manuscript-paragraphs", paragraphs)
	hits, err := service.Search("paragraph")
	if err != nil {
		t.Fatal(err)
	}
	pin(t, "manuscript-search", hits)

	start, end := 1, 6
	note, err := service.CreateNote(first, paragraphs[0]["id"].(string), "Check the rhyme", &start, &end, "oses a")
	if err != nil {
		t.Fatal(err)
	}
	pin(t, "manuscript-note", note)
	pin(t, "manuscript-notes", service.Notes(first))
	status, err := service.SetChapterStatus(first, "recording")
	if err != nil {
		t.Fatal(err)
	}
	pin(t, "manuscript-chapter-status", status)
	bookmark, err := service.CreateBookmark(map[string]any{"kind": "line", "chapter": "Chapter One", "chapterId": first, "paragraphId": paragraphs[0]["id"], "paragraph": 0})
	if err != nil {
		t.Fatal(err)
	}
	pin(t, "manuscript-bookmark", bookmark)
	line := 2
	state, err := service.SaveReaderState(first, &line, []string{first}, true)
	if err != nil {
		t.Fatal(err)
	}
	pin(t, "manuscript-reader-state", state)
	reader, err := service.Reader()
	if err != nil {
		t.Fatal(err)
	}
	pin(t, "manuscript-reader", reader)
}

// A job's elapsed time is the only value that varies between runs.
func volatileJob(job ImportJob) ImportJob {
	job.Elapsed = 1.5
	return job
}

func TestContractReaderStateOfAManuscriptNobodyHasReadYet(t *testing.T) {
	project := t.TempDir()
	source := filepath.Join(project, "book.md")
	if err := os.WriteFile(source, []byte(contractSource), 0o600); err != nil {
		t.Fatal(err)
	}
	service := New(project)
	job := service.Begin(source)
	if _, err := service.Preview(job.ID, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Commit(job.ID, false, nil); err != nil {
		t.Fatal(err)
	}
	pin(t, "manuscript-reader-state-empty", service.ReaderState())
	pin(t, "manuscript-notes-empty", service.Notes(""))
}
