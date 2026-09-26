package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
)

// previewSuggestProject writes a project folder with just a canonical manuscript
// (proofing-preview-suggestion.prd.md Phase 2 needs nothing else: PreviewCandidates only ever reads the manuscript
// service). manuscriptJSON is written verbatim at the path manuscript import itself writes to
// (takeReviewManuscriptPath). Named "Suggest" (preview.Suggest, this PRD's own engine entry point) to avoid clashing
// with guidepreview_test.go's unrelated previewHost/previewProject (GuidePreview's own test helpers).
func previewSuggestProject(t *testing.T, manuscriptJSON string) string {
	t.Helper()
	project := t.TempDir()
	if manuscriptJSON == "" {
		return project
	}
	path := takeReviewManuscriptPath(project)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(manuscriptJSON), 0o600); err != nil {
		t.Fatal(err)
	}
	return project
}

// previewSuggestHost attaches a previewSuggestProject to a fresh host.
func previewSuggestHost(t *testing.T, manuscriptJSON string) *Host {
	t.Helper()
	host := NewHost()
	next := host.config
	next.projectFolder = previewSuggestProject(t, manuscriptJSON)
	if attached, reason := host.attachProjectLocked(next); !attached {
		t.Fatalf("attach failed: %s", reason)
	}
	return host
}

// previewManuscriptOK is a small two-chapter narration manuscript: one paragraph of Chapter One has paired quotes
// (the Q5 dialogue heuristic), so the "ok" fixture exercises both dialogue and no-dialogue reasons. Both chapters
// are far short of the 5:00 default target, so both candidates answer honestly as Shorter (Success Metrics: "a named
// state"), the same way a real, freshly-imported small manuscript would until the narrator writes more.
const previewManuscriptOK = `{"schemaVersion":1,"documentId":"doc-1","chapters":[` +
	`{"id":"c-0001","title":"Chapter One","index":0,"contentKind":"narration"},` +
	`{"id":"c-0002","title":"Chapter Two","index":1,"contentKind":"narration"}` +
	`],"paragraphs":[` +
	`{"id":"p-000001","chapterId":"c-0001","index":0,"text":"Alice walked through the forest, alone with her thoughts."},` +
	`{"id":"p-000002","chapterId":"c-0001","index":1,"text":"\"Wait for me!\" called Bob, running to catch up."},` +
	`{"id":"p-000003","chapterId":"c-0001","index":2,"text":"They went on together as the trail wound onward into the trees."},` +
	`{"id":"p-000004","chapterId":"c-0002","index":3,"text":"The old house stood quiet at the end of the lane."},` +
	`{"id":"p-000005","chapterId":"c-0002","index":4,"text":"Its windows were dark, and nobody had lived there in years."}` +
	`]}`

// previewManuscriptNothingEligible has one chapter, but it is reference content (Q4): no eligible chapter has a
// single narration paragraph, so Suggest must answer OutcomeNothingEligible rather than an empty OutcomeOK list
// (Success Metrics: an empty candidates list must never be conflated with "nothing eligible").
const previewManuscriptNothingEligible = `{"schemaVersion":1,"documentId":"doc-1","chapters":[` +
	`{"id":"c-0001","title":"Appendix","index":0,"contentKind":"reference"}` +
	`],"paragraphs":[` +
	`{"id":"p-000001","chapterId":"c-0001","index":0,"text":"A glossary of terms used throughout the book."}` +
	`]}`

func decodePreviewCandidates(t *testing.T) func(string, error) map[string]any {
	t.Helper()
	return func(payload string, err error) map[string]any {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		var decoded map[string]any
		if unmarshalErr := json.Unmarshal([]byte(payload), &decoded); unmarshalErr != nil {
			t.Fatal(unmarshalErr)
		}
		return decoded
	}
}

func TestPreviewCandidatesWithNoProjectAnswersNoManuscript(t *testing.T) {
	host := NewHost()
	result := decodePreviewCandidates(t)(host.PreviewCandidates())
	if result["outcome"] != "no_manuscript" {
		t.Fatalf("no project = %v", result)
	}
	candidates, _ := result["candidates"].([]any)
	if len(candidates) != 0 {
		t.Fatalf("no project must answer no candidates: %v", result)
	}
	contractfile.Check(t, "preview-candidates-no-manuscript", result)
}

