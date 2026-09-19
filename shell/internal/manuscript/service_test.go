package manuscript

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCommitCreatesProjectOwnedCanonicalManuscript(t *testing.T) {
	project := t.TempDir()
	service := New(project)
	job := service.Begin(filepath.Join("..", "..", "..", "shared", "test-fixtures", "alice.md"))
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
	if done.Percent != 100 || done.Elapsed <= 0 {
		t.Fatalf("percent %d elapsed %v", done.Percent, done.Elapsed)
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
	first := service.Begin(filepath.Join("..", "..", "..", "shared", "test-fixtures", "alice.md"))
	if _, err := service.Preview(first.ID, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Commit(first.ID, false, nil); err != nil {
		t.Fatal(err)
	}
	second := service.Begin(filepath.Join("..", "..", "..", "shared", "test-fixtures", "alice.md"))
	if _, err := service.Preview(second.ID, 1); err != nil {
		t.Fatal(err)
	}
	job, err := service.Commit(second.ID, false, nil)
	if err != nil || !job.RequiresReset {
		t.Fatalf("expected reset confirmation, got %#v, %v", job, err)
	}
}
