package manuscript

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

// A chapter's kind can change after import: "Remove from recording" reclassifies it as reference material and Restore
// makes it narration again (chapter-track-link-control PRD Phase 3, TL2, TL5).

var kindTime = time.Date(2026, 9, 25, 12, 0, 0, 0, time.UTC)

func manuscriptBytes(t *testing.T, project string) map[string]any {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(project, "narration-utils", "manuscript", "manuscript.json"))
	if err != nil {
		t.Fatal(err)
	}
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		t.Fatal(err)
	}
	return data
}

func chapterByID(t *testing.T, service *Service, id string) map[string]any {
	t.Helper()
	chapters, err := service.Chapters()
	if err != nil {
		t.Fatal(err)
	}
	for _, chapter := range chapters {
		if chapter["id"] == id {
			return chapter
		}
	}
	t.Fatalf("chapter %s not listed", id)
	return nil
}

func TestRemovingAChapterFromRecordingReclassifiesItAndKeepsEverythingElse(t *testing.T) {
	project := t.TempDir()
	service := New(project)
	importAlice(t, service, false)
	before := manuscriptBytes(t, project)
	if _, err := service.SetChapterStatus("c-0002", "editing"); err != nil {
		t.Fatal(err)
	}

	result, err := service.SetChapterKind("c-0002", "reference", kindTime)

	if err != nil {
		t.Fatal(err)
	}
	if result.PreviousKind != "narration" || result.Chapter["contentKind"] != "reference" || result.Chapter["removedFromRecording"] != true {
		t.Fatalf("result = %+v", result)
	}
	after := manuscriptBytes(t, project)
	for _, key := range []string{"documentId", "importedAt", "importer", "source", "paragraphs", "schemaVersion"} {
		if !reflect.DeepEqual(before[key], after[key]) {
			t.Fatalf("%s changed", key)
		}
	}
	chapters := objects(after["chapters"])
	for i, chapter := range chapters {
		old := objects(before["chapters"])[i]
		if chapter["id"] != "c-0002" {
			if !reflect.DeepEqual(chapter, old) {
				t.Fatalf("chapter %v changed: %v", old["id"], chapter)
			}
			continue
		}
		if chapter["contentKind"] != "reference" || chapter["importedKind"] != "narration" || chapter["kindChangedAt"] != "2026-09-25T12:00:00Z" || chapter["title"] != old["title"] {
			t.Fatalf("changed chapter = %v", chapter)
		}
	}
	// The status is kept, and the chapter list (read again, not from a stale cache) reports the new kind.
	listed := chapterByID(t, service, "c-0002")
	if listed["status"] != "editing" || listed["contentKind"] != "reference" || listed["removedFromRecording"] != true || listed["kindChangedAt"] != "2026-09-25T12:00:00Z" {
		t.Fatalf("listed = %v", listed)
	}
	if _, err := os.Stat(filepath.Join(project, "narration-utils", "manuscript", "manuscript.json.tmp")); !os.IsNotExist(err) {
		t.Fatal("the temporary file was left behind")
	}
}

func TestRestoringAChapterBringsItBackWithItsStatus(t *testing.T) {
	project := t.TempDir()
	service := New(project)
	importAlice(t, service, false)
	if _, err := service.SetChapterStatus("c-0002", "proofing"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetChapterKind("c-0002", "opening", kindTime); err != nil {
		t.Fatal(err)
	}

	result, err := service.SetChapterKind("c-0002", "narration", kindTime.Add(time.Hour))

	if err != nil {
		t.Fatal(err)
	}
	if result.PreviousKind != "opening" || result.Chapter["removedFromRecording"] != nil || result.Chapter["status"] != "proofing" {
		t.Fatalf("result = %+v", result)
	}
	// The kind it was imported as is kept from the first change.
	chapter := objects(manuscriptBytes(t, project)["chapters"])[1]
	if chapter["importedKind"] != "narration" || chapter["contentKind"] != "narration" {
		t.Fatalf("chapter = %v", chapter)
	}
}

func TestAChapterKindChangeIsRefusedWhenItWouldBreakSomething(t *testing.T) {
	project := t.TempDir()
	service := New(project)
	importAlice(t, service, false)
	chapters, err := service.Chapters()
	if err != nil {
		t.Fatal(err)
	}

	if _, err := service.SetChapterKind("c-0001", "chapter", kindTime); err == nil || !strings.Contains(err.Error(), "kind") {
		t.Fatalf("an unknown kind: err = %v", err)
	}
	if _, err := service.SetChapterKind("c-9999", "reference", kindTime); err == nil {
		t.Fatal("an unknown chapter was changed")
	}
	// Every narration chapter but one can go; the last is refused.
	narration := []string{}
	for _, chapter := range chapters {
		if chapter["contentKind"] == "narration" {
			narration = append(narration, chapter["id"].(string))
		}
	}
	for _, id := range narration[:len(narration)-1] {
		if _, err := service.SetChapterKind(id, "reference", kindTime); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := service.SetChapterKind(narration[len(narration)-1], "reference", kindTime); err == nil || !strings.Contains(err.Error(), "last") {
		t.Fatalf("the last narration chapter: err = %v", err)
	}
	// Setting the kind a chapter already has changes nothing, and writes nothing.
	info, _ := os.Stat(filepath.Join(project, "narration-utils", "manuscript", "manuscript.json"))
	result, err := service.SetChapterKind(narration[0], "reference", kindTime.Add(time.Hour))
	if err != nil || result.PreviousKind != "reference" || result.Chapter["kindChangedAt"] != "2026-09-25T12:00:00Z" {
		t.Fatalf("result = %+v, err = %v", result, err)
	}
	if again, _ := os.Stat(filepath.Join(project, "narration-utils", "manuscript", "manuscript.json")); !again.ModTime().Equal(info.ModTime()) {
		t.Fatal("an unchanged kind rewrote the manuscript")
	}
}

func TestAChapterKindChangeWaitsForAnImport(t *testing.T) {
	project := t.TempDir()
	service := New(project)
	importAlice(t, service, false)
	job := service.Begin(filepath.Join(project, "missing.md"))
	defer func() { _ = service.Cancel(job.ID) }()

	if _, err := service.SetChapterKind("c-0002", "reference", kindTime); err == nil || !strings.Contains(err.Error(), "import") {
		t.Fatalf("err = %v", err)
	}
}

func TestAChapterKindChangeNeedsAManuscript(t *testing.T) {
	if _, err := New(t.TempDir()).SetChapterKind("c-0001", "reference", kindTime); err == nil {
		t.Fatal("expected an error")
	}
	if _, err := New("").SetChapterKind("c-0001", "reference", kindTime); err == nil {
		t.Fatal("expected an error")
	}
}
