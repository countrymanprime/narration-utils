package main

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
)

func decodePin(t *testing.T) func(string, error) map[string]any {
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

func TestPreviewPinWithNothingPinnedAnswersNotPresent(t *testing.T) {
	host := previewSuggestHost(t, previewManuscriptOK)
	result := decodePin(t)(host.PreviewPin())
	if result["present"] != false {
		t.Fatalf("present = %v, want false", result["present"])
	}
	contractfile.Check(t, "preview-pin-none", result)
}

func TestPreviewPinWithNoProjectAnswersNotPresent(t *testing.T) {
	host := NewHost()
	result := decodePin(t)(host.PreviewPin())
	if result["present"] != false {
		t.Fatalf("present = %v, want false", result["present"])
	}
}

func TestPreviewPinSetThenReadRoundTrips(t *testing.T) {
	host := previewSuggestHost(t, previewManuscriptOK)
	set := decodePin(t)(host.PreviewPinSet("c-0001", []string{"p-000001", "p-000002"}))
	if set["present"] != true {
		t.Fatalf("present after set = %v", set["present"])
	}
	if set["stale"] != false {
		t.Fatalf("stale right after set = %v", set["stale"])
	}
	candidate, _ := set["candidate"].(map[string]any)
	if candidate == nil || candidate["chapterId"] != "c-0001" {
		t.Fatalf("candidate = %v", set["candidate"])
	}
	paragraphIDs, _ := candidate["paragraphIds"].([]any)
	if len(paragraphIDs) != 2 {
		t.Fatalf("paragraphIds = %v", paragraphIDs)
	}

	read := decodePin(t)(host.PreviewPin())
	if read["present"] != true || read["stale"] != false {
		t.Fatalf("read back = %v", read)
	}
	contractfile.Check(t, "preview-pin-set", maskPinnedAt(read))
}

// maskPinnedAt replaces a live pinnedAt timestamp with a fixed value so a golden fixture stays stable across runs
// (contractfile.Check's comparison would otherwise never match a wall-clock value written at Write time).
func maskPinnedAt(view map[string]any) map[string]any {
	if _, ok := view["pinnedAt"]; ok {
		view["pinnedAt"] = "2020-01-01T00:00:00Z"
	}
	return view
}

func TestPreviewPinSetRejectsAParagraphOutsideTheChapter(t *testing.T) {
	host := previewSuggestHost(t, previewManuscriptOK)
	if _, err := host.PreviewPinSet("c-0001", []string{"p-000004"}); err == nil {
		t.Fatal("expected an error pinning a paragraph from a different chapter")
	}
}

func TestPreviewPinSetReplacesAnyEarlierPin(t *testing.T) {
	host := previewSuggestHost(t, previewManuscriptOK)
	if _, err := host.PreviewPinSet("c-0001", []string{"p-000001"}); err != nil {
		t.Fatal(err)
	}
	if _, err := host.PreviewPinSet("c-0002", []string{"p-000004"}); err != nil {
		t.Fatal(err)
	}
	read := decodePin(t)(host.PreviewPin())
	candidate, _ := read["candidate"].(map[string]any)
	if candidate["chapterId"] != "c-0002" {
		t.Fatalf("expected only the second pin (a pin per book, Q9): %v", read)
	}
}

func TestPreviewPinAdjustExtendsAndShrinksTheRange(t *testing.T) {
	host := previewSuggestHost(t, previewManuscriptOK)
	if _, err := host.PreviewPinSet("c-0001", []string{"p-000002"}); err != nil {
		t.Fatal(err)
	}
	before := decodePin(t)(host.PreviewPin())
	if before["canExtendStart"] != true || before["canExtendEnd"] != true {
		t.Fatalf("expected both edges extendable from the middle paragraph: %v", before)
	}

	extended := decodePin(t)(host.PreviewPinAdjust("end", true))
	candidate, _ := extended["candidate"].(map[string]any)
	paragraphIDs, _ := candidate["paragraphIds"].([]any)
	if len(paragraphIDs) != 2 || paragraphIDs[len(paragraphIDs)-1] != "p-000003" {
		t.Fatalf("PreviewPinAdjust(end, grow) = %v", paragraphIDs)
	}

	shrunk := decodePin(t)(host.PreviewPinAdjust("end", false))
	candidate, _ = shrunk["candidate"].(map[string]any)
	paragraphIDs, _ = candidate["paragraphIds"].([]any)
	if len(paragraphIDs) != 1 || paragraphIDs[0] != "p-000002" {
		t.Fatalf("PreviewPinAdjust(end, shrink) = %v", paragraphIDs)
	}
}

func TestPreviewPinAdjustWithNothingPinnedIsAnError(t *testing.T) {
	host := previewSuggestHost(t, previewManuscriptOK)
	if _, err := host.PreviewPinAdjust("end", true); err == nil {
		t.Fatal("expected an error adjusting with nothing pinned")
	}
}

func TestPreviewPinClearRemovesIt(t *testing.T) {
	host := previewSuggestHost(t, previewManuscriptOK)
	if _, err := host.PreviewPinSet("c-0001", []string{"p-000001"}); err != nil {
		t.Fatal(err)
	}
	if _, err := host.PreviewPinClear(); err != nil {
		t.Fatal(err)
	}
	read := decodePin(t)(host.PreviewPin())
	if read["present"] != false {
		t.Fatalf("present after clear = %v", read["present"])
	}
}

func TestPreviewPinClearWithNothingPinnedIsNotAnError(t *testing.T) {
	host := previewSuggestHost(t, previewManuscriptOK)
	if _, err := host.PreviewPinClear(); err != nil {
		t.Fatalf("Clear with nothing pinned: %v", err)
	}
}

// TestPreviewPinReportsTextChangedStaleness pins a paragraph, edits the manuscript's text under it (the take-review
// manuscript path directly, the same fixture-writing shortcut previewSuggestHost itself uses), then reads the pin
// again from a fresh host attached to the same project: the pin survives with its stored range intact, but is
// reported stale, and its recomputed candidate reflects the new text (Q9: "If the manuscript text under a pin
// changes, the pin shows as stale").
func TestPreviewPinReportsTextChangedStaleness(t *testing.T) {
	host := previewSuggestHost(t, previewManuscriptOK)
	if _, err := host.PreviewPinSet("c-0001", []string{"p-000001"}); err != nil {
		t.Fatal(err)
	}
	project := host.config.projectFolder

	edited := `{"schemaVersion":1,"documentId":"doc-1","chapters":[` +
		`{"id":"c-0001","title":"Chapter One","index":0,"contentKind":"narration"},` +
		`{"id":"c-0002","title":"Chapter Two","index":1,"contentKind":"narration"}` +
		`],"paragraphs":[` +
		`{"id":"p-000001","chapterId":"c-0001","index":0,"text":"Alice walked through the meadow, alone with her thoughts."},` +
		`{"id":"p-000002","chapterId":"c-0001","index":1,"text":"\"Wait for me!\" called Bob, running to catch up."},` +
		`{"id":"p-000003","chapterId":"c-0001","index":2,"text":"They went on together as the trail wound onward into the trees."},` +
		`{"id":"p-000004","chapterId":"c-0002","index":3,"text":"The old house stood quiet at the end of the lane."},` +
		`{"id":"p-000005","chapterId":"c-0002","index":4,"text":"Its windows were dark, and nobody had lived there in years."}` +
		`]}`
	if err := os.WriteFile(takeReviewManuscriptPath(project), []byte(edited), 0o600); err != nil {
		t.Fatal(err)
	}

	next := NewHost()
	nextConfig := next.config
	nextConfig.projectFolder = project
	if attached, reason := next.attachProjectLocked(nextConfig); !attached {
		t.Fatalf("attach failed: %s", reason)
	}
	read := decodePin(t)(next.PreviewPin())
	if read["present"] != true {
		t.Fatalf("present after editing the underlying text = %v", read["present"])
	}
	if read["stale"] != true || read["staleReason"] != "text_changed" {
		t.Fatalf("stale/staleReason = %v/%v, want true/text_changed", read["stale"], read["staleReason"])
	}
	candidate, _ := read["candidate"].(map[string]any)
	if candidate == nil {
		t.Fatal("expected a recomputed candidate even while stale (the paragraph still exists, just reworded)")
	}
	contractfile.Check(t, "preview-pin-stale-text-changed", maskPinnedAt(read))
}

// TestPreviewPinReportsParagraphMissingStaleness covers a re-import that drops the pinned paragraph entirely: no
// candidate can be recomputed, but the pin stays present so the panel can offer to clear it.
func TestPreviewPinReportsParagraphMissingStaleness(t *testing.T) {
	host := previewSuggestHost(t, previewManuscriptOK)
	if _, err := host.PreviewPinSet("c-0001", []string{"p-000001"}); err != nil {
		t.Fatal(err)
	}
	project := host.config.projectFolder

	reimported := `{"schemaVersion":1,"documentId":"doc-2","chapters":[` +
		`{"id":"c-0001","title":"Chapter One","index":0,"contentKind":"narration"}` +
		`],"paragraphs":[` +
		`{"id":"p-999001","chapterId":"c-0001","index":0,"text":"A completely different opening line."}` +
		`]}`
	if err := os.WriteFile(takeReviewManuscriptPath(project), []byte(reimported), 0o600); err != nil {
		t.Fatal(err)
	}

	next := NewHost()
	nextConfig := next.config
	nextConfig.projectFolder = project
	if attached, reason := next.attachProjectLocked(nextConfig); !attached {
		t.Fatalf("attach failed: %s", reason)
	}
	read := decodePin(t)(next.PreviewPin())
	if read["present"] != true {
		t.Fatalf("present after the paragraph disappears = %v", read["present"])
	}
	if read["stale"] != true || read["staleReason"] != "paragraph_missing" {
		t.Fatalf("stale/staleReason = %v/%v, want true/paragraph_missing", read["stale"], read["staleReason"])
	}
	if read["candidate"] != nil {
		t.Fatalf("expected no candidate once the paragraph is gone: %v", read["candidate"])
	}
	contractfile.Check(t, "preview-pin-stale-paragraph-missing", maskPinnedAt(read))
}
