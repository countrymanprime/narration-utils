package manuscript

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// collectEnds returns a channel that receives a copy of every job the service reports as ended.
func collectEnds(service *Service) chan ImportJob {
	ended := make(chan ImportJob, 4)
	service.SetOnJobEnd(func(job ImportJob) { ended <- job })
	return ended
}

func expectEnd(t *testing.T, ended chan ImportJob) ImportJob {
	t.Helper()
	select {
	case job := <-ended:
		return job
	case <-time.After(10 * time.Second):
		t.Fatal("the service never reported the job as ended")
		return ImportJob{}
	}
}

func previewedImport(t *testing.T, service *Service, project string) ImportJob {
	t.Helper()
	source := filepath.Join(project, "book.md")
	if err := os.WriteFile(source, []byte("# Chapter One\nBody text.\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	job := service.Begin(source)
	if _, err := service.StartPreview(job.ID, 1); err != nil {
		t.Fatal(err)
	}
	waitForJob(t, service, job.ID, "ready")
	return job
}

func TestACommitReportsItsEndOnceAndAPreviewDoesNot(t *testing.T) {
	project := t.TempDir()
	service := New(project)
	ended := collectEnds(service)
	job := previewedImport(t, service, project)
	select {
	case got := <-ended:
		t.Fatalf("a preview that is ready is not an end, got %+v", got)
	case <-time.After(100 * time.Millisecond):
	}
	if _, err := service.StartCommit(job.ID, false, nil, nil); err != nil {
		t.Fatal(err)
	}
	got := expectEnd(t, ended)
	if got.ID != job.ID || got.Kind != "manuscript_import" || got.Phase != "success" || got.Message != "Manuscript imported." {
		t.Fatalf("ended job = %+v", got)
	}
	select {
	case again := <-ended:
		t.Fatalf("a second end was reported: %+v", again)
	case <-time.After(100 * time.Millisecond):
	}
}

func TestAFailedCommitReportsItsEndWithTheReason(t *testing.T) {
	project := t.TempDir()
	service := New(project)
	ended := collectEnds(service)
	job := previewedImport(t, service, project)
	failing := func(func(int, string)) error { return fmt.Errorf("the Story Bible could not be seeded") }
	if _, err := service.StartCommit(job.ID, false, nil, failing); err != nil {
		t.Fatal(err)
	}
	got := expectEnd(t, ended)
	if got.Phase != "error" || got.Message != "the Story Bible could not be seeded" {
		t.Fatalf("ended job = %+v", got)
	}
}

func TestACommitWithNobodyListeningStillFinishes(t *testing.T) {
	project := t.TempDir()
	service := New(project)
	job := previewedImport(t, service, project)
	if _, err := service.StartCommit(job.ID, false, nil, nil); err != nil {
		t.Fatal(err)
	}
	waitForJob(t, service, job.ID, "success")
}
