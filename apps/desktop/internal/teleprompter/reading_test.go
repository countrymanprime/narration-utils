package teleprompter

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
)

// The prompter's last position per chapter (read-aloud-resume-from-daw PRD
// Phase 2, ADR 0205).

const readingManuscript = `{"documentId":"doc-1","chapters":[{"id":"c1","title":"One"},{"id":"c2","title":"Two"}],
"paragraphs":[{"id":"p1","chapterId":"c1","text":"Hello there old friend."},{"id":"p2","chapterId":"c2","text":"Another chapter."}]}`

func writeManuscript(t *testing.T, project, body string) {
	t.Helper()
	dir := filepath.Join(project, "narration-utils", "manuscript")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "manuscript.json"), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

var readingTime = time.Date(2026, 9, 25, 10, 0, 0, 0, time.UTC)

func TestAReadingRoundTripsWhileTheChapterTextIsUnchanged(t *testing.T) {
	project := t.TempDir()
	writeManuscript(t, project, readingManuscript)
	if err := WriteReading(project, "c1", 3, 4, "listening", readingTime); err != nil {
		t.Fatal(err)
	}
	got, err := LoadReading(project, "c1")
	if err != nil {
		t.Fatal(err)
	}
	if got == nil || got.ChapterID != "c1" || got.Read != 3 || got.Tokens != 4 || got.Status != "listening" || !got.EndedAt.Equal(readingTime) || got.ScriptHash == "" || got.Version != readingSchemaVersion {
		t.Fatalf("LoadReading = %+v", got)
	}
	if _, err := os.Stat(filepath.Join(project, "narration-utils", "teleprompter", "c1.reading.json")); err != nil {
		t.Fatal(err)
	}
	if other, _ := LoadReading(project, "c2"); other != nil {
		t.Fatalf("another chapter read %+v", other)
	}
}

func TestAnEditedChapterDropsItsReading(t *testing.T) {
	project := t.TempDir()
	writeManuscript(t, project, readingManuscript)
	if err := WriteReading(project, "c1", 3, 4, "listening", readingTime); err != nil {
		t.Fatal(err)
	}
	writeManuscript(t, project, strings.Replace(readingManuscript, "old friend", "new friend", 1))
	if got, err := LoadReading(project, "c1"); err != nil || got != nil {
		t.Fatalf("LoadReading after an edit = %+v, %v", got, err)
	}
}

func TestAReImportDropsTheReadingEvenWithTheSameText(t *testing.T) {
	project := t.TempDir()
	writeManuscript(t, project, readingManuscript)
	if err := WriteReading(project, "c1", 3, 4, "listening", readingTime); err != nil {
		t.Fatal(err)
	}
	writeManuscript(t, project, strings.Replace(readingManuscript, "doc-1", "doc-2", 1))
	if got, _ := LoadReading(project, "c1"); got != nil {
		t.Fatalf("a new document read %+v", got)
	}
}

func TestAReadingForAChapterNotInTheManuscriptIsRefused(t *testing.T) {
	project := t.TempDir()
	writeManuscript(t, project, readingManuscript)
	if err := WriteReading(project, "c9", 1, 4, "listening", readingTime); err == nil {
		t.Fatal("a chapter that is not in the manuscript named a file")
	}
	entries, _ := os.ReadDir(ReadingDir(project))
	if len(entries) != 0 {
		t.Fatalf("files written: %v", entries)
	}
}

func TestAChapterIDIsNeverUsedAsAPath(t *testing.T) {
	for _, id := range []string{"../../evil", `..\evil`, "a/b", "", ".hidden", "c:1", strings.Repeat("x", 200)} {
		name := readingFileName(id)
		if strings.ContainsAny(name, `/\:`) || strings.HasPrefix(name, ".") || !strings.HasSuffix(name, ".reading.json") || len(name) > 100 {
			t.Fatalf("readingFileName(%q) = %q", id, name)
		}
	}
	if readingFileName("c-0001") != "c-0001.reading.json" {
		t.Fatalf("a plain id is not kept readable: %q", readingFileName("c-0001"))
	}
	if readingFileName("a/b") == readingFileName("a\\b") {
		t.Fatal("two ids share a file")
	}
}