func TestPreviewCandidatesWithAProjectButNoManuscriptImportedAnswersNoManuscript(t *testing.T) {
	host := previewSuggestHost(t, "")
	result := decodePreviewCandidates(t)(host.PreviewCandidates())
	if result["outcome"] != "no_manuscript" {
		t.Fatalf("project with no manuscript imported = %v", result)
	}
}

func TestPreviewCandidatesWithOnlyReferenceContentAnswersNothingEligible(t *testing.T) {
	host := previewSuggestHost(t, previewManuscriptNothingEligible)
	result := decodePreviewCandidates(t)(host.PreviewCandidates())
	if result["outcome"] != "nothing_eligible" {
		t.Fatalf("reference-only manuscript = %v", result)
	}
	candidates, _ := result["candidates"].([]any)
	if len(candidates) != 0 {
		t.Fatalf("nothing eligible must answer no candidates: %v", result)
	}
	contractfile.Check(t, "preview-candidates-nothing-eligible", result)
}

func TestPreviewCandidatesRanksOneCandidatePerEligibleChapter(t *testing.T) {
	host := previewSuggestHost(t, previewManuscriptOK)
	result := decodePreviewCandidates(t)(host.PreviewCandidates())
	if result["outcome"] != "ok" {
		t.Fatalf("outcome = %v", result)
	}
	candidates, _ := result["candidates"].([]any)
	if len(candidates) != 2 {
		t.Fatalf("expected one candidate per chapter, got %v", result)
	}
	first, _ := candidates[0].(map[string]any)
	if first["chapterId"] != "c-0001" {
		t.Fatalf("first candidate's chapter = %v", first)
	}
	if first["shorter"] != true {
		t.Fatalf("a manuscript this short must be honestly marked Shorter: %v", first)
	}
	reasons, _ := first["reasons"].([]any)
	if len(reasons) == 0 {
		t.Fatalf("a candidate with no reasons is unexplained: %v", first)
	}
	contractfile.Check(t, "preview-candidates-ok", result)
}

// previewManyParagraphManuscript is one chapter of paragraphCount paragraphs, each exactly 20 words (counted by
// strings.Fields, the engine's own word counter), so its total word count is a clean multiple of 20 - enough
// paragraphs for the window scan (internal/preview/engine.go's bestWindow) to have room to pick a sub-window
// short of the whole chapter once a small enough target asks for one.
func previewManyParagraphManuscript(paragraphCount int) string {
	const twentyWords = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty"
	type chapter struct {
		ID          string `json:"id"`
		Title       string `json:"title"`
		Index       int    `json:"index"`
		ContentKind string `json:"contentKind"`
	}
	type paragraph struct {
		ID        string `json:"id"`
		ChapterID string `json:"chapterId"`
		Index     int    `json:"index"`
		Text      string `json:"text"`
	}
	manuscript := struct {
		SchemaVersion int         `json:"schemaVersion"`
		DocumentID    string      `json:"documentId"`
		Chapters      []chapter   `json:"chapters"`
		Paragraphs    []paragraph `json:"paragraphs"`
	}{
		SchemaVersion: 1,
		DocumentID:    "doc-1",
		Chapters:      []chapter{{ID: "c-0001", Title: "Chapter One", Index: 0, ContentKind: "narration"}},
	}
	for i := 0; i < paragraphCount; i++ {
		manuscript.Paragraphs = append(manuscript.Paragraphs, paragraph{
			ID:        fmt.Sprintf("p-%06d", i+1),
			ChapterID: "c-0001",
			Index:     i,
			Text:      twentyWords,
		})
	}
	encoded, err := json.Marshal(manuscript)
	if err != nil {
		panic(err)
	}
	return string(encoded)
}

