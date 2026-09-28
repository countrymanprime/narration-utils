package editing

import (
	"context"
	"math"
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

// newClickService is newTestService with item-a's source replaced by speech,
// a pause holding one click at 0.90-0.92 s, then speech again (2 s in all).
func newClickService(t *testing.T) *testService {
	t.Helper()
	svc := newTestService(t)
	samples := concatSamples(
		toneSamples(testRate, 0.8, 220, -14), silenceSamples(testRate, 0.1),
		noiseSamples(testRate, 0.02, -3, 7), silenceSamples(testRate, 0.1),
		toneSamples(testRate, 0.98, 220, -14),
	)
	if err := os.WriteFile(filepath.Join(svc.dir, "media", "a.wav"), encodeWAV16(t, 1, testRate, samples), 0o600); err != nil {
		t.Fatalf("rewriting a.wav: %v", err)
	}
	return svc
}

func scanChapterOne(t *testing.T, svc *testService) {
	t.Helper()
	if _, err := svc.Start(context.Background(), Request{DocumentID: "doc-1", ChapterID: "chapter-1", ChapterTitle: "Chapter One"}); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	svc.Wait()
	if got := svc.State().Phase; got != PhaseComplete {
		t.Fatalf("scan phase = %q, want %q (%s)", got, PhaseComplete, svc.State().Message)
	}
}

// TestScanWritesAClassRecordPerItemUnderEachClassVersion: each decoded item
// gets an editing.click and an editing.breath record stamped with that
// class's own detector version and its own count, so one class can go stale
// alone when its detector changes.
func TestScanWritesAClassRecordPerItemUnderEachClassVersion(t *testing.T) {
	svc := newClickService(t)
	scanChapterOne(t, svc)

	for _, class := range []struct {
		analyzer, version, count string
		want                     map[string]int
	}{
		{AnalyzerClick, ClickAnalyzerVersion, "clicks", map[string]int{"item-a": 1, "item-b": 0}},
		{AnalyzerBreath, BreathAnalyzerVersion, "breaths", map[string]int{"item-a": 0, "item-b": 0}},
		{AnalyzerSilence, AnalyzerVersion, "silences", nil},
	} {
		records, err := svc.ledger.List(class.analyzer, "chapter-1")
		if err != nil {
			t.Fatalf("ledger.List(%s): %v", class.analyzer, err)
		}
		if len(records) != 2 {
			t.Fatalf("%s: %d records, want one per item (2)", class.analyzer, len(records))
		}
		for _, record := range records {
			if record.AnalyzerVersion != class.version {
				t.Errorf("%s record version = %q, want %q", class.analyzer, record.AnalyzerVersion, class.version)
			}
			if _, ok := record.Counts[class.count]; !ok || len(record.Counts) != 1 {
				t.Errorf("%s record counts = %v, want only %q", class.analyzer, record.Counts, class.count)
			}
			if class.want != nil && record.Counts[class.count] != class.want[record.Scope.ItemGUIDs[0]] {
				t.Errorf("%s count for %s = %d, want %d", class.analyzer, record.Scope.ItemGUIDs[0], record.Counts[class.count], class.want[record.Scope.ItemGUIDs[0]])
			}
		}
	}
}

// TestScanPersistsClickFindingsAtTheirProjectTime: a click candidate becomes
// a silence_cleanup finding with class click, its project time (item
// position plus offset in the played range), its source range, and an id and
// evidence version that a cache-hit re-scan reproduces exactly (Q7).
func TestScanPersistsClickFindingsAtTheirProjectTime(t *testing.T) {
	svc := newClickService(t)
	scanChapterOne(t, svc)

	clicks := func() []findings.Finding {
		all, err := svc.Candidates("chapter-1")
		if err != nil {
			t.Fatalf("Candidates(): %v", err)
		}
		var out []findings.Finding
		for _, f := range all {
			if f.Evidence["class"] == "click" && !f.NotInLatestRun {
				out = append(out, f)
			}
		}
		return out
	}
	first := clicks()
	if len(first) != 1 {
		t.Fatalf("%d click findings, want 1", len(first))
	}
	click := first[0]
	if click.Category != findings.CategorySilenceCleanup || click.Source.ItemGUID != "item-a" || click.Source.TakeGUID == "" {
		t.Fatalf("finding = %+v, want a silence_cleanup finding on item-a with its take", click)
	}
	if click.TimeRange == nil || math.Abs(click.TimeRange.Start-0.9) > 0.011 || click.TimeRange.SourceStart == nil || math.Abs(*click.TimeRange.SourceStart-0.9) > 0.011 {
		t.Fatalf("time range = %+v, want project and source start near 0.90 s", click.TimeRange)
	}
	if click.SuggestedAction == nil || !click.SuggestedAction.RequiresConfirmation {
		t.Fatalf("suggested action = %+v, want one that needs confirmation", click.SuggestedAction)
	}
	if click.EvidenceVersion == "" || click.Evidence["analyzer_version"] != ClickAnalyzerVersion {
		t.Fatalf("evidence version %q, analyzer_version %v; want both set", click.EvidenceVersion, click.Evidence["analyzer_version"])
	}

	scanChapterOne(t, svc)
	if svc.State().CacheHits != 2 {
		t.Fatalf("second scan cache hits = %d, want 2", svc.State().CacheHits)
	}
	second := clicks()
	if len(second) != 1 || second[0].ID != click.ID || second[0].EvidenceVersion != click.EvidenceVersion {
		t.Fatalf("re-scan click findings = %+v, want the same id and evidence version", second)
	}
}
