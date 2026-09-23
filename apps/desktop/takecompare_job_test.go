package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/manuscript"
	"github.com/countrymanprime/narration-utils/shell/internal/takecompare"
)

// fakeTakeCompareRunner answers --take-divergence with the sidecar's own pinned results, after writing a progress line.
type fakeTakeCompareRunner struct {
	raw      string
	err      error
	manifest map[string]any
	requests []takecompare.SidecarRequest
	release  chan struct{}
	started  chan struct{}
	// cancelFileSeen is whether the sidecar's cancel file was there when the comparison was cancelled.
	cancelFileSeen bool
}

func (f *fakeTakeCompareRunner) TakeDivergence(ctx context.Context, req takecompare.SidecarRequest) (string, error) {
	f.requests = append(f.requests, req)
	if raw, err := os.ReadFile(req.ManifestPath); err == nil {
		_ = json.Unmarshal(raw, &f.manifest)
	}
	_ = os.WriteFile(req.ProgressPath, []byte("TRANSCRIBE|33|Transcribing take 2/3\n"), 0o600)
	if f.started != nil {
		close(f.started)
	}
	if f.release != nil {
		select {
		case <-f.release:
		case <-ctx.Done():
			_, err := os.Stat(req.ProgressPath + ".cancel")
			f.cancelFileSeen = err == nil
			return "", ctx.Err()
		}
	}
	return f.raw, f.err
}

// pinnedDivergenceResults is the sidecar's own results file for three takes, pinned by its pytest suite.
func pinnedDivergenceResults(t *testing.T) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "tests", "fixtures", "contracts", "take-divergence-results.json"))
	if err != nil {
		t.Fatal(err)
	}
	var golden struct {
		Lines []string `json:"lines"`
	}
	if err := json.Unmarshal(raw, &golden); err != nil {
		t.Fatal(err)
	}
	return strings.Join(golden.Lines, "\n") + "\n"
}

// writeToneWAV writes 10 s of a mono 16-bit tone that sounds every other second, so every take category can be measured.
func writeToneWAV(t *testing.T, path string) {
	t.Helper()
	const rate, seconds = 16000, 10
	data := make([]byte, 44+rate*seconds*2)
	copy(data, "RIFF")
	binary.LittleEndian.PutUint32(data[4:], uint32(len(data)-8))
	copy(data[8:], "WAVEfmt ")
	for offset, value := range map[int]uint32{16: 16, 24: rate, 28: rate * 2} {
		binary.LittleEndian.PutUint32(data[offset:], value)
	}
	for offset, value := range map[int]uint16{20: 1, 22: 1, 32: 2, 34: 16} {
		binary.LittleEndian.PutUint16(data[offset:], value)
	}
	copy(data[36:], "data")
	binary.LittleEndian.PutUint32(data[40:], uint32(rate*seconds*2))
	for i := 0; i < rate*seconds; i++ {
		value := 0.0005 * math.Sin(float64(i)*1.3)
		if (i/rate)%2 == 0 {
			value += 0.25 * math.Sin(2*math.Pi*220*float64(i)/rate)
		}
		binary.LittleEndian.PutUint16(data[44+i*2:], uint16(int16(math.Round(value*32767))))
	}
	writeFile(t, path, string(data))
}

// compareItem is one item of the comparison fixture's REAPER project, with one take.
func compareItem(position float64, item, take, file string, soffs float64) string {
	return "    <ITEM\n" +
		"      POSITION " + formatSeconds(position) + "\n" +
		"      LENGTH 8\n" +
		"      SOFFS " + formatSeconds(soffs) + "\n" +
		"      IGUID " + item + "\n" +
		"      GUID " + take + "\n" +
		"      <SOURCE WAVE\n" +
		"        FILE \"" + file + "\"\n" +
		"      >\n" +
		"    >\n"
}

func formatSeconds(value float64) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}

const compareChapterTitle = "Chapter One"

// writeManuscriptJSON writes the project's canonical manuscript where manuscript import writes it.
func writeManuscriptJSON(t *testing.T, folder, text string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(takeReviewManuscriptPath(folder)), 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, takeReviewManuscriptPath(folder), text)
}

