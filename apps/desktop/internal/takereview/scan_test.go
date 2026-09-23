package takereview

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/repeats"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// fakeRunner is a SidecarRunner that returns canned output instead of
// shelling out to Python, so these tests run fast and need no sidecar
// installed.
type fakeRunner struct {
	output string
	err    error
	// calls records every request the scanner made, so tests can assert on
	// the manifest and arguments actually sent to the sidecar.
	calls []SidecarRequest
	// manifests records the manifest file's contents at call time (the
	// scanner deletes the file on return, so this must be read while it
	// still exists).
	manifests []string
}

func (f *fakeRunner) FindRepeats(_ context.Context, req SidecarRequest) (string, error) {
	f.calls = append(f.calls, req)
	data, err := os.ReadFile(req.ManifestPath)
	if err != nil {
		return "", err
	}
	f.manifests = append(f.manifests, string(data))
	return f.output, f.err
}

func chapterTrackFixture() tracks.Project {
	return tracks.Project{
		Path: "P",
		Tracks: []tracks.Track{
			{
				Name: "Chapter 1",
				Items: []tracks.Item{
					{
						GUID: "{ITEM-1}", Position: 0, Length: 4.5,
						Takes: []tracks.Take{
							{GUID: "{TAKE-1}", SourceFile: "a.wav", SOFFS: 0, PlayRate: 1},
							{GUID: "{TAKE-2}", SourceFile: "b.wav", SOFFS: 10, PlayRate: 1},
						},
					},
					{
						GUID: "{ITEM-2}", Position: 5, Length: 2,
						Takes: []tracks.Take{
							{GUID: "{TAKE-3}", SourceFile: "c.wav", SOFFS: 0, PlayRate: 1},
						},
					},
				},
			},
			{
				Name: "Pickups",
				Items: []tracks.Item{
					{
						GUID: "{ITEM-3}", Position: 100, Length: 1.5,
						Takes: []tracks.Take{
							{GUID: "{TAKE-4}", SourceFile: "pickup.wav", SOFFS: 0, PlayRate: 1},
						},
					},
				},
			},
		},
	}
}

func TestBuildManifestIncludesEveryTakeOfEveryChapterTrackItem(t *testing.T) {
	project := chapterTrackFixture()

	segments, err := buildManifest(project, Scope{ChapterTrackName: "Chapter 1"})
	if err != nil {
		t.Fatalf("buildManifest: %v", err)
	}

	if len(segments) != 3 {
		t.Fatalf("want 3 segments (2 takes + 1 take), got %d: %+v", len(segments), segments)
	}
	var guids []string
	for _, s := range segments {
		guids = append(guids, s.TakeGUID)
	}
	sort.Strings(guids)
	want := []string{"{TAKE-1}", "{TAKE-2}", "{TAKE-3}"}
	for i := range want {
		if guids[i] != want[i] {
			t.Fatalf("want take guids %v, got %v", want, guids)
		}
	}
}

func TestBuildManifestErrorsWhenTheChapterTrackIsMissing(t *testing.T) {
	project := chapterTrackFixture()

	_, err := buildManifest(project, Scope{ChapterTrackName: "Does Not Exist"})
	if err == nil {
		t.Fatal("want an error for a missing chapter track")
	}
}

func TestBuildManifestAddsAPickupTrackWhenDesignated(t *testing.T) {
	project := chapterTrackFixture()

	segments, err := buildManifest(project, Scope{ChapterTrackName: "Chapter 1", PickupTrackName: "Pickups"})
	if err != nil {
		t.Fatalf("buildManifest: %v", err)
	}

	if len(segments) != 4 {
		t.Fatalf("want 4 segments (3 chapter takes + 1 pickup take), got %d", len(segments))
	}
	found := false
	for _, s := range segments {
		if s.TakeGUID == "{TAKE-4}" {
			found = true
		}
	}
	if !found {
		t.Fatal("want the pickup track's take included")
	}
}

func TestBuildManifestErrorsWhenTheDesignatedPickupTrackIsMissing(t *testing.T) {
	project := chapterTrackFixture()

	_, err := buildManifest(project, Scope{ChapterTrackName: "Chapter 1", PickupTrackName: "Does Not Exist"})
	if err == nil {
		t.Fatal("want an error for a missing pickup track")
	}
}

func TestBuildManifestAddsItemsWithinAPickupRangeAcrossAnyTrack(t *testing.T) {
	project := chapterTrackFixture()
	start, end := 99.0, 102.0

	segments, err := buildManifest(project, Scope{ChapterTrackName: "Chapter 1", PickupRangeStart: &start, PickupRangeEnd: &end})
	if err != nil {
		t.Fatalf("buildManifest: %v", err)
	}

	if len(segments) != 4 {
		t.Fatalf("want 4 segments (3 chapter takes + 1 in-range pickup take), got %d", len(segments))
	}
}

