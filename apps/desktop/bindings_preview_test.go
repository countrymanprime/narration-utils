package main

import (
	"encoding/json"
	"os"
	"path/filepath"
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
