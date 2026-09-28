package preview

import "testing"

// TestEvaluateRangeScoresAnArbitraryWindow covers a pin the narrator adjusted to a window Suggest itself never
// ranked (Phase 8: the narrator's own choice is never re-subjected to Suggest's top-three cap).
func TestEvaluateRangeScoresAnArbitraryWindow(t *testing.T) {
	chapter := Chapter{ID: "c1", Title: "Chapter One", ContentKind: ContentNarration, Order: 0}
	paragraphs := chapterOf("c1", 10)
	ids := []string{chapterParaID("c1", 2), chapterParaID("c1", 3), chapterParaID("c1", 4)}
	candidate, ok := EvaluateRange(chapter, paragraphs, ids, nil, nil, DefaultSettings(), ChapterAudioEvidence{})
	if !ok {
		t.Fatal("EvaluateRange reported not ok")
	}
	if candidate.ChapterID != "c1" {
		t.Fatalf("ChapterID = %q, want c1", candidate.ChapterID)
	}
	if !equalStrings(candidate.ParagraphIDs, ids) {
		t.Fatalf("ParagraphIDs = %v, want %v", candidate.ParagraphIDs, ids)
	}
	if candidate.WordCount != 30 {
		t.Fatalf("WordCount = %d, want 30", candidate.WordCount)
	}
	if len(candidate.Reasons) == 0 {
		t.Fatal("expected at least one reason, the same evidence Suggest's own candidates carry")
	}
}

func TestEvaluateRangeCarriesFindingsAndAudioEvidence(t *testing.T) {
	chapter := Chapter{ID: "c1", Title: "Chapter One", ContentKind: ContentNarration, Order: 0}
	paragraphs := chapterOf("c1", 10)
	ids := []string{chapterParaID("c1", 0), chapterParaID("c1", 1)}
	findings := []OpenFinding{{ID: "f1", ChapterID: "c1", ParagraphID: chapterParaID("c1", 0), Category: FindingPickup, Severity: FindingWarning}}
	audio := ChapterAudioEvidence{Coverage: AudioSignal{State: AudioMet}, ParagraphTimes: map[string]ParagraphMapping{
		chapterParaID("c1", 0): {Mapped: true}, chapterParaID("c1", 1): {Mapped: true},
	}}
	candidate, ok := EvaluateRange(chapter, paragraphs, ids, nil, findings, DefaultSettings(), audio)
	if !ok {
		t.Fatal("EvaluateRange reported not ok")
	}
	foundFindingWarning := false
	for _, w := range candidate.Warnings {
		if w != "" && containsSubstring(w, "pickup") {
			foundFindingWarning = true
		}
	}
	if !foundFindingWarning {
		t.Fatalf("expected a pickup finding warning, got %v", candidate.Warnings)
	}
}

func TestEvaluateRangeNotOkForAnEmptyOrUnknownRange(t *testing.T) {
	chapter := Chapter{ID: "c1", Title: "Chapter One", ContentKind: ContentNarration, Order: 0}
	paragraphs := chapterOf("c1", 5)
	if _, ok := EvaluateRange(chapter, paragraphs, nil, nil, nil, DefaultSettings(), ChapterAudioEvidence{}); ok {
		t.Fatal("EvaluateRange reported ok for an empty range")
	}
	if _, ok := EvaluateRange(chapter, paragraphs, []string{"does-not-exist"}, nil, nil, DefaultSettings(), ChapterAudioEvidence{}); ok {
		t.Fatal("EvaluateRange reported ok for an unknown paragraph id")
	}
}

func containsSubstring(s, substr string) bool {
	for i := 0; i+len(substr) <= len(s); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
