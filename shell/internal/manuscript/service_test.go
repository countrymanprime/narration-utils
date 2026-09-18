package manuscript

import (
	"path/filepath"
	"testing"
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