// compareReadyHost is a host over a saved project whose "Chapter One" track holds the three reads the pinned results
// name, a manuscript with that chapter, and one take-review group of the three reads in the store.
func compareReadyHost(t *testing.T, runner *fakeTakeCompareRunner) (*Host, string, func() []jobEnded) {
	t.Helper()
	folder := t.TempDir()
	rpp := "<REAPER_PROJECT 0.1 \"7.80/win64\" 1\n" +
		"  <TRACK {AAAAAAAA-0000-0000-0000-000000000001}\n" +
		"    NAME \"" + compareChapterTitle + "\"\n" +
		compareItem(0, "{ITEM-A}", "{TAKE-A}", "media/read-a.wav", 0) +
		compareItem(10, "{ITEM-B}", "{TAKE-B}", "media/read-b.wav", 1.5) +
		compareItem(20, "{ITEM-C}", "{TAKE-C}", "media/read-c.wav", 0) +
		"  >\n" +
		">\n"
	writeFile(t, filepath.Join(folder, "Book.rpp"), rpp)
	if err := os.MkdirAll(filepath.Join(folder, "media"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"read-a.wav", "read-b.wav", "read-c.wav"} {
		writeToneWAV(t, filepath.Join(folder, "media", name))
	}
	writeManuscriptJSON(t, folder, `{"schemaVersion":1,"documentId":"doc","chapters":[`+
		`{"id":"front","title":"Contents","contentKind":"front-matter"},{"id":"ch-1","title":"Chapter One","contentKind":"narration"}],`+
		`"paragraphs":[{"id":"p-1","chapterId":"ch-1","index":0,"text":"Alice was beginning to get very tired. She had nothing to do."}]}`)

	host := newTestHostForTakeReview(t, folder)
	host.manuscript = manuscript.New(folder)
	host.config.sessionDir = t.TempDir()
	host.takeCompareRunner = runner
	group := compareGroup(folder)
	if _, err := host.findings.SaveAnalyzerFindings("take-review", "Chapter-One", []findings.Finding{group}); err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	ended := []jobEnded{}
	host.jobEvents = func(event jobEnded) {
		mu.Lock()
		defer mu.Unlock()
		ended = append(ended, event)
	}
	return host, group.ID, func() []jobEnded {
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			mu.Lock()
			got := append([]jobEnded(nil), ended...)
			mu.Unlock()
			if len(got) > 0 {
				return got
			}
			time.Sleep(5 * time.Millisecond)
		}
		return nil
	}
}

// compareGroup is the take-review group of the fixture's three reads, as internal/repeats writes one.
func compareGroup(folder string) findings.Finding {
	member := func(item, take, name string, start float64) map[string]any {
		return map[string]any{"item_index": 0, "item_guid": item, "take_guid": take, "source_file": filepath.Join(folder, "media", name),
			"source_start": start, "source_length": 8.0, "coverage": 1.0, "quality": 0.9, "exact_copy_group": ""}
	}
	confidence := 0.9
	return findings.Finding{
		SchemaVersion: findings.SchemaVersion, ID: "0123456789abcdef01234567", Analyzer: "take-review", Category: findings.CategoryPickup,
		Severity: findings.SeverityInfo, Confidence: &confidence, ConfidenceReason: "average of 3 member(s)' alignment match quality",
		Manuscript: &findings.Manuscript{ChapterID: "Chapter-One", ChapterTitle: compareChapterTitle},
		Evidence: map[string]any{"kind": "restart", "matched_span_first": 0, "matched_span_last": 1, "members": []any{
			member("{ITEM-A}", "{TAKE-A}", "read-a.wav", 0), member("{ITEM-B}", "{TAKE-B}", "read-b.wav", 1.5), member("{ITEM-C}", "{TAKE-C}", "read-c.wav", 0),
		}},
		Review: findings.ReviewState{Status: findings.StatusUnreviewed},
	}
}

