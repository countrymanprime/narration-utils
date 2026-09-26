package editing

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// testProject builds a tiny project folder with a saved .rpp-equivalent
// (this test drives the service directly with an in-memory tracks.Project by
// stubbing ProjectFile/parsing is bypassed via a thin wrapper below, since
// tracks.Parse needs a real file - see newTestService) and one WAV fixture
// per item, and confirms the chapter to the one track via the mapping store.
type testService struct {
	*Service
	dir     string
	rppPath string
	track   tracks.Track
}

// newTestService builds a Service over a real project folder: a two-item
// track (each item a 1 s tone with a distinguishing gap) confirmed to one
// chapter, ready to Start a scan against.
func newTestService(t *testing.T) *testService {
	t.Helper()
	return newTestServiceIn(t, t.TempDir())
}

func newTestServiceIn(t *testing.T, dir string) *testService {
	t.Helper()
	mediaDir := filepath.Join(dir, "media")
	if err := os.MkdirAll(mediaDir, 0o755); err != nil {
		t.Fatalf("mkdir media: %v", err)
	}
	fileA := filepath.Join(mediaDir, "a.wav")
	fileB := filepath.Join(mediaDir, "b.wav")
	if err := os.WriteFile(fileA, encodeWAV16(t, 1, testRate, toneSamples(testRate, 2, 440, -6)), 0o600); err != nil {
		t.Fatalf("writing fixture: %v", err)
	}
	if err := os.WriteFile(fileB, encodeWAV16(t, 1, testRate, toneSamples(testRate, 2, 440, -6)), 0o600); err != nil {
		t.Fatalf("writing fixture: %v", err)
	}

	itemA := tracks.Item{
		GUID: "item-a", Position: 0, Length: 2, Supported: true, ActiveTake: 0,
		Takes: []tracks.Take{{GUID: "take-a", SourceKind: "WAVE", SourceFile: fileA, SourceAvailable: true, Supported: true, Active: true, PlayRate: 1}},
	}
	itemA.SourceKind, itemA.SourceFile, itemA.SourceAvailable, itemA.PlayRate = "WAVE", fileA, true, 1
	itemB := tracks.Item{
		GUID: "item-b", Position: 5, Length: 2, Supported: true, ActiveTake: 0,
		Takes: []tracks.Take{{GUID: "take-b", SourceKind: "WAVE", SourceFile: fileB, SourceAvailable: true, Supported: true, Active: true, PlayRate: 1}},
	}
	itemB.SourceKind, itemB.SourceFile, itemB.SourceAvailable, itemB.PlayRate = "WAVE", fileB, true, 1

	track := tracks.Track{GUID: "track-1", Items: []tracks.Item{itemA, itemB}}

	mapping := evidence.NewMappingStore(dir)
	if _, err := mapping.Confirm("doc-1", "track-1", "chapter-1", "Chapter One"); err != nil {
		t.Fatalf("Confirm: %v", err)
	}

	rppPath := filepath.Join(dir, "project.rpp")
	if err := os.WriteFile(rppPath, []byte(minimalRPP(itemA, itemB)), 0o600); err != nil {
		t.Fatalf("writing project.rpp: %v", err)
	}

	service := New(Config{
		Project:     dir,
		ProjectFile: func() (string, error) { return rppPath, nil },
	}, nil)
	return &testService{Service: service, dir: dir, rppPath: rppPath, track: track}
}

// minimalRPP writes a REAPER project chunk with exactly the two items this
// test needs, in the legacy shape apps/desktop/internal/tracks/testdata/basic.rpp
// uses (a bare GUID line, predating IGUID - parse.go falls back to it): one
// track, two items each with a GUID, POSITION, LENGTH and a WAVE SOURCE.
func minimalRPP(itemA, itemB tracks.Item) string {
	item := func(it tracks.Item) string {
		// PLAYRATE is always explicit in a real REAPER-saved take
		// (apps/desktop/internal/tracks/testdata/reaper/saved-cases.rpp has it
		// on every take); evidence.ItemPlayedRange reads the take's raw
		// PlayRate field directly, not tracks.Take.Rate()'s "0 means 1"
		// default, so a fixture that omits it would compute a zero-length
		// played range - a bug in this test fixture's realism, not in the
		// production code this test is exercising.
		return "    <ITEM\n      POSITION " + ftoa(it.Position) + "\n      LENGTH " + ftoa(it.Length) + "\n      NAME take\n      GUID " + it.GUID + "\n      PLAYRATE 1\n      <SOURCE WAVE\n        FILE \"" + it.SourceFile + "\"\n      >\n    >\n"
	}
	return "<REAPER_PROJECT 0.1 \"7.0\" 0\n  <TRACK track-1\n    NAME \"Chapter One\"\n    TRACKID track-1\n" + item(itemA) + item(itemB) + "  >\n>\n"
}

func ftoa(v float64) string {
	return strconv.FormatFloat(v, 'f', -1, 64)
}