func TestBuildManifestPickupRangeExcludesItemsOutsideIt(t *testing.T) {
	project := chapterTrackFixture()
	start, end := 200.0, 210.0 // the pickup item sits at position 100-101.5, well outside this window

	segments, err := buildManifest(project, Scope{ChapterTrackName: "Chapter 1", PickupRangeStart: &start, PickupRangeEnd: &end})
	if err != nil {
		t.Fatalf("buildManifest: %v", err)
	}

	if len(segments) != 3 {
		t.Fatalf("want 3 segments (chapter track only, nothing in range), got %d", len(segments))
	}
}

func TestBuildManifestNeverDuplicatesAnItemAlreadyOnTheChapterTrack(t *testing.T) {
	project := tracks.Project{
		Tracks: []tracks.Track{
			{
				Name: "Chapter 1",
				Items: []tracks.Item{
					{GUID: "{ITEM-1}", Position: 0, Length: 2, Takes: []tracks.Take{{GUID: "{T1}", SourceFile: "a.wav", PlayRate: 1}}},
				},
			},
		},
	}
	start, end := 0.0, 5.0 // overlaps the chapter track's own item

	segments, err := buildManifest(project, Scope{ChapterTrackName: "Chapter 1", PickupRangeStart: &start, PickupRangeEnd: &end})
	if err != nil {
		t.Fatalf("buildManifest: %v", err)
	}
	if len(segments) != 1 {
		t.Fatalf("want the chapter-track item counted once, got %d segments", len(segments))
	}
}

func TestBuildManifestSegmentUsesSourceOffsetAndLengthTimesPlayRate(t *testing.T) {
	project := tracks.Project{
		Tracks: []tracks.Track{
			{
				Name: "Chapter 1",
				Items: []tracks.Item{
					{GUID: "{ITEM-1}", Position: 0, Length: 4, Takes: []tracks.Take{{GUID: "{T1}", SourceFile: "a.wav", SOFFS: 2.5, PlayRate: 2}}},
				},
			},
		},
	}

	segments, err := buildManifest(project, Scope{ChapterTrackName: "Chapter 1"})
	if err != nil {
		t.Fatalf("buildManifest: %v", err)
	}
	if segments[0].StartOffset != 2.5 {
		t.Fatalf("want start offset 2.5 (take SOFFS), got %v", segments[0].StartOffset)
	}
	if segments[0].Length != 8 {
		t.Fatalf("want length 8 (item length 4 * playrate 2), got %v", segments[0].Length)
	}
}

func TestFormatManifestMatchesTheSidecarsPipeDelimitedShape(t *testing.T) {
	segments := []Segment{
		{ItemIndex: 0, SourceFile: "a.wav", StartOffset: 1.5, Length: 3.25, ItemGUID: "{A}", TakeGUID: "{T1}"},
	}

	got := formatManifest(segments)
	want := "0|a.wav|1.500000|3.250000|{A}|{T1}\n"
	if got != want {
		t.Fatalf("want %q, got %q", want, got)
	}
}

func TestScanSavesFreshFindingsIntoTheStoreUnderTheChapterScope(t *testing.T) {
	store := findings.NewStore(t.TempDir())
	runner := &fakeRunner{output: strings.Join([]string{
		"SUMMARY|Found 1 repeated-span group(s) across 2 segment(s)",
		"SPAN_GROUP|0|3|7|2",
		"SPAN_MEMBER|0|0|{ITEM-1}|{TAKE-1}|a.wav|0.000|4.500|3|7|1.000|0.500|",
		"SPAN_MEMBER|0|1|{ITEM-1}|{TAKE-2}|b.wav|10.000|4.500|3|7|1.000|0.500|",
		"",
	}, "\n")}
	scanner := &Scanner{Runner: runner, Store: store}

	result, err := scanner.Scan(context.Background(), Request{
		Project:        chapterTrackFixture(),
		ProjectPath:    "P",
		ManuscriptPath: "manuscript.json",
		ChapterID:      "c1",
		ChapterTitle:   "Chapter One",
		Scope:          Scope{ChapterTrackName: "Chapter 1"},
		Thresholds:     repeats.DefaultThresholds(),
	})
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if len(result) != 1 {
		t.Fatalf("want 1 finding, got %d", len(result))
	}
	if result[0].Analyzer != repeats.AnalyzerName {
		t.Fatalf("want analyzer %q, got %q", repeats.AnalyzerName, result[0].Analyzer)
	}

	// Saved for real: List() with the same store sees it back.
	stored, err := store.List(findings.Query{Analyzer: repeats.AnalyzerName, ChapterID: "c1"})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(stored) != 1 {
		t.Fatalf("want 1 stored finding, got %d", len(stored))
	}
}

