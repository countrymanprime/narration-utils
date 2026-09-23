package stages_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/manuscript"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

// metProvider reports recording.text met for every chapter.
type metProvider struct{}

func (metProvider) Stage() stages.Stage { return stages.StageRecording }
func (metProvider) SignalIDs() []string { return []string{"recording.text"} }
func (metProvider) Signals(context.Context, stages.ChapterContext, stages.EvidenceView) ([]stages.Signal, error) {
	return []stages.Signal{{
		ID: "recording.text", Stage: stages.StageRecording, State: stages.SignalMet, Reason: "every paragraph read",
		Evidence: []stages.Evidence{}, Basis: stages.Basis{LedgerRecordIDs: []string{"rec-1"}, Fingerprint: "fp-1"},
	}}, nil
}

func writeCanonical(t *testing.T, project string) {
	t.Helper()
	dir := filepath.Join(project, "narration-utils", "manuscript")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	canonical := map[string]any{
		"schemaVersion": 1, "documentId": "doc-1",
		"chapters":   []any{map[string]any{"id": "c-0001", "title": "Chapter One", "index": 0, "wordCount": 3, "contentKind": "narration"}},
		"paragraphs": []any{map[string]any{"id": "p-0001", "chapterId": "c-0001", "chapterTitle": "Chapter One", "index": 0, "text": "It was dark."}},
	}
	encoded, err := json.Marshal(canonical)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "manuscript.json"), encoded, 0o644); err != nil {
		t.Fatal(err)
	}
}

// snapshot reads every file under root, keyed by its slash path.
func snapshot(t *testing.T, root string) map[string][]byte {
	t.Helper()
	files := map[string][]byte{}
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(root, path)
		files[filepath.ToSlash(relative)] = content
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return files
}

func changedFiles(before, after map[string][]byte) []string {
	changed := []string{}
	for path, content := range after {
		if previous, ok := before[path]; !ok || !bytes.Equal(previous, content) {
			changed = append(changed, path)
		}
	}
	for path := range before {
		if _, ok := after[path]; !ok {
			changed = append(changed, path)
		}
	}
	slices.Sort(changed)
	return changed
}

// Confirm changes the chapter status and the decisions file, and nothing else
// in the project (the PRD's filesystem-diff success signal).
func TestConfirmWritesOnlyTheStatusAndTheDecisionsFile(t *testing.T) {
	project := t.TempDir()
	writeCanonical(t, project)
	notes := manuscript.New(project)
	if _, err := notes.SetChapterStatus("c-0001", "recording"); err != nil {
		t.Fatal(err)
	}
	service := stages.NewService(stages.Config{
		Project:        project,
		LoadManuscript: notes.Load,
		Chapters:       notes.Chapters,
		SetChapterStatus: func(chapterID string, status stages.Stage) error {
			_, err := notes.SetChapterStatus(chapterID, string(status))
			return err
		},
		Providers: []stages.Provider{metProvider{}},
		Now:       func() time.Time { return time.Date(2026, 9, 23, 12, 0, 0, 0, time.UTC) },
	})
	shown, err := service.Recommendations(context.Background())
	if err != nil || len(shown) != 1 || shown[0].Verdict != stages.VerdictRecommended {
		t.Fatalf("before Confirm: %+v, %v", shown, err)
	}
	before := snapshot(t, project)

	if _, err := service.Confirm(context.Background(), "c-0001", stages.StageEditing, shown[0].BasisKey); err != nil {
		t.Fatal(err)
	}

	want := []string{"narration-utils/manuscript-notes.json", "narration-utils/stage-decisions.json"}
	if got := changedFiles(before, snapshot(t, project)); !slices.Equal(got, want) {
		t.Fatalf("Confirm changed %v, want exactly %v", got, want)
	}
	chapters, err := notes.Chapters()
	if err != nil || chapters[0]["status"] != "editing" {
		t.Fatalf("status after Confirm: %+v, %v", chapters, err)
	}
}
