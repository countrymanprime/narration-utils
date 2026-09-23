package main

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/coverage"
	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
)

// coverageProject writes a project folder with one saved .rpp (one track, one
// item), a manuscript and a confirmed chapter-track link: enough for the
// recording coverage service to plan a check.
func coverageProject(t *testing.T) string {
	t.Helper()
	project := t.TempDir()
	write := func(relative, content string) {
		path := filepath.Join(project, filepath.FromSlash(relative))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write("media/take.wav", "RIFF audio")
	write("book.rpp", `<REAPER_PROJECT 0.1 "7.80/win64" 1789970042 0
  <TRACK {TRACK-1}
    NAME "Chapter One"
    TRACKID {TRACK-1}
    <ITEM
      POSITION 0
      LENGTH 4
      IGUID {ITEM-1}
      SOFFS 0
      PLAYRATE 1 1 0 -1 0 0.0025
      <SOURCE WAVE
        FILE "media/take.wav"
      >
    >
  >
>
`)
	write("narration-utils/manuscript/manuscript.json", `{"schemaVersion":1,"documentId":"doc-1","chapters":[{"id":"c-0001","title":"Chapter One","contentKind":"narration"}],"paragraphs":[{"id":"p-000001","chapterId":"c-0001","index":0,"text":"Alice."}]}`)
	if _, err := evidence.NewMappingStore(project).Confirm("doc-1", "{TRACK-1}", "c-0001", "Chapter One"); err != nil {
		t.Fatal(err)
	}
	return project
}

func TestAttachingAProjectBuildsTheCoverageServiceOverItsSavedProject(t *testing.T) {
	host := NewHost()
	next := host.config
	next.projectFolder = coverageProject(t)
	if attached, reason := host.attachProjectLocked(next); !attached {
		t.Fatalf("attach failed: %s", reason)
	}

	svc := host.services()
	if svc.coverage == nil || svc.coverage != host.coverage {
		t.Fatal("an attached project must have its coverage service in the snapshot")
	}
	// The service finds the project's only .rpp, the manuscript and the link: a chapter never checked reads "never" with
	// no refusal reason (a missing piece would name it: no_project_file, no_manuscript, unmapped).
	result, err := svc.coverage.Result("c-0001", coverage.DefaultAlignmentParams)
	if err != nil || result.State != evidence.StateNever || len(result.Reasons) != 0 {
		t.Fatalf("result = %+v, %v", result, err)
	}
}

// neverExits is a sidecar that runs until the test ends.
type neverExits struct{}

func (neverExits) HasExited() bool       { return false }
func (neverExits) ExitCode() (int, bool) { return 0, false }

func TestCanAttachRejectsARunningRecordingCheck(t *testing.T) {
	host := NewHost()
	project := coverageProject(t)
	var once sync.Once
	launched := make(chan struct{})
	host.coverage = coverage.New(coverage.Config{
		Project: project, Python: "python",
		ProjectFile: func() (string, error) { return filepath.Join(project, "book.rpp"), nil },
		LoadManuscript: func() (map[string]any, error) {
			return map[string]any{"documentId": "doc-1", "chapters": []any{map[string]any{"id": "c-0001", "title": "Chapter One", "contentKind": "narration"}}, "paragraphs": []any{map[string]any{"id": "p-000001", "chapterId": "c-0001", "text": "Alice."}}}, nil
		},
	}, func(context.Context, string, ...string) (coverage.Child, error) {
		once.Do(func() { close(launched) })
		return neverExits{}, nil
	}, nil)
	if !host.canAttachLocked() {
		t.Fatal("an idle coverage service must not block attaching")
	}

	if _, err := host.coverage.Start(coverage.Request{ChapterID: "c-0001", Transcription: coverage.Transcription{Model: "small"}, Alignment: coverage.DefaultAlignmentParams}); err != nil {
		t.Fatal(err)
	}
	<-launched

	if host.canAttachLocked() {
		t.Fatal("a running recording check must prevent a project switch")
	}
}