// Phase 4's own success signal: "changing the target changes candidates deterministically". This chapter's 600
// words (30 paragraphs of 20) fall short of the 5:00 default target's lower tolerance bound, so the default answer
// is the whole chapter, honestly marked Shorter (preview.Candidate.Shorter's own doc); a 60s target with 50%
// tolerance asks for far less, so the engine picks a short in-tolerance sub-window instead - a different, smaller
// WordCount and Shorter: false - and reading twice more at that same setting gives the identical result both times
// (byte-for-byte, Suggest's own determinism doc).
func TestPreviewCandidatesChangesDeterministicallyWithTheTargetSetting(t *testing.T) {
	host := previewSuggestHost(t, previewManyParagraphManuscript(30))

	before := decodePreviewCandidates(t)(host.PreviewCandidates())
	beforeCandidates, _ := before["candidates"].([]any)
	if len(beforeCandidates) != 1 {
		t.Fatalf("expected one candidate for the one eligible chapter before the setting change: %v", before)
	}
	beforeCandidate, _ := beforeCandidates[0].(map[string]any)
	if beforeCandidate["shorter"] != true || beforeCandidate["wordCount"] != float64(600) {
		t.Fatalf("at the 5:00 default target this 600-word chapter must answer the whole chapter, Shorter: %v", before)
	}

	// Project scope, not global: no APPDATA/USERPROFILE override here (unlike newTestHostForDeliverySettings), so a
	// "global" save would write to this machine's real settings.Store path and could bleed into another test.
	if err := host.saveSettings("Preview", "project", map[string]*string{"target_seconds": ptr("60"), "tolerance_fraction": ptr("0.5")}); err != nil {
		t.Fatal(err)
	}

	after := decodePreviewCandidates(t)(host.PreviewCandidates())
	afterCandidates, _ := after["candidates"].([]any)
	if len(afterCandidates) != 1 {
		t.Fatalf("changing the target must not change which chapters are eligible: before %v after %v", before, after)
	}
	afterCandidate, _ := afterCandidates[0].(map[string]any)
	if afterCandidate["shorter"] != false {
		t.Fatalf("a 60s target with 50%% tolerance must find an in-tolerance sub-window, not fall back to Shorter: %v", after)
	}
	if afterCandidate["wordCount"] == beforeCandidate["wordCount"] {
		t.Fatalf("the narrower target must pick a different-sized window: before %v after %v", beforeCandidate, afterCandidate)
	}

	repeat := decodePreviewCandidates(t)(host.PreviewCandidates())
	if fmt.Sprint(after) != fmt.Sprint(repeat) {
		t.Fatalf("PreviewCandidates must be deterministic for the same settings and manuscript: %v vs %v", after, repeat)
	}
}

// Phase 4's other success signal: "invalid values are rejected at the boundary" - a target outside numberSpecs'
// declared range never reaches the store (the same saveSettings boundary every other number field already enforces,
// delivery_settings_test.go's TestSavingANumberSettingValidatesItAndStoresIt).
func TestSavingAnOutOfRangePreviewTargetIsRejected(t *testing.T) {
	// Project scope (previewSuggestHost's own attached temp project), not global: a "global" save would write to
	// this machine's real settings.Store path (no APPDATA/USERPROFILE override here, unlike
	// newTestHostForDeliverySettings) and could bleed into another test.
	host := previewSuggestHost(t, previewManuscriptOK)
	if err := host.saveSettings("Preview", "project", map[string]*string{"target_seconds": ptr("30")}); err == nil || !strings.Contains(err.Error(), "target_seconds") {
		t.Fatalf("saveSettings(30) = %v, want a below-minimum target rejected", err)
	}
	if value, source := host.settings.Effective("Preview", "target_seconds", ""); value != "300" || source != "repo_default" {
		t.Fatalf("a rejected save must not change the effective value: got %q from %s, want the 300s repo default untouched", value, source)
	}
	if err := host.saveSettings("Preview", "project", map[string]*string{"tolerance_fraction": ptr("0.9")}); err == nil || !strings.Contains(err.Error(), "tolerance_fraction") {
		t.Fatalf("saveSettings(0.9) = %v, want an above-maximum tolerance rejected", err)
	}
	if err := host.saveSettings("Preview", "project", map[string]*string{"preset": ptr("epic")}); err == nil {
		t.Fatalf("saveSettings(epic) = %v, want an unsupported preset rejected", err)
	}
	if err := host.saveSettings("Preview", "project", map[string]*string{"target_seconds": ptr("600")}); err != nil {
		t.Fatalf("an in-range target must be accepted: %v", err)
	}
	if value, source := host.settings.Effective("Preview", "target_seconds", ""); value != "600" || source != "project" {
		t.Fatalf("Effective() = %q from %s, want 600 from project", value, source)
	}
}
