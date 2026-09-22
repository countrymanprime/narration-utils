package manuscript

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/importer"
	"github.com/countrymanprime/narration-utils/shell/internal/layout"
)

func TestCommitCreatesProjectOwnedCanonicalManuscript(t *testing.T) {
	project := t.TempDir()
	service := New(project)
	job := service.Begin(layout.RepoFile(layout.FixturesDir + "/alice.md"))
	preview, err := service.Preview(job.ID, 1)
	if err != nil || preview.Phase != "ready" {
		t.Fatalf("preview = %#v, %v", preview, err)
	}
	committed, err := service.Commit(job.ID, false, nil)
	if err != nil || committed.Phase != "success" {
		t.Fatalf("commit = %#v, %v", committed, err)
	}
	canonical, err := service.Load()
	if err != nil {
		t.Fatal(err)
	}
	if canonical["documentId"] == "" || len(canonical["chapters"].([]any)) != 3 {
		t.Fatalf("unexpected canonical manuscript: %#v", canonical)
	}
}

func TestCommittedManuscriptKeepsLineBreaksAndFormattingSpans(t *testing.T) {
	project := t.TempDir()
	source := filepath.Join(project, "book.md")
	if err := os.WriteFile(source, []byte("# Chapter One\nRoses are *red*,  \nviolets are blue.\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	service := New(project)
	job := service.Begin(source)
	if _, err := service.Preview(job.ID, 1); err != nil {
		t.Fatal(err)
	}
	if committed, err := service.Commit(job.ID, false, nil); err != nil || committed.Phase != "success" {
		t.Fatalf("commit = %#v, %v", committed, err)
	}
	reader, err := service.Reader()
	if err != nil {
		t.Fatal(err)
	}
	paragraph := reader["paragraphs"].([]map[string]any)[0]
	if got, want := paragraph["text"], "Roses are red,\nviolets are blue."; got != want {
		t.Fatalf("text = %q want %q", got, want)
	}
	spans, ok := paragraph["spans"].([]any)
	if !ok || len(spans) != 1 || spans[0].(map[string]any)["style"] != "italic" {
		t.Fatalf("spans = %#v", paragraph["spans"])
	}
}

func TestImportJobReportsRealProgressAndLogs(t *testing.T) {
	project := t.TempDir()
	source := filepath.Join(project, "book.md")
	if err := os.WriteFile(source, []byte("# Chapter One\nBody text.\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	service := New(project)
	job := service.Begin(source)

	started, err := service.StartPreview(job.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	previewed := waitForJob(t, service, started.ID, "ready")
	if previewed.Percent != 100 || len(previewed.Logs) < 4 {
		t.Fatalf("preview should log its stages, got percent %d logs %#v", previewed.Percent, previewed.Logs)
	}

	post := func(report func(int, string)) error {
		report(0, "Adding character 1 of 2")
		report(100, "Adding character 2 of 2")
		return nil
	}
	if _, err := service.StartCommit(job.ID, false, nil, post); err != nil {
		t.Fatal(err)
	}
	done := waitForJob(t, service, job.ID, "success")
	logs := strings.Join(done.Logs, "\n")
	for _, want := range []string{"Copying book.md", "Building the canonical manuscript", "Adding character 2 of 2", "Manuscript imported"} {
		if !strings.Contains(logs, want) {
			t.Fatalf("log is missing %q:\n%s", want, logs)
		}
	}
	// Elapsed comes from the monotonic clock, which ticks every 0.5 to 15.6 ms on Windows, so a commit of a
	// two-line file can measure exactly zero. What this test can assert is that the field is reported and sane;
	// TestElapsedIsTheTimeBetweenStartAndEnd pins the arithmetic with fixed times.
	if done.Percent != 100 || done.Elapsed < 0 {
		t.Fatalf("percent %d elapsed %v", done.Percent, done.Elapsed)
	}
	// A finished job has recorded its end: its elapsed time no longer grows. This holds whatever the clock's tick,
	// and it fails if the end time is never set (a running job reports the time since it started).
	time.Sleep(50 * time.Millisecond)
	again, err := service.State(job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if again.Elapsed != done.Elapsed {
		t.Fatalf("elapsed kept growing after the job finished: %v then %v", done.Elapsed, again.Elapsed)
	}
}

func TestElapsedIsTheTimeBetweenStartAndEnd(t *testing.T) {
	started := time.Date(2026, 9, 20, 9, 0, 0, 0, time.UTC)

	finished := copyJob(&ImportJob{started: started, ended: started.Add(1500 * time.Millisecond)})
	if finished.Elapsed != 1.5 {
		t.Fatalf("a finished job reports its start-to-end time: got %v want 1.5", finished.Elapsed)
	}

	running := copyJob(&ImportJob{started: time.Now().Add(-2 * time.Second)})
	if running.Elapsed < 2 || running.Elapsed > 30 {
		t.Fatalf("a running job reports the time since it started: got %v want about 2", running.Elapsed)
	}

	if unstarted := copyJob(&ImportJob{}); unstarted.Elapsed != 0 {
		t.Fatalf("a job that has not started reports 0, got %v", unstarted.Elapsed)
	}
}

func waitForJob(t *testing.T, service *Service, id, phase string) ImportJob {
	t.Helper()
	last := -1
	for deadline := time.Now().Add(10 * time.Second); time.Now().Before(deadline); time.Sleep(2 * time.Millisecond) {
		state, err := service.State(id)
		if err != nil {
			t.Fatal(err)
		}
		if state.Percent < last {
			t.Fatalf("progress moved backwards: %d then %d", last, state.Percent)
		}
		last = state.Percent
		if state.Phase == "error" {
			t.Fatalf("job failed: %s", state.Error)
		}
		if state.Phase == phase {
			return state
		}
	}
	t.Fatalf("job never reached %q", phase)
	return ImportJob{}
}

func TestReplacementRequiresExplicitConfirmation(t *testing.T) {
	project := t.TempDir()
	service := New(project)
	first := service.Begin(layout.RepoFile(layout.FixturesDir + "/alice.md"))
	if _, err := service.Preview(first.ID, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Commit(first.ID, false, nil); err != nil {
		t.Fatal(err)
	}
	second := service.Begin(layout.RepoFile(layout.FixturesDir + "/alice.md"))
	if _, err := service.Preview(second.ID, 1); err != nil {
		t.Fatal(err)
	}
	job, err := service.Commit(second.ID, false, nil)
	if err != nil || !job.RequiresReset {
		t.Fatalf("expected reset confirmation, got %#v, %v", job, err)
	}
}

// The review shows each section's subtitle, and the chapter is written from the paragraph that starts it: the two must agree, or the
// review would promise a name the reader never shows. A repeated title merges, and the first heading's subtitle wins in both.
func TestPreviewSectionSubtitlesAreTheSubtitlesTheWrittenChaptersGet(t *testing.T) {
	project := t.TempDir()
	source := filepath.Join(project, "book.md")
	content := "# Chapter One<br>Down the Rabbit-Hole\nText.\n\n# Chapter Two\nMore.\n\n# Chapter One<br>A Later Subtitle\nLater.\n"
	if err := os.WriteFile(source, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	service := New(project)
	job := service.Begin(source)
	preview, err := service.Preview(job.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	sections, ok := preview.Preview["sections"].([]importer.DraftSection)
	if !ok || len(sections) != 2 {
		t.Fatalf("preview sections = %#v", preview.Preview["sections"])
	}
	if _, err := service.Commit(job.ID, false, nil); err != nil {
		t.Fatal(err)
	}
	chapters, err := service.Chapters()
	if err != nil {
		t.Fatal(err)
	}
	for index, section := range sections {
		written, _ := chapters[index]["subtitle"].(string)
		if chapters[index]["title"] != section.Title || written != section.Subtitle {
			t.Errorf("section %q shows subtitle %q but the chapter is written with %q", section.Title, section.Subtitle, written)
		}
	}
	if sections[0].Subtitle != "Down the Rabbit-Hole" || sections[1].Subtitle != "" {
		t.Errorf("subtitles = %q and %q", sections[0].Subtitle, sections[1].Subtitle)
	}
}
