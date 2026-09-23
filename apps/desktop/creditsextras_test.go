package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/credits"
	"github.com/countrymanprime/narration-utils/shell/internal/project"
)

// The credits extras (audiobook-credits-templates.prd.md Phase 5): chapter announcements rendered per narration chapter
// (C8, ADR 0151) and the narrator-picked retail sample range (C10, ADR 0152).

// A manuscript with front matter, two narration chapters (one with no subtitle) and a reference chapter; its paragraphs
// are wordsPer words long each, two per chapter.
func writeExtrasManuscript(t *testing.T, folder string, wordsPer int) {
	t.Helper()
	text := strings.TrimSpace(strings.Repeat("word ", wordsPer))
	manuscriptData := map[string]any{
		"schemaVersion": 1, "documentId": "alice", "importedAt": "2026-09-01T09:30:00Z",
		"importer": map[string]any{"format": "docx"}, "source": map[string]any{"fileName": "Alice.docx"},
		"chapters": []any{
			map[string]any{"id": "c-0001", "title": "Front Matter", "index": 0, "wordCount": 2 * wordsPer, "contentKind": "opening"},
			map[string]any{"id": "c-0002", "title": "Chapter 1", "subtitle": "Down the Rabbit-Hole", "index": 1, "wordCount": 2 * wordsPer, "contentKind": "narration"},
			map[string]any{"id": "c-0003", "title": "Chapter 2", "index": 2, "wordCount": 2 * wordsPer, "contentKind": "narration"},
			map[string]any{"id": "c-0004", "title": "Characters", "index": 3, "wordCount": 2 * wordsPer, "contentKind": "reference"},
		},
		"paragraphs": []any{},
	}
	paragraphs := []any{}
	for index, chapter := range []string{"c-0001", "c-0001", "c-0002", "c-0002", "c-0003", "c-0003", "c-0004", "c-0004"} {
		paragraphs = append(paragraphs, map[string]any{"id": "p" + string(rune('1'+index)), "chapterId": chapter, "index": index, "text": text})
	}
	manuscriptData["paragraphs"] = paragraphs
	bytes, err := json.Marshal(manuscriptData)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(folder, "narration-utils", "manuscript", "manuscript.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, bytes, 0o600); err != nil {
		t.Fatal(err)
	}
}

func hostWithExtras(t *testing.T, wordsPer int) *Host {
	t.Helper()
	host := hostWithCredits(t)
	writeExtrasManuscript(t, host.config.projectFolder, wordsPer)
	host.manuscript.SetProject(host.config.projectFolder)
	return host
}

func decodeInto(t *testing.T, encoded string, target any) {
	t.Helper()
	if err := json.Unmarshal([]byte(encoded), target); err != nil {
		t.Fatalf("decode %s: %v", encoded, err)
	}
}

func TestCreditsChapterAnnouncementsRendersOnePerNarrationChapter(t *testing.T) {
	host := hostWithExtras(t, 10)
	if _, err := host.CreditsSaveProjectValues("Alice", "", "", "", "", "", "", "", "", ""); err != nil {
		t.Fatal(err)
	}

	encoded, err := host.CreditsChapterAnnouncements("[Chapter]{: [Chapter Title]}. From [Title].")
	if err != nil {
		t.Fatal(err)
	}

	var got []credits.Announcement
	decodeInto(t, encoded, &got)
	if len(got) != 2 {
		t.Fatalf("got %d announcements, want one per narration chapter (front matter and reference skipped): %+v", len(got), got)
	}
	if got[0].ChapterID != "c-0002" || got[0].Result.Text != "Chapter 1: Down the Rabbit-Hole. From Alice." {
		t.Fatalf("first = %+v", got[0])
	}
	if got[1].Result.Text != "Chapter 2. From Alice." {
		t.Fatalf("second = %+v, want the optional chapter title dropped", got[1])
	}
}

func TestCreditsChapterAnnouncementsWithNoManuscriptSaysToImportOne(t *testing.T) {
	host := hostWithCredits(t)
	host.manuscript.SetProject(host.config.projectFolder)
	if _, err := host.CreditsChapterAnnouncements("[Chapter]."); err == nil || !strings.Contains(err.Error(), "manuscript") {
		t.Fatalf("err = %v, want it to ask for a manuscript", err)
	}
}