func TestAnOutOfRangeOrCorruptReadingReadsAsAbsent(t *testing.T) {
	project := t.TempDir()
	writeManuscript(t, project, readingManuscript)
	if err := WriteReading(project, "c1", 9, 4, "listening", readingTime); err == nil {
		t.Fatal("a read past the tokens was written")
	}
	if err := os.MkdirAll(ReadingDir(project), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{"{not json", `{"version":99,"chapterId":"c1","read":1,"tokens":4}`} {
		if err := os.WriteFile(filepath.Join(ReadingDir(project), "c1.reading.json"), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
		if got, err := LoadReading(project, "c1"); err != nil || got != nil {
			t.Fatalf("LoadReading(%s) = %+v, %v", body, got, err)
		}
	}
}

func TestContractReading(t *testing.T) {
	project := t.TempDir()
	writeManuscript(t, project, readingManuscript)
	if err := WriteReading(project, "c1", 3, 4, "done", readingTime); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(ReadingDir(project), "c1.reading.json"))
	if err != nil {
		t.Fatal(err)
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "teleprompter-reading", value)
}

// --- the write at session end ---

func newReadingFixture(t *testing.T, mode string) *fixture {
	t.Helper()
	f := newFixture(t, mode)
	writeManuscript(t, f.project, readingManuscript)
	return f
}

func TestStoppingASessionKeepsItsLastPosition(t *testing.T) {
	f := newReadingFixture(t, "stream")
	if err := f.service.Start(validOptions()); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the position event", func() bool { return f.recorder.firstEvent("position") != nil })
	f.service.Stop()
	waitFor(t, "the stopped phase", func() bool { return phase(f.service) == "stopped" })

	got, err := LoadReading(f.project, "c1")
	if err != nil || got == nil || got.Read != 1 || got.Tokens != 4 || got.Status != "listening" || got.EndedAt.IsZero() {
		t.Fatalf("LoadReading = %+v, %v", got, err)
	}
}

func TestASessionThatEndsItselfAtDoneKeepsTheEnd(t *testing.T) {
	f := newReadingFixture(t, "done")
	if err := f.service.Start(validOptions()); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the done position", func() bool {
		f.recorder.mu.Lock()
		defer f.recorder.mu.Unlock()
		for _, event := range f.recorder.events {
			if event["status"] == "done" {
				return true
			}
		}
		return false
	})
	f.service.Stop()
	waitFor(t, "the stopped phase", func() bool { return phase(f.service) == "stopped" })
	if got, _ := LoadReading(f.project, "c1"); got == nil || got.Read != 4 || got.Status != "done" {
		t.Fatalf("LoadReading = %+v", got)
	}
}

func TestASessionThatNeverPositionedWritesNothing(t *testing.T) {
	f := newReadingFixture(t, "crash")
	if err := f.service.Start(validOptions()); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the error phase", func() bool { return phase(f.service) == "error" })
	if entries, _ := os.ReadDir(ReadingDir(f.project)); len(entries) != 0 {
		t.Fatalf("files written: %v", entries)
	}
}

func TestACreditsSessionWritesNothing(t *testing.T) {
	f := newReadingFixture(t, "stream")
	if err := f.service.StartScript(Script{ID: "c1", Title: "Opening credits", Text: "Read by the author."}, scriptOptions()); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the position event", func() bool { return f.recorder.firstEvent("position") != nil })
	f.service.Stop()
	waitFor(t, "the stopped phase", func() bool { return phase(f.service) == "stopped" })
	if entries, _ := os.ReadDir(ReadingDir(f.project)); len(entries) != 0 {
		t.Fatalf("files written: %v", entries)
	}
}