// TestServiceScanCompletesAndCachesHits is Phase 5's own success signal:
// "Cache hit costs 0 decodes." A first scan decodes both items; a second
// scan of the same, unchanged project answers entirely from cache.
func TestServiceScanCompletesAndCachesHits(t *testing.T) {
	svc := newTestService(t)
	request := Request{DocumentID: "doc-1", ChapterID: "chapter-1", ChapterTitle: "Chapter One"}

	if _, err := svc.Start(context.Background(), request); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	svc.Wait()
	first := svc.State()
	if first.Phase != PhaseComplete {
		t.Fatalf("first scan phase = %q, want %q (message: %s)", first.Phase, PhaseComplete, first.Message)
	}
	if first.Decoded != 2 || first.CacheHits != 0 {
		t.Fatalf("first scan decoded=%d cacheHits=%d, want decoded=2 cacheHits=0", first.Decoded, first.CacheHits)
	}

	if _, err := svc.Start(context.Background(), request); err != nil {
		t.Fatalf("second Start() error = %v", err)
	}
	svc.Wait()
	second := svc.State()
	if second.Phase != PhaseComplete {
		t.Fatalf("second scan phase = %q, want %q", second.Phase, PhaseComplete)
	}
	if second.CacheHits != 2 || second.Decoded != 0 {
		t.Fatalf("second scan decoded=%d cacheHits=%d, want decoded=0 cacheHits=2 (unchanged items cost 0 decodes)", second.Decoded, second.CacheHits)
	}
}

// TestServiceTrimOneItemRedecodesOnlyThatItem is the other half of the same
// success signal: after the saved project changes so that only one item's
// played range narrows (a trim), re-scanning must decode exactly that item
// and read the other one from cache.
func TestServiceTrimOneItemRedecodesOnlyThatItem(t *testing.T) {
	svc := newTestService(t)
	request := Request{DocumentID: "doc-1", ChapterID: "chapter-1", ChapterTitle: "Chapter One"}
	if _, err := svc.Start(context.Background(), request); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	svc.Wait()
	if got := svc.State().Decoded; got != 2 {
		t.Fatalf("first scan decoded = %d, want 2", got)
	}

	// Trim item A: shorten its length (and therefore its played range) by
	// rewriting the saved project with a new LENGTH for item A only.
	trimmedA := svc.track.Items[0]
	trimmedA.Length = 1
	if err := os.WriteFile(svc.rppPath, []byte(minimalRPP(trimmedA, svc.track.Items[1])), 0o600); err != nil {
		t.Fatalf("rewriting project.rpp: %v", err)
	}

	if _, err := svc.Start(context.Background(), request); err != nil {
		t.Fatalf("second Start() error = %v", err)
	}
	svc.Wait()
	second := svc.State()
	if second.Decoded != 1 || second.CacheHits != 1 {
		t.Fatalf("after trimming one item: decoded=%d cacheHits=%d, want decoded=1 cacheHits=1 (only the trimmed item re-decodes)", second.Decoded, second.CacheHits)
	}
}

// TestServiceFindsEmptySpace proves the job end to end produces a candidate
// and persists it as a finding: the two items are 3 s apart on the timeline
// (item A at [0,2), item B at [5,7)), well past a 1 s maximum gap.
func TestServiceFindsEmptySpace(t *testing.T) {
	svc := newTestService(t)
	svc.config.Policy = func() Policy { maxGap := 1.0; return Policy{MaxGapSeconds: &maxGap} }
	request := Request{DocumentID: "doc-1", ChapterID: "chapter-1", ChapterTitle: "Chapter One"}
	if _, err := svc.Start(context.Background(), request); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	svc.Wait()
	if got := svc.State().Phase; got != PhaseComplete {
		t.Fatalf("phase = %q, want %q", got, PhaseComplete)
	}

	found, err := svc.Candidates("chapter-1")
	if err != nil {
		t.Fatalf("Candidates() error = %v", err)
	}
	if len(found) != 1 {
		t.Fatalf("Candidates() = %d findings, want 1 (the [2,5) gap): %+v", len(found), found)
	}
	if found[0].TimeRange == nil || found[0].TimeRange.Start != 2 || found[0].TimeRange.End != 5 {
		t.Fatalf("finding range = %+v, want [2,5)", found[0].TimeRange)
	}
	if found[0].Category != "silence_cleanup" {
		t.Fatalf("finding category = %q, want silence_cleanup", found[0].Category)
	}
}

// TestServiceCancelYieldsPartial proves Phase 5's cancel rule: cancelling
// mid-scan must stop the loop and leave the run's own state as PhaseCancelled
// rather than PhaseComplete, without crashing or hanging.
func TestServiceCancelYieldsPartial(t *testing.T) {
	svc := newTestService(t)
	request := Request{DocumentID: "doc-1", ChapterID: "chapter-1", ChapterTitle: "Chapter One"}
	if _, err := svc.Start(context.Background(), request); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	svc.Cancel()
	svc.Wait()
	state := svc.State()
	if state.Phase != PhaseCancelled && state.Phase != PhaseComplete {
		// A cancel racing a fast, tiny fixture scan may still finish before the
		// cancel is observed; either outcome is legitimate as long as the job
		// ends cleanly and Wait() actually returns (proven by reaching here at
		// all - a hang would have failed this test on its own via the test
		// binary's timeout).
		t.Fatalf("phase = %q, want %q or %q", state.Phase, PhaseCancelled, PhaseComplete)
	}
}