func TestScanPassesTheChapterTrackNameAndManuscriptToTheSidecar(t *testing.T) {
	store := findings.NewStore(t.TempDir())
	runner := &fakeRunner{output: "SUMMARY|Found 0 repeated-span group(s) across 0 segment(s)\n"}
	scanner := &Scanner{Runner: runner, Store: store}

	_, err := scanner.Scan(context.Background(), Request{
		Project:        chapterTrackFixture(),
		ProjectPath:    "P",
		ManuscriptPath: "manuscript.json",
		ChapterID:      "c1",
		Scope:          Scope{ChapterTrackName: "Chapter 1"},
		Thresholds:     repeats.DefaultThresholds(),
	})
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if len(runner.calls) != 1 {
		t.Fatalf("want 1 sidecar call, got %d", len(runner.calls))
	}
	call := runner.calls[0]
	if call.TrackName != "Chapter 1" {
		t.Fatalf("want track name %q, got %q", "Chapter 1", call.TrackName)
	}
	if call.ManuscriptPath != "manuscript.json" {
		t.Fatalf("want manuscript path %q, got %q", "manuscript.json", call.ManuscriptPath)
	}
}

func TestScanSkipsTheSidecarWhenFewerThanTwoSegmentsAreInScope(t *testing.T) {
	store := findings.NewStore(t.TempDir())
	runner := &fakeRunner{output: "should not be read"}
	scanner := &Scanner{Runner: runner, Store: store}

	project := tracks.Project{Tracks: []tracks.Track{{Name: "Chapter 1", Items: []tracks.Item{
		{GUID: "{ITEM-1}", Length: 1, Takes: []tracks.Take{{GUID: "{T1}", SourceFile: "a.wav", PlayRate: 1}}},
	}}}}

	result, err := scanner.Scan(context.Background(), Request{
		Project: project, ProjectPath: "P", ManuscriptPath: "m.json", ChapterID: "c1",
		Scope: Scope{ChapterTrackName: "Chapter 1"}, Thresholds: repeats.DefaultThresholds(),
	})
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if len(result) != 0 {
		t.Fatalf("want 0 findings when nothing can repeat, got %d", len(result))
	}
	if len(runner.calls) != 0 {
		t.Fatal("want the sidecar never called for an unrepeatable scope")
	}
}

func TestScanAnEmptyRescanAgesOutAPriorFindingRatherThanErroring(t *testing.T) {
	store := findings.NewStore(t.TempDir())
	first := &fakeRunner{output: strings.Join([]string{
		"SPAN_GROUP|0|3|7|2",
		"SPAN_MEMBER|0|0|{ITEM-1}|{TAKE-1}|a.wav|0.000|4.500|3|7|1.000|0.500|",
		"SPAN_MEMBER|0|1|{ITEM-1}|{TAKE-2}|b.wav|10.000|4.500|3|7|1.000|0.500|",
		"",
	}, "\n")}
	scanner := &Scanner{Runner: first, Store: store}
	req := Request{
		Project: chapterTrackFixture(), ProjectPath: "P", ManuscriptPath: "m.json", ChapterID: "c1",
		Scope: Scope{ChapterTrackName: "Chapter 1"}, Thresholds: repeats.DefaultThresholds(),
	}
	if _, err := scanner.Scan(context.Background(), req); err != nil {
		t.Fatalf("first scan: %v", err)
	}

	// Rescan the same scope, now with only one segment in scope: nothing
	// can repeat, so the sidecar is skipped and the prior finding is
	// carried forward as not_in_latest_run rather than kept "fresh".
	onlyOneItem := tracks.Project{Tracks: []tracks.Track{{Name: "Chapter 1", Items: []tracks.Item{
		{GUID: "{ITEM-1}", Length: 1, Takes: []tracks.Take{{GUID: "{T1}", SourceFile: "a.wav", PlayRate: 1}}},
	}}}}
	req.Project = onlyOneItem
	result, err := scanner.Scan(context.Background(), req)
	if err != nil {
		t.Fatalf("second scan: %v", err)
	}
	if len(result) != 1 || !result[0].NotInLatestRun {
		t.Fatalf("want the prior finding carried forward as not_in_latest_run, got %+v", result)
	}
}

func TestScanReturnsAnErrorWhenTheSidecarFails(t *testing.T) {
	store := findings.NewStore(t.TempDir())
	runner := &fakeRunner{err: fmt.Errorf("boom")}
	scanner := &Scanner{Runner: runner, Store: store}

	_, err := scanner.Scan(context.Background(), Request{
		Project: chapterTrackFixture(), ProjectPath: "P", ManuscriptPath: "m.json", ChapterID: "c1",
		Scope: Scope{ChapterTrackName: "Chapter 1"}, Thresholds: repeats.DefaultThresholds(),
	})
	if err == nil {
		t.Fatal("want an error when the sidecar fails")
	}
}

