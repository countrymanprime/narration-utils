package manuscript

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/coverage"
	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
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

// The review shows what the importer repaired in the source (a title and subtitle it found run together) where the preview log used to be the
// only place that said so, so the repairs travel in the preview itself, and only when there are some.
func TestPreviewPayloadCarriesTheRepairsTheImporterMade(t *testing.T) {
	repaired := previewPayload(importer.Draft{Format: "docx", SourceName: "a.docx", Notices: []string{"Heading \"CHAPTER ONEBad\" was split."}})
	if got, ok := repaired["notices"].([]string); !ok || len(got) != 1 || !strings.Contains(got[0], "CHAPTER ONE") {
		t.Fatalf("notices = %#v", repaired["notices"])
	}
	untouched := previewPayload(importer.Draft{Format: "markdown", SourceName: "a.md"})
	if _, present := untouched["notices"]; present {
		t.Fatalf("a preview with no repairs must not carry the field, got %#v", untouched["notices"])
	}
}

// Findings are anchored to manuscript chapter and paragraph ids
// (review-dashboard-and-findings-adoption.prd.md Q5): resetDerived, run on a
// confirmed manuscript replace and on Clear, must clear them along with the
// other derived, manuscript-anchored folders.
func TestResetDerivedClearsTheFindingsDirectory(t *testing.T) {
	project := t.TempDir()
	findingsFile := filepath.Join(project, "narration-utils", "findings", "transcript_compare", "c-0001.json")
	if err := os.MkdirAll(filepath.Dir(findingsFile), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(findingsFile, []byte("[]"), 0o644); err != nil {
		t.Fatal(err)
	}
	settingsFile := filepath.Join(project, "narration-utils", "settings.json")
	if err := os.WriteFile(settingsFile, []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := resetDerived(project); err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(filepath.Join(project, "narration-utils", "findings")); !os.IsNotExist(err) {
		t.Fatalf("expected the findings directory to be removed, stat err = %v", err)
	}
	if _, err := os.Stat(settingsFile); err != nil {
		t.Fatalf("resetDerived must not touch narration-utils/settings.json: %v", err)
	}
}

// resetDerived clears everything a re-import or an explicit Clear invalidates. The analysis evidence ledger PRD's Q3
// ("Add the directory to resetDerived") adds evidence.LedgerDir alongside the existing entries: a ledger record names
// fingerprints computed against the manuscript that produced its chapter IDs, so it must not survive a re-import that
// assigns new ones (Q9), the same reasoning ManuscriptGuide and TranscriptCompare already follow here.
func TestResetDerivedClearsTheAnalysisLedgerDirectory(t *testing.T) {
	project := t.TempDir()
	ledgerDir := evidence.LedgerDir(project)
	if err := os.MkdirAll(ledgerDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ledgerDir, "record.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}

	if err := resetDerived(project); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(ledgerDir); !os.IsNotExist(err) {
		t.Fatalf("resetDerived left the analysis ledger directory behind: %v", err)
	}
}

// The recording coverage service keeps its stored results (and a running check's folder) under coverage.Dir; they name
// chapter and paragraph ids and the ledger records resetDerived also clears, so they go with them
// (recording-coverage-analysis.prd.md Phase 4).
func TestResetDerivedClearsTheRecordingCoverageDirectory(t *testing.T) {
	project := t.TempDir()
	results := filepath.Join(coverage.Dir(project), "results")
	if err := os.MkdirAll(results, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(results, "record.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}

	if err := resetDerived(project); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(coverage.Dir(project)); !os.IsNotExist(err) {
		t.Fatalf("resetDerived left the recording coverage directory behind: %v", err)
	}
}

func TestClearRemovesTheAnalysisLedgerDirectoryAlongsideManuscriptData(t *testing.T) {
	project := t.TempDir()
	service := New(project)
	job := service.Begin(layout.RepoFile(layout.FixturesDir + "/alice.md"))
	if _, err := service.Preview(job.ID, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Commit(job.ID, false, nil); err != nil {
		t.Fatal(err)
	}
	ledgerDir := evidence.LedgerDir(project)
	if err := os.MkdirAll(ledgerDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ledgerDir, "record.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}

	if err := service.Clear(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(ledgerDir); !os.IsNotExist(err) {
		t.Fatalf("Clear left the analysis ledger directory behind: %v", err)
	}
}

// The evidence ledger PRD's Phase 4 (Q5) adds the per-item result cache
// directory alongside LedgerDir for the same reason: a cache entry's key
// includes the source identity but not the chapter ID, yet its value was
// produced for items under a chapter ID a re-import invalidates (Q9), so it
// must not survive either.
func TestResetDerivedClearsTheAnalysisCacheDirectory(t *testing.T) {
	project := t.TempDir()
	cacheDir := evidence.CacheDir(project)
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(cacheDir, "entry.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}

	if err := resetDerived(project); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(cacheDir); !os.IsNotExist(err) {
		t.Fatalf("resetDerived left the analysis cache directory behind: %v", err)
	}
}

func TestClearRemovesTheAnalysisCacheDirectoryAlongsideManuscriptData(t *testing.T) {
	project := t.TempDir()
	service := New(project)
	job := service.Begin(layout.RepoFile(layout.FixturesDir + "/alice.md"))
	if _, err := service.Preview(job.ID, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Commit(job.ID, false, nil); err != nil {
		t.Fatal(err)
	}
	cacheDir := evidence.CacheDir(project)
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(cacheDir, "entry.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}

	if err := service.Clear(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(cacheDir); !os.IsNotExist(err) {
		t.Fatalf("Clear left the analysis cache directory behind: %v", err)
	}
}

// The evidence ledger PRD's Phase 5 (Q6, Q9 option A) adds the confirmed
// chapter-track mapping file alongside LedgerDir and CacheDir: a mapping
// names a chapter ID a re-import invalidates, so it must not survive one
// either. Unlike the ledger and cache, this is a single file, not a
// directory of records.
func TestResetDerivedClearsTheChapterTrackMappingFile(t *testing.T) {
	project := t.TempDir()
	mappingFile := evidence.MappingFile(project)
	if err := os.MkdirAll(filepath.Dir(mappingFile), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(mappingFile, []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}

	if err := resetDerived(project); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(mappingFile); !os.IsNotExist(err) {
		t.Fatalf("resetDerived left the chapter-track mapping file behind: %v", err)
	}
}

func TestClearRemovesTheChapterTrackMappingFileAlongsideManuscriptData(t *testing.T) {
	project := t.TempDir()
	service := New(project)
	job := service.Begin(layout.RepoFile(layout.FixturesDir + "/alice.md"))
	if _, err := service.Preview(job.ID, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Commit(job.ID, false, nil); err != nil {
		t.Fatal(err)
	}
	mappingFile := evidence.MappingFile(project)
	if err := os.MkdirAll(filepath.Dir(mappingFile), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(mappingFile, []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}

	if err := service.Clear(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(mappingFile); !os.IsNotExist(err) {
		t.Fatalf("Clear left the chapter-track mapping file behind: %v", err)
	}
}