func TestCreditsSaveRetailSampleStoresTheRangeOnTheProjectManifest(t *testing.T) {
	host := hostWithExtras(t, 100)

	encoded, err := host.CreditsSaveRetailSample("p4", "p5")
	if err != nil {
		t.Fatal(err)
	}

	var saved retailSampleAnswer
	decodeInto(t, encoded, &saved)
	if saved.Sample == nil || saved.Sample.Words != 200 || saved.Sample.StartChapterID != "c-0002" || saved.Sample.StartLine != 2 || saved.Sample.EndChapterID != "c-0003" || saved.Sample.EndLine != 1 {
		t.Fatalf("saved = %+v", saved.Sample)
	}
	manifest, ok, err := project.Load(host.persist, host.config.projectFolder)
	if err != nil || !ok || manifest.RetailSample == nil || manifest.RetailSample.StartParagraphID != "p4" || manifest.RetailSample.EndParagraphID != "p5" {
		t.Fatalf("manifest = %+v, %v, %v", manifest, ok, err)
	}
	encoded, err = host.CreditsRetailSample()
	if err != nil {
		t.Fatal(err)
	}
	var read retailSampleAnswer
	decodeInto(t, encoded, &read)
	if read.Sample == nil || *read.Sample != *saved.Sample || read.Problem != "" {
		t.Fatalf("read back %+v (%q), want %+v", read.Sample, read.Problem, saved.Sample)
	}
}

func TestCreditsSaveRetailSampleRefusesARangeOverFiveMinutesAndKeepsTheOldOne(t *testing.T) {
	host := hostWithExtras(t, 400)
	if _, err := host.CreditsSaveRetailSample("p3", "p3"); err != nil {
		t.Fatal(err)
	}

	_, err := host.CreditsSaveRetailSample("p3", "p5")

	if err == nil || !strings.Contains(err.Error(), "5 minutes") {
		t.Fatalf("err = %v, want the 5-minute refusal", err)
	}
	manifest, _, _ := project.Load(host.persist, host.config.projectFolder)
	if manifest.RetailSample == nil || manifest.RetailSample.EndParagraphID != "p3" {
		t.Fatalf("the refused range replaced the saved one: %+v", manifest.RetailSample)
	}
}

func TestCreditsSaveRetailSampleWithNoRangeClearsIt(t *testing.T) {
	host := hostWithExtras(t, 100)
	if _, err := host.CreditsSaveRetailSample("p3", "p4"); err != nil {
		t.Fatal(err)
	}

	encoded, err := host.CreditsSaveRetailSample("", "")

	if err != nil {
		t.Fatal(err)
	}
	var cleared retailSampleAnswer
	decodeInto(t, encoded, &cleared)
	if cleared.Sample != nil {
		t.Fatalf("sample = %+v, want none", cleared.Sample)
	}
	manifest, _, _ := project.Load(host.persist, host.config.projectFolder)
	if manifest.RetailSample != nil {
		t.Fatalf("manifest still holds %+v", manifest.RetailSample)
	}
}

// A replaced manuscript can drop the lines a sample pointed at: the sample is kept (it is the narrator's choice) and the
// answer says why it cannot be shown, rather than failing the whole read.
func TestCreditsRetailSampleWhoseLinesAreGoneReportsAProblem(t *testing.T) {
	host := hostWithExtras(t, 100)
	manifest := project.New("Alice", time.Now())
	manifest.RetailSample = &credits.RetailSample{StartParagraphID: "p3", EndParagraphID: "gone"}
	if err := manifest.Save(host.config.projectFolder); err != nil {
		t.Fatal(err)
	}

	encoded, err := host.CreditsRetailSample()

	if err != nil {
		t.Fatal(err)
	}
	var read retailSampleAnswer
	decodeInto(t, encoded, &read)
	if read.Sample != nil || !strings.Contains(read.Problem, "pick the range again") {
		t.Fatalf("read = %+v, %q", read.Sample, read.Problem)
	}
}

func TestCreditsRetailSampleWithNoneSavedIsEmpty(t *testing.T) {
	host := hostWithExtras(t, 100)
	encoded, err := host.CreditsRetailSample()
	if err != nil {
		t.Fatal(err)
	}
	var read retailSampleAnswer
	decodeInto(t, encoded, &read)
	if read.Sample != nil || read.Problem != "" {
		t.Fatalf("read = %+v, %q", read.Sample, read.Problem)
	}
}

func TestCreditsRetailSampleNeedsAProject(t *testing.T) {
	host := hostWithCredits(t)
	host.config.projectFolder = ""
	if _, err := host.CreditsRetailSample(); err == nil {
		t.Fatal("read without a project")
	}
	if _, err := host.CreditsSaveRetailSample("p1", "p1"); err == nil {
		t.Fatal("saved without a project")
	}
}
