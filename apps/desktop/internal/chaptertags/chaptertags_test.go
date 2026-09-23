package chaptertags

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/bogem/id3v2/v2"
)

func copyFixture(t *testing.T, name string) string {
	t.Helper()
	dir := t.TempDir()
	dst := filepath.Join(dir, name)
	if err := copyFile(filepath.Join("testdata", name), dst); err != nil {
		t.Fatalf("copyFixture(%s): %v", name, err)
	}
	return dst
}

func TestBuildTimelineLaysOutSequentialChapters(t *testing.T) {
	chapters := []Chapter{
		{Title: "Chapter 1", Path: filepath.Join("testdata", "chapter1.mp3")},
		{Title: "Chapter 2", Path: filepath.Join("testdata", "chapter2.mp3")},
	}
	timeline, err := BuildTimeline(chapters)
	if err != nil {
		t.Fatalf("BuildTimeline: %v", err)
	}
	if len(timeline) != 2 {
		t.Fatalf("len(timeline) = %d, want 2", len(timeline))
	}
	if timeline[0].Start != 0 {
		t.Fatalf("timeline[0].Start = %v, want 0", timeline[0].Start)
	}
	if timeline[0].End != timeline[1].Start {
		t.Fatalf("chapter 1 ends at %v but chapter 2 starts at %v; they must be contiguous", timeline[0].End, timeline[1].Start)
	}
	if timeline[1].End <= timeline[1].Start {
		t.Fatalf("timeline[1].End (%v) must be after its Start (%v)", timeline[1].End, timeline[1].Start)
	}
	for i, c := range timeline {
		if c.Title != chapters[i].Title {
			t.Errorf("timeline[%d].Title = %q, want %q", i, c.Title, chapters[i].Title)
		}
	}
}

func TestBuildTimelineRejectsEmptyList(t *testing.T) {
	if _, err := BuildTimeline(nil); err == nil {
		t.Fatal("BuildTimeline(nil): want error, got nil")
	}
}

func TestBuildTimelineRejectsBlankTitle(t *testing.T) {
	_, err := BuildTimeline([]Chapter{{Title: "  ", Path: filepath.Join("testdata", "chapter1.mp3")}})
	if err == nil {
		t.Fatal("BuildTimeline with a blank title: want error, got nil")
	}
}

func TestBuildTimelineReportsMissingChapterFile(t *testing.T) {
	_, err := BuildTimeline([]Chapter{{Title: "Chapter 1", Path: filepath.Join("testdata", "does-not-exist.mp3")}})
	if err == nil {
		t.Fatal("BuildTimeline with a missing file: want error, got nil")
	}
}

func TestEmbedRoundTripsChapterAndTableOfContents(t *testing.T) {
	dest := copyFixture(t, "book.mp3")
	timeline := []TimedChapter{
		{Title: "Chapter 1", Start: 0, End: 1 * time.Second},
		{Title: "Chapter 2", Start: 1 * time.Second, End: 2600 * time.Millisecond},
	}

	outPath, err := Embed(dest, timeline)
	if err != nil {
		t.Fatalf("Embed: %v", err)
	}
	if outPath == dest {
		t.Fatalf("Embed must write a new file, not %q itself", dest)
	}
	if filepath.Dir(outPath) != filepath.Dir(dest) {
		t.Fatalf("Embed wrote %q, want it beside %q", outPath, dest)
	}

	// The source render is untouched: verify by content, not just mtime.
	original, err := os.ReadFile(filepath.Join("testdata", "book.mp3"))
	if err != nil {
		t.Fatalf("reading the original fixture: %v", err)
	}
	stillThere, err := os.ReadFile(dest)
	if err != nil {
		t.Fatalf("reading dest after Embed: %v", err)
	}
	if string(original) != string(stillThere) {
		t.Fatal("Embed modified destPath's bytes; it must only write the new copy")
	}

	tag, err := id3v2.Open(outPath, id3v2.Options{Parse: true})
	if err != nil {
		t.Fatalf("re-opening the tagged copy: %v", err)
	}
	defer func() { _ = tag.Close() }()

	chapterFrames := tag.GetFrames("CHAP")
	if len(chapterFrames) != len(timeline) {
		t.Fatalf("got %d CHAP frames, want %d", len(chapterFrames), len(timeline))
	}
	for i, frame := range chapterFrames {
		cf, ok := frame.(id3v2.ChapterFrame)
		if !ok {
			t.Fatalf("CHAP frame %d is a %T, not id3v2.ChapterFrame", i, frame)
		}
		want := timeline[i]
		if cf.Title == nil || cf.Title.Text != want.Title {
			t.Errorf("CHAP frame %d title = %+v, want %q", i, cf.Title, want.Title)
		}
		if cf.StartTime != want.Start {
			t.Errorf("CHAP frame %d StartTime = %v, want %v", i, cf.StartTime, want.Start)
		}
		if cf.EndTime != want.End {
			t.Errorf("CHAP frame %d EndTime = %v, want %v", i, cf.EndTime, want.End)
		}
	}

	ctocFrames := tag.GetFrames("CTOC")
	if len(ctocFrames) != 1 {
		t.Fatalf("got %d CTOC frames, want 1", len(ctocFrames))
	}
	uf, ok := ctocFrames[0].(id3v2.UnknownFrame)
	if !ok {
		t.Fatalf("CTOC frame is a %T, not id3v2.UnknownFrame", ctocFrames[0])
	}
	elementID, flags, childIDs := parseCTOCBody(t, uf.Body)
	if elementID != "toc" {
		t.Errorf("CTOC element ID = %q, want %q", elementID, "toc")
	}
	if flags != 0x03 {
		t.Errorf("CTOC flags = %#x, want top-level and ordered (0x03)", flags)
	}
	if len(childIDs) != len(timeline) {
		t.Fatalf("CTOC has %d children, want %d", len(childIDs), len(timeline))
	}
	for i, id := range childIDs {
		chapterFrame := chapterFrames[i].(id3v2.ChapterFrame)
		if id != chapterFrame.ElementID {
			t.Errorf("CTOC child %d = %q, want it to match CHAP frame %d's element ID %q", i, id, i, chapterFrame.ElementID)
		}
	}
}

