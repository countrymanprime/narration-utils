package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/layout"
	"github.com/countrymanprime/narration-utils/shell/internal/manuscript"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

// chapterRegionsSubtitleTrackI and chapterRegionsSubtitleTrackII hold "CHAPTER ONE"'s and "Chapter Two"'s recordings,
// mirroring chapterTracksRpp's shape (chaptermatch_test.go) for tests/fixtures/chapter-regions-subtitle.md, whose
// first chapter has a subtitle and whose second does not.
const chapterRegionsSubtitleTrackI = "{55555555-5555-4555-8555-555555555555}"
const chapterRegionsSubtitleTrackII = "{66666666-6666-4666-8666-666666666666}"

const chapterRegionsSubtitleRpp = `<REAPER_PROJECT 0.1 "7.80/x64" 1789000000
  <TRACK {55555555-5555-4555-8555-555555555555}
    NAME "CHAPTER ONE"
    TRACKID {55555555-5555-4555-8555-555555555555}
    <ITEM
      POSITION 0
      LENGTH 10
      IGUID {15555555-5555-4555-8555-555555555555}
      GUID {25555555-5555-4555-8555-555555555555}
      <SOURCE WAVE
        FILE "media/one.wav"
      >
    >
  >
  <TRACK {66666666-6666-4666-8666-666666666666}
    NAME "Chapter Two"
    TRACKID {66666666-6666-4666-8666-666666666666}
    <ITEM
      POSITION 30
      LENGTH 8
      IGUID {16666666-6666-4666-8666-666666666666}
      GUID {26666666-6666-4666-8666-666666666666}
      <SOURCE WAVE
        FILE "media/two.wav"
      >
    >
  >
>
`

// newTestHostForChapterRegionsSubtitle builds a Host over
// tests/fixtures/chapter-regions-subtitle.md (chapter-title-display-consistency PRD Phase 4, Q7): "CHAPTER ONE" has
// the subtitle "Bad Ideas Look Great in Neon"; "Chapter Two" has none. It returns the chapter ids in book order.
func newTestHostForChapterRegionsSubtitle(t *testing.T) (*Host, []string) {
	t.Helper()
	project := t.TempDir()
	service := manuscript.New(project)
	job := service.Begin(layout.RepoFile(layout.FixturesDir + "/chapter-regions-subtitle.md"))
	if _, err := service.Preview(job.ID, 2); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Commit(job.ID, false, manuscript.Choices{}); err != nil {
		t.Fatal(err)
	}
	chapters, err := service.Chapters()
	if err != nil {
		t.Fatal(err)
	}
	if len(chapters) != 2 {
		t.Fatalf("fixture chapters = %d, want 2", len(chapters))
	}
	if title, subtitle := chapters[0]["title"], chapters[0]["subtitle"]; title != "CHAPTER ONE" || subtitle != "Bad Ideas Look Great in Neon" {
		t.Fatalf("chapter 0 = %q / %v, want CHAPTER ONE / Bad Ideas Look Great in Neon", title, subtitle)
	}
	if title, subtitle := chapters[1]["title"], chapters[1]["subtitle"]; title != "Chapter Two" || subtitle != nil {
		t.Fatalf("chapter 1 = %q / %v, want Chapter Two and no subtitle", title, subtitle)
	}

	if err := os.WriteFile(filepath.Join(project, "Book.rpp"), []byte(chapterRegionsSubtitleRpp), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(project, "media"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"one.wav", "two.wav"} {
		if err := os.WriteFile(filepath.Join(project, "media", name), []byte("RIFF"), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	host := &Host{settings: settings.New(t.TempDir(), project), manuscript: service}
	host.config.projectFolder = project
	ids := make([]string, 0, len(chapters))
	for _, chapter := range chapters {
		ids = append(ids, chapter["id"].(string))
	}
	return host, ids
}

// TestChapterRegionsPreviewFollowsTheSameNameRuleAsEverywhereElse pins Q7 of chapter-title-display-consistency.prd.md
// (owner decision D34): a chapter's region title is chaptername.Plain's "Title - Subtitle" (the ASCII hyphen, not the
// em dash, since the name becomes a REAPER region, then a render file name, then an ID3 CHAP title), and a chapter
// with no subtitle keeps exactly its title, unchanged from before this phase.
func TestChapterRegionsPreviewFollowsTheSameNameRuleAsEverywhereElse(t *testing.T) {
	host, ids := newTestHostForChapterRegionsSubtitle(t)
	linkChapter(t, host, ids[0], chapterRegionsSubtitleTrackI)
	linkChapter(t, host, ids[1], chapterRegionsSubtitleTrackII)
	plan := previewRegions(t, host, "", "")
	if len(plan.Rows) != 2 {
		t.Fatalf("rows = %#v, want two", plan.Rows)
	}
	if got := plan.Rows[0].Title; got != "CHAPTER ONE - Bad Ideas Look Great in Neon" {
		t.Fatalf("chapter with a subtitle: region title = %q, want the ASCII-separated plain name", got)
	}
	if got := plan.Rows[1].Title; got != "Chapter Two" {
		t.Fatalf("chapter with no subtitle: region title = %q, want the bare title, unchanged", got)
	}
}

// TestChapterRegionsCreateSendsThePlainNameForAChapterWithASubtitle checks the same rule holds for the row actually
// sent to create_regions, not only the preview.
func TestChapterRegionsCreateSendsThePlainNameForAChapterWithASubtitle(t *testing.T) {
	host, ids := newTestHostForChapterRegionsSubtitle(t)
	linkChapter(t, host, ids[0], chapterRegionsSubtitleTrackI)
	fake := &fakeRegionCreator{}
	if _, err := createChapterRegions(context.Background(), host.services(), fake, "", "", false); err != nil {
		t.Fatal(err)
	}
	if len(fake.rows) != 1 || fake.rows[0].Title != "CHAPTER ONE - Bad Ideas Look Great in Neon" {
		t.Fatalf("rows sent to create_regions = %#v, want the plain-form name", fake.rows)
	}
}