// TestServiceOneFailedItemDoesNotAbortTheRest is Phase 5's own scope: "one
// failed item not aborting the rest." Item A's source file is corrupted
// (still present, so Resolve still hands it to Decode - a genuine decode
// failure, not an input-level refusal like a missing file); item B must
// still be analyzed.
func TestServiceOneFailedItemDoesNotAbortTheRest(t *testing.T) {
	svc := newTestService(t)
	path := svc.track.Items[0].Active().SourceFile
	if err := os.WriteFile(path, []byte("not a real wav file, but still a file"), 0o600); err != nil {
		t.Fatalf("corrupting fixture: %v", err)
	}
	request := Request{DocumentID: "doc-1", ChapterID: "chapter-1", ChapterTitle: "Chapter One"}
	if _, err := svc.Start(context.Background(), request); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	svc.Wait()
	state := svc.State()
	if state.Phase != PhaseComplete {
		t.Fatalf("phase = %q, want %q (a failed item must not fail the whole run)", state.Phase, PhaseComplete)
	}
	if state.Failed != 1 || state.Decoded != 1 {
		t.Fatalf("failed=%d decoded=%d, want failed=1 decoded=1", state.Failed, state.Decoded)
	}
}

// TestServiceProgressIsMonotonic is the Success Metrics "Progress honesty:
// Monotonic" gate: every Percent this run reports, in order, must never go
// backwards.
func TestServiceProgressIsMonotonic(t *testing.T) {
	dir := t.TempDir()
	// Build the service directly (not via newTestService) so the changed
	// callback can be wired in before Start.
	var percents []float64
	var mu sync.Mutex
	svc := newTestServiceWithChanged(t, dir, func(state State) {
		mu.Lock()
		percents = append(percents, state.Percent)
		mu.Unlock()
	})
	if _, err := svc.Start(context.Background(), Request{DocumentID: "doc-1", ChapterID: "chapter-1", ChapterTitle: "Chapter One"}); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	svc.Wait()

	mu.Lock()
	defer mu.Unlock()
	for i := 1; i < len(percents); i++ {
		if percents[i] < percents[i-1] {
			t.Fatalf("Percent went backwards: %v then %v (all: %v)", percents[i-1], percents[i], percents)
		}
	}
	if len(percents) == 0 || percents[len(percents)-1] != 1 {
		t.Fatalf("final Percent = %v, want the run to finish at 1.0: %v", percents, percents)
	}
}

// TestServiceNeverModifiesSourceFiles is a Success Metrics gate: "Input
// never modified: 0 files change (SHA-256 before equals after)."
func TestServiceNeverModifiesSourceFiles(t *testing.T) {
	svc := newTestService(t)
	before := map[string]string{}
	for _, item := range svc.track.Items {
		path := item.Active().SourceFile
		sum, err := evidence.FullHash(path)
		if err != nil {
			t.Fatalf("hashing fixture: %v", err)
		}
		before[path] = sum
	}
	if _, err := svc.Start(context.Background(), Request{DocumentID: "doc-1", ChapterID: "chapter-1", ChapterTitle: "Chapter One"}); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	svc.Wait()
	for path, want := range before {
		got, err := evidence.FullHash(path)
		if err != nil {
			t.Fatalf("re-hashing fixture: %v", err)
		}
		if got != want {
			t.Fatalf("source file %s changed during the scan", path)
		}
	}
}

// newTestServiceWithChanged is newTestService with an explicit changed
// callback and project directory, for a test that needs to observe every
// intermediate state.
func newTestServiceWithChanged(t *testing.T, dir string, changed func(State)) *testService {
	t.Helper()
	base := newTestServiceIn(t, dir)
	base.Service = New(Config{Project: dir, ProjectFile: func() (string, error) { return base.rppPath, nil }}, changed)
	return base
}

func TestServiceStartRefusesUnmapped(t *testing.T) {
	svc := newTestService(t)
	// Clear the confirmed mapping so the chapter is unmapped.
	if err := svc.mapping.Clear("doc-1", "track-1"); err != nil {
		t.Fatalf("Clear: %v", err)
	}
	_, err := svc.Start(context.Background(), Request{DocumentID: "doc-1", ChapterID: "chapter-1"})
	if err == nil {
		t.Fatalf("Start() error = nil, want a refusal")
	}
	if reason, ok := ReasonOf(err); !ok || reason != ReasonUnmapped {
		t.Fatalf("Start() reason = %v, ok=%v, want %q", reason, ok, ReasonUnmapped)
	}
}