func TestEmbedIsIdempotentOnASecondRun(t *testing.T) {
	dest := copyFixture(t, "book.mp3")
	timeline := []TimedChapter{{Title: "Chapter 1", Start: 0, End: 1 * time.Second}}

	if _, err := Embed(dest, timeline); err != nil {
		t.Fatalf("first Embed: %v", err)
	}
	outPath, err := Embed(dest, timeline)
	if err != nil {
		t.Fatalf("second Embed: %v", err)
	}

	tag, err := id3v2.Open(outPath, id3v2.Options{Parse: true})
	if err != nil {
		t.Fatalf("re-opening after the second Embed: %v", err)
	}
	defer func() { _ = tag.Close() }()
	if got := len(tag.GetFrames("CHAP")); got != 1 {
		t.Fatalf("after two Embed runs, got %d CHAP frames, want 1 (no duplicates)", got)
	}
	if got := len(tag.GetFrames("CTOC")); got != 1 {
		t.Fatalf("after two Embed runs, got %d CTOC frames, want 1 (no duplicates)", got)
	}
}

func TestEmbedRejectsMoreChaptersThanCTOCCanList(t *testing.T) {
	dest := copyFixture(t, "book.mp3")
	timeline := make([]TimedChapter, maxCTOCEntries+1)
	for i := range timeline {
		timeline[i] = TimedChapter{Title: "Chapter", Start: time.Duration(i) * time.Second, End: time.Duration(i+1) * time.Second}
	}
	if _, err := Embed(dest, timeline); err == nil {
		t.Fatal("Embed with more chapters than a CTOC frame can list: want error, got nil")
	}
}

func TestEmbedRejectsNonMP3Destination(t *testing.T) {
	dir := t.TempDir()
	dest := filepath.Join(dir, "chapter.wav")
	if err := os.WriteFile(dest, []byte("RIFF...."), 0o644); err != nil {
		t.Fatalf("os.WriteFile: %v", err)
	}
	timeline := []TimedChapter{{Title: "Chapter 1", Start: 0, End: 1 * time.Second}}
	if _, err := Embed(dest, timeline); err == nil {
		t.Fatal("Embed on a .wav destination: want error, got nil")
	}
}

func TestEmbedRejectsMissingDestination(t *testing.T) {
	timeline := []TimedChapter{{Title: "Chapter 1", Start: 0, End: 1 * time.Second}}
	if _, err := Embed(filepath.Join(t.TempDir(), "missing.mp3"), timeline); err == nil {
		t.Fatal("Embed on a missing destination: want error, got nil")
	}
}

func TestEmbedRejectsEmptyTimeline(t *testing.T) {
	dest := copyFixture(t, "book.mp3")
	if _, err := Embed(dest, nil); err == nil {
		t.Fatal("Embed with no chapters: want error, got nil")
	}
}

// parseCTOCBody decodes the raw bytes buildCTOCBody wrote, mirroring what a third-party ID3v2-chapters-aware
// player would do when reading the frame back.
func parseCTOCBody(t *testing.T, body []byte) (elementID string, flags byte, childIDs []string) {
	t.Helper()
	nul := indexByte(body, 0x00)
	if nul < 0 {
		t.Fatalf("CTOC body has no null-terminated element ID: % x", body)
	}
	elementID = string(body[:nul])
	rest := body[nul+1:]
	if len(rest) < 2 {
		t.Fatalf("CTOC body too short after element ID: % x", body)
	}
	flags = rest[0]
	count := int(rest[1])
	rest = rest[2:]
	for i := 0; i < count; i++ {
		idx := indexByte(rest, 0x00)
		if idx < 0 {
			t.Fatalf("CTOC child %d has no null terminator: % x", i, rest)
		}
		childIDs = append(childIDs, string(rest[:idx]))
		rest = rest[idx+1:]
	}
	return elementID, flags, childIDs
}

func indexByte(b []byte, target byte) int {
	for i, c := range b {
		if c == target {
			return i
		}
	}
	return -1
}
