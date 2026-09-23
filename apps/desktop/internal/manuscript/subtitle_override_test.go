package manuscript

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/importer"
	"github.com/countrymanprime/narration-utils/shell/internal/layout"
)

// commitHeadingMisread imports one of the constructed heading cases with the narrator's subtitle choices and returns the canonical
// manuscript that was written (story-bible-and-import-ux-briefs PRD, Phase 5; tests/fixtures/heading-misreads).
func commitHeadingMisread(t *testing.T, name string, choose func(importer.DraftSection) map[string]bool) map[string]any {
	t.Helper()
	service := New(t.TempDir())
	job := service.Begin(layout.RepoFile(layout.FixturesDir + "/heading-misreads/" + name))
	preview, err := service.Preview(job.ID, 1)
	if err != nil || preview.Phase != "ready" {
		t.Fatalf("preview = %#v, %v", preview, err)
	}
	sections := preview.Preview["sections"].([]importer.DraftSection)
	committed, err := service.Commit(job.ID, false, Choices{SubtitleOverrides: choose(sections[len(sections)-1])})
	if err != nil || committed.Phase != "success" {
		t.Fatalf("commit = %#v, %v", committed, err)
	}
	canonical, err := service.Load()
	if err != nil {
		t.Fatal(err)
	}
	return canonical
}

func firstChapter(canonical map[string]any) map[string]any {
	return canonical["chapters"].([]any)[0].(map[string]any)
}

func TestCommitJoinsAWrappedTitleTheNarratorSaidHasNoSubtitle(t *testing.T) {
	canonical := commitHeadingMisread(t, "docx-two-line-title.docx", func(section importer.DraftSection) map[string]bool {
		if section.Title != "The Girl Who" || section.SubtitleOff != importer.SubtitleOffJoinsTitle {
			t.Fatalf("the preview's section = %+v, want the wrapped title split, to be joined when turned off", section)
		}
		return map[string]bool{section.ID: false}
	})
	chapter := firstChapter(canonical)
	if chapter["title"] != "The Girl Who Fell Through the Ice" || chapter["subtitle"] != nil {
		t.Fatalf("chapter = %q / %v, want the joined title and no subtitle", chapter["title"], chapter["subtitle"])
	}
	if paragraph := canonical["paragraphs"].([]any)[0].(map[string]any); paragraph["chapterTitle"] != "The Girl Who Fell Through the Ice" {
		t.Fatalf("paragraph chapter title = %q", paragraph["chapterTitle"])
	}
}

func TestCommitNarratesAPlainTextEpigraphTheNarratorSaidIsNotASubtitle(t *testing.T) {
	canonical := commitHeadingMisread(t, "txt-epigraph-under-heading.txt", func(section importer.DraftSection) map[string]bool {
		if section.SubtitleOff != importer.SubtitleOffReturnsToBody {
			t.Fatalf("the preview's section = %+v, want its subtitle to return to the body when turned off", section)
		}
		return map[string]bool{section.ID: false}
	})
	chapter := firstChapter(canonical)
	if chapter["title"] != "Chapter One" || chapter["subtitle"] != nil {
		t.Fatalf("chapter = %q / %v, want Chapter One and no subtitle", chapter["title"], chapter["subtitle"])
	}
	paragraphs := canonical["paragraphs"].([]any)
	if first := paragraphs[0].(map[string]any); first["text"] != "“Water finds its level.”" || first["chapterId"] != chapter["id"] {
		t.Fatalf("first paragraph = %v, want the epigraph, narrated in Chapter One", first)
	}
	if len(paragraphs) != 3 {
		t.Fatalf("%d paragraphs, want the epigraph and the two body paragraphs", len(paragraphs))
	}
}

func TestCommitKeepsASubtitleWithNoChoice(t *testing.T) {
	canonical := commitHeadingMisread(t, "docx-soft-break-subtitle.docx", func(importer.DraftSection) map[string]bool { return nil })
	chapter := firstChapter(canonical)
	if chapter["title"] != "Chapter One" || chapter["subtitle"] != "The Storm" {
		t.Fatalf("chapter = %q / %v, want Chapter One / The Storm", chapter["title"], chapter["subtitle"])
	}
}

func TestCommitRefusesASubtitleChoiceForASectionThePreviewDidNotHave(t *testing.T) {
	project := t.TempDir()
	service := New(project)
	job := service.Begin(layout.RepoFile(layout.FixturesDir + "/heading-misreads/docx-two-line-title.docx"))
	if _, err := service.Preview(job.ID, 1); err != nil {
		t.Fatal(err)
	}
	failed, err := service.Commit(job.ID, false, Choices{SubtitleOverrides: map[string]bool{"section-9999": false}})
	if err != nil {
		t.Fatal(err)
	}
	if failed.Phase != "error" || !strings.Contains(failed.Error, "subtitle choice") {
		t.Fatalf("commit = %s %q, want an error about the subtitle choice", failed.Phase, failed.Error)
	}
	if _, err := os.Stat(filepath.Join(project, "narration-utils", "manuscript", "manuscript.json")); !os.IsNotExist(err) {
		t.Fatalf("a refused choice must write no manuscript, stat err = %v", err)
	}
}