func TestScanManifestFileContainsEveryChapterTrackSegment(t *testing.T) {
	store := findings.NewStore(t.TempDir())
	runner := &fakeRunner{output: "SUMMARY|Found 0 repeated-span group(s) across 0 segment(s)\n"}
	scanner := &Scanner{Runner: runner, Store: store}

	_, err := scanner.Scan(context.Background(), Request{
		Project: chapterTrackFixture(), ProjectPath: "P", ManuscriptPath: "m.json", ChapterID: "c1",
		Scope: Scope{ChapterTrackName: "Chapter 1"}, Thresholds: repeats.DefaultThresholds(),
	})
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if len(runner.manifests) != 1 {
		t.Fatalf("want 1 manifest written, got %d", len(runner.manifests))
	}
	manifest := runner.manifests[0]
	for _, want := range []string{"a.wav", "b.wav", "c.wav"} {
		if !strings.Contains(manifest, want) {
			t.Fatalf("want manifest to mention %q, got:\n%s", want, manifest)
		}
	}
}

func TestScanCleansUpItsManifestFileAfterTheSidecarRuns(t *testing.T) {
	store := findings.NewStore(t.TempDir())
	var seenPath string
	runner := &recordingPathRunner{fakeRunner: &fakeRunner{output: "SUMMARY|Found 0 repeated-span group(s) across 0 segment(s)\n"}, path: &seenPath}
	scanner := &Scanner{Runner: runner, Store: store}

	_, err := scanner.Scan(context.Background(), Request{
		Project: chapterTrackFixture(), ProjectPath: "P", ManuscriptPath: "m.json", ChapterID: "c1",
		Scope: Scope{ChapterTrackName: "Chapter 1"}, Thresholds: repeats.DefaultThresholds(),
	})
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if seenPath == "" {
		t.Fatal("want the runner to have seen a manifest path")
	}
	if _, statErr := os.Stat(seenPath); statErr == nil {
		t.Fatalf("want the manifest file removed after the scan, %s still exists", seenPath)
	}
}

// recordingPathRunner wraps fakeRunner to capture the manifest path before
// Scanner's deferred cleanup removes the file, matching this test's own
// intent of asserting on cleanup rather than content.
type recordingPathRunner struct {
	*fakeRunner
	path *string
}

func (r *recordingPathRunner) FindRepeats(ctx context.Context, req SidecarRequest) (string, error) {
	*r.path = req.ManifestPath
	return r.fakeRunner.FindRepeats(ctx, req)
}

func TestScanErrorsWithNoStoreConfigured(t *testing.T) {
	scanner := &Scanner{Runner: &fakeRunner{}}

	_, err := scanner.Scan(context.Background(), Request{
		Project: chapterTrackFixture(), ChapterID: "c1", Scope: Scope{ChapterTrackName: "Chapter 1"},
	})
	if err == nil {
		t.Fatal("want an error with no store configured")
	}
}

func TestScanErrorsWithNoRunnerConfiguredAndSegmentsInScope(t *testing.T) {
	store := findings.NewStore(t.TempDir())
	scanner := &Scanner{Store: store}

	_, err := scanner.Scan(context.Background(), Request{
		Project: chapterTrackFixture(), ChapterID: "c1", Scope: Scope{ChapterTrackName: "Chapter 1"},
	})
	if err == nil {
		t.Fatal("want an error with no runner configured")
	}
}

func TestScanErrorsWhenTheChapterTrackIsMissing(t *testing.T) {
	store := findings.NewStore(t.TempDir())
	scanner := &Scanner{Runner: &fakeRunner{}, Store: store}

	_, err := scanner.Scan(context.Background(), Request{
		Project: chapterTrackFixture(), ChapterID: "c1", Scope: Scope{ChapterTrackName: "Missing"},
	})
	if err == nil {
		t.Fatal("want an error for a missing chapter track")
	}
}

func TestManifestPathIsUnderATempDirectory(t *testing.T) {
	segments := []Segment{{ItemIndex: 0, SourceFile: "a.wav", ItemGUID: "{A}", TakeGUID: "{T1}"}}
	path, cleanup, err := writeManifest(segments)
	if err != nil {
		t.Fatalf("writeManifest: %v", err)
	}
	defer cleanup()
	if !strings.Contains(filepath.Base(path), "take-review-manifest") {
		t.Fatalf("want a recognisable manifest filename, got %q", path)
	}
}
