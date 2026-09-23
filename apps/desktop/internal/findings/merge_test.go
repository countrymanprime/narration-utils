package findings

import "testing"

// MergeAnalyzerFindings is the additive sibling of SaveAnalyzerFindings for an analyzer whose runs each cover only part of a
// scope (a live read-aloud session reads some of a chapter): a finding the latest run did not reproduce is kept as it was,
// never marked NotInLatestRun, and a repeat of an id is one finding, not two.
func TestMergeAnalyzerFindingsKeepsWhatThisRunDidNotCover(t *testing.T) {
	store := NewStore(t.TempDir())
	if _, err := store.MergeAnalyzerFindings("teleprompter", "ch1", []Finding{testFinding("a", "ch1", "v1")}); err != nil {
		t.Fatal(err)
	}
	merged, err := store.MergeAnalyzerFindings("teleprompter", "ch1", []Finding{testFinding("b", "ch1", "v1")})
	if err != nil {
		t.Fatal(err)
	}
	if len(merged) != 2 {
		t.Fatalf("merged = %d findings, want 2", len(merged))
	}
	for _, f := range merged {
		if f.NotInLatestRun {
			t.Errorf("%s is marked not_in_latest_run; a partial run says nothing about what it did not cover", f.ID)
		}
	}
}

func TestMergeAnalyzerFindingsDeduplicatesRepeatsAndRuns(t *testing.T) {
	store := NewStore(t.TempDir())
	first := []Finding{testFinding("a", "ch1", "v1"), testFinding("a", "ch1", "v1")}
	for range 3 {
		merged, err := store.MergeAnalyzerFindings("teleprompter", "ch1", first)
		if err != nil {
			t.Fatal(err)
		}
		if len(merged) != 1 {
			t.Fatalf("merged = %d findings, want 1 (the same id is one finding)", len(merged))
		}
	}
	all, err := store.List(Query{})
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 1 {
		t.Fatalf("store holds %d findings after three identical runs, want 1", len(all))
	}
}

func TestMergeAnalyzerFindingsKeepsADecisionOnlyWhileTheEvidenceIsUnchanged(t *testing.T) {
	store := NewStore(t.TempDir())
	if _, err := store.MergeAnalyzerFindings("teleprompter", "ch1", []Finding{testFinding("a", "ch1", "v1")}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.RecordDecision("a", "v1", StatusDismissed, "engine noise", "2026-09-23T10:00:00Z"); err != nil {
		t.Fatal(err)
	}

	same, err := store.MergeAnalyzerFindings("teleprompter", "ch1", []Finding{testFinding("a", "ch1", "v1")})
	if err != nil {
		t.Fatal(err)
	}
	if same[0].Review.Status != StatusDismissed {
		t.Fatalf("status after an identical run = %q, want dismissed", same[0].Review.Status)
	}

	changed, err := store.MergeAnalyzerFindings("teleprompter", "ch1", []Finding{testFinding("a", "ch1", "v2")})
	if err != nil {
		t.Fatal(err)
	}
	if changed[0].Review.Status != StatusUnreviewed || changed[0].Review.Note != "engine noise" {
		t.Fatalf("review after changed evidence = %+v, want unreviewed keeping the note", changed[0].Review)
	}
}

func TestMergeAnalyzerFindingsBringsBackAFindingAnEarlierFullRunMarkedAbsent(t *testing.T) {
	store := NewStore(t.TempDir())
	if _, err := store.SaveAnalyzerFindings("teleprompter", "ch1", []Finding{testFinding("a", "ch1", "v1")}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveAnalyzerFindings("teleprompter", "ch1", nil); err != nil {
		t.Fatal(err)
	}
	merged, err := store.MergeAnalyzerFindings("teleprompter", "ch1", []Finding{testFinding("a", "ch1", "v1")})
	if err != nil {
		t.Fatal(err)
	}
	if merged[0].NotInLatestRun {
		t.Fatal("a finding this run reproduced is still marked not_in_latest_run")
	}
}

func TestMergeAnalyzerFindingsRejectsAnUnsafeScope(t *testing.T) {
	store := NewStore(t.TempDir())
	if _, err := store.MergeAnalyzerFindings("teleprompter", "../escape", nil); err == nil {
		t.Fatal("an escaping scope name was accepted")
	}
}