func waitForComparison(t *testing.T, host *Host) TakeComparisonJob {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		state := bindingAnswer[TakeComparisonJob](t)(host.TakeComparisonState())
		if state.Phase != "running" {
			return state
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("the comparison did not finish in time")
	return TakeComparisonJob{}
}

func TestTakeComparisonRunsAsAJobAndItsFindingIsListedForReview(t *testing.T) {
	runner := &fakeTakeCompareRunner{}
	host, groupID, ended := compareReadyHost(t, runner)
	runner.raw = pinnedDivergenceResults(t)
	if state := bindingAnswer[TakeComparisonJob](t)(host.TakeComparisonState()); state.Phase != "idle" || state.Kind != "take_comparison" {
		t.Fatalf("before a run: %+v", state)
	}

	started := bindingAnswer[TakeComparisonJob](t)(host.TakeComparisonStart(groupID))
	if started.Phase != "running" || started.FindingID != groupID {
		t.Fatalf("started = %+v", started)
	}
	done := waitForComparison(t, host)
	if done.Phase != "success" || done.ComparisonID == "" || done.Percent != 100 {
		t.Fatalf("done = %+v", done)
	}
	events := ended()
	if len(events) != 1 || events[0].Kind != "take_comparison" || events[0].Outcome != "success" {
		t.Fatalf("job:ended = %+v", events)
	}
	listed := bindingAnswer[findings.Page](t)(host.FindingsList(FindingsQuery{Analyzer: takecompare.AnalyzerName}))
	if len(listed.Findings) != 1 || listed.Findings[0].ID != done.ComparisonID || listed.Findings[0].Category != findings.CategoryTakeComparison {
		t.Fatalf("listed = %+v", listed)
	}
	// Everything the sidecar was handed came from the host: the saved project's own files and the manuscript's own id.
	folder := host.config.projectFolder
	request := runner.requests[0]
	if request.ManuscriptPath != takeReviewManuscriptPath(folder) || !strings.HasPrefix(request.ProgressPath, host.config.sessionDir) {
		t.Fatalf("request = %+v", request)
	}
	if runner.manifest["chapterId"] != "ch-1" || len(runner.manifest["takes"].([]any)) != 3 {
		t.Fatalf("manifest = %v", runner.manifest)
	}
	for _, take := range runner.manifest["takes"].([]any) {
		if file := take.(map[string]any)["sourceFile"].(string); !strings.HasPrefix(file, filepath.Join(folder, "media")) {
			t.Errorf("manifest names %q, not a file of the saved project", file)
		}
	}
	// Two takes of the one group, read by index, are still Go to / Loop targets (FindingsGoToRead reads evidence.members).
	reads, err := findingReads(listed.Findings[0])
	if err != nil || len(reads) != 3 || reads[1].ItemGUID != "{ITEM-B}" || reads[1].SourceStart != 1.5 {
		t.Fatalf("reads = %+v (%v)", reads, err)
	}
}

func TestTakeComparisonStartRefusesWhatItCannotCompare(t *testing.T) {
	host, groupID, _ := compareReadyHost(t, &fakeTakeCompareRunner{})
	if _, err := (&Host{}).TakeComparisonStart(groupID); err == nil || !strings.Contains(err.Error(), "no project is open") {
		t.Errorf("no project: %v", err)
	}
	if _, err := host.TakeComparisonStart("missing"); err == nil || !strings.Contains(err.Error(), "not in the review list") {
		t.Errorf("unknown finding: %v", err)
	}
	other := compareGroup(host.config.projectFolder)
	other.ID, other.Analyzer = "fedcba9876543210fedcba98", "transcript-compare"
	if _, err := host.findings.SaveAnalyzerFindings("transcript-compare", "ch-1", []findings.Finding{other}); err != nil {
		t.Fatal(err)
	}
	if _, err := host.TakeComparisonStart(other.ID); err == nil || !strings.Contains(err.Error(), "Find pickups and duplicates") {
		t.Errorf("not a group: %v", err)
	}
	renamed := compareGroup(host.config.projectFolder)
	renamed.ID, renamed.Manuscript = "aaaaaaaaaaaaaaaaaaaaaaaa", &findings.Manuscript{ChapterTitle: "Chapter Nine"}
	if _, err := host.findings.SaveAnalyzerFindings("take-review", "Chapter-Nine", []findings.Finding{renamed}); err != nil {
		t.Fatal(err)
	}
	if _, err := host.TakeComparisonStart(renamed.ID); err == nil || !strings.Contains(err.Error(), "Chapter Nine") {
		t.Errorf("no such chapter: %v", err)
	}
	if state := bindingAnswer[TakeComparisonJob](t)(host.TakeComparisonState()); state.Phase != "idle" {
		t.Fatalf("a refused start left the job %q", state.Phase)
	}
}

func TestTakeComparisonRunsOneAtATimeAndCancelSavesNothing(t *testing.T) {
	runner := &fakeTakeCompareRunner{release: make(chan struct{}), started: make(chan struct{})}
	host, groupID, ended := compareReadyHost(t, runner)
	if _, err := host.TakeComparisonStart(groupID); err != nil {
		t.Fatal(err)
	}
	<-runner.started
	if host.idle() {
		t.Error("a running comparison did not hold the project, as every other job does")
	}
	if _, err := host.TakeComparisonStart(groupID); err == nil || !strings.Contains(err.Error(), "already running") {
		t.Errorf("second start: %v", err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && bindingAnswer[TakeComparisonJob](t)(host.TakeComparisonState()).Percent != 33 {
		time.Sleep(10 * time.Millisecond)
	}
	if state := bindingAnswer[TakeComparisonJob](t)(host.TakeComparisonState()); state.Percent != 33 || state.Message != "Transcribing take 2/3" {
		t.Errorf("progress = %+v", state)
	}
	cancelling := bindingAnswer[TakeComparisonJob](t)(host.TakeComparisonCancel())
	if cancelling.Message != "Cancelling the comparison." {
		t.Errorf("cancelling = %+v", cancelling)
	}
	if done := waitForComparison(t, host); done.Phase != "cancelled" || done.ComparisonID != "" {
		t.Fatalf("done = %+v", done)
	}
	if !runner.cancelFileSeen {
		t.Error("the sidecar's cancel file was not written")
	}
	if events := ended(); len(events) != 1 || events[0].Outcome != "cancelled" {
		t.Fatalf("job:ended = %+v", events)
	}
	if listed := bindingAnswer[findings.Page](t)(host.FindingsList(FindingsQuery{Analyzer: takecompare.AnalyzerName})); len(listed.Findings) != 0 {
		t.Fatalf("a cancelled comparison saved %d findings", len(listed.Findings))
	}
	if state := bindingAnswer[TakeComparisonJob](t)(host.TakeComparisonCancel()); state.Phase != "cancelled" {
		t.Errorf("cancel with nothing running = %+v", state)
	}
}

func TestTakeComparisonReportsAFailedRun(t *testing.T) {
	runner := &fakeTakeCompareRunner{raw: "SUMMARY|nothing\n"}
	host, groupID, ended := compareReadyHost(t, runner)
	if _, err := host.TakeComparisonStart(groupID); err != nil {
		t.Fatal(err)
	}
	done := waitForComparison(t, host)
	if done.Phase != "error" || !strings.Contains(done.Error, "span lines") {
		t.Fatalf("done = %+v", done)
	}
	if events := ended(); len(events) != 1 || events[0].Outcome != "error" {
		t.Fatalf("job:ended = %+v", events)
	}
}

func TestComparisonChapterIDFindsTheChapterTheScanAlignedTo(t *testing.T) {
	folder := t.TempDir()
	write := func(chapters string) hostServices {
		writeManuscriptJSON(t, folder, `{"schemaVersion":1,"chapters":`+chapters+`,"paragraphs":[]}`)
		return hostServices{manuscript: manuscript.New(folder)}
	}
	if _, err := comparisonChapterID(hostServices{manuscript: manuscript.New(t.TempDir())}, "Chapter One"); err == nil {
		t.Error("no manuscript: no error")
	}
	svc := write(`[{"id":"a","title":"CHAPTER ONE\n Bad Ideas "},{"id":"b","title":"Chapter One","contentKind":"front-matter"}]`)
	if id, err := comparisonChapterID(svc, "CHAPTER ONE: Bad Ideas"); err != nil || id != "a" {
		t.Errorf("a two-line heading = %q, %v", id, err)
	}
	if _, err := comparisonChapterID(svc, "Chapter One"); err == nil {
		t.Error("a front-matter chapter was compared")
	}
	svc = write(`[{"id":"a","title":"One"},{"id":"b","title":"One","contentKind":"narration"}]`)
	if _, err := comparisonChapterID(svc, "One"); err == nil || !strings.Contains(err.Error(), "more than one") {
		t.Errorf("two chapters with one title: %v", err)
	}
}
