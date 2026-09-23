package takereview

import (
	"context"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/repeats"
)

func TestScanPassesTheProgressPathToTheSidecar(t *testing.T) {
	store := findings.NewStore(t.TempDir())
	runner := &fakeRunner{output: "SUMMARY|Found 0 repeated-span group(s) across 0 segment(s)\n"}
	scanner := &Scanner{Runner: runner, Store: store}

	_, err := scanner.Scan(context.Background(), Request{
		Project:      chapterTrackFixture(),
		ChapterID:    "c1",
		Scope:        Scope{ChapterTrackName: "Chapter 1"},
		Thresholds:   repeats.DefaultThresholds(),
		ProgressPath: "session/take_review_progress.txt",
	})
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if len(runner.calls) != 1 || runner.calls[0].ProgressPath != "session/take_review_progress.txt" {
		t.Fatalf("sidecar calls = %+v, want one carrying the progress path", runner.calls)
	}
}

func TestValidateScopeAcceptsAChapterTrackAloneOrWithOnePickupAddition(t *testing.T) {
	start, end := 10.0, 20.0
	for name, scope := range map[string]Scope{
		"chapter only": {ChapterTrackName: "Chapter 1"},
		"pickup track": {ChapterTrackName: "Chapter 1", PickupTrackName: "Pickups"},
		"pickup range": {ChapterTrackName: "Chapter 1", PickupRangeStart: &start, PickupRangeEnd: &end},
	} {
		if err := ValidateScope(scope); err != nil {
			t.Errorf("%s: ValidateScope = %v, want nil", name, err)
		}
	}
}

func TestValidateScopeRefusesWhatBuildManifestCannotScan(t *testing.T) {
	start, end, negative := 10.0, 20.0, -1.0
	for name, tc := range map[string]struct {
		scope Scope
		want  string
	}{
		"no chapter track":      {Scope{}, "choose a track"},
		"pickup is the chapter": {Scope{ChapterTrackName: "Chapter 1", PickupTrackName: "Chapter 1"}, "different track"},
		"track and range": {
			Scope{ChapterTrackName: "Chapter 1", PickupTrackName: "Pickups", PickupRangeStart: &start, PickupRangeEnd: &end}, "not both",
		},
		"range without an end": {Scope{ChapterTrackName: "Chapter 1", PickupRangeStart: &start}, "a start and an end"},
		"range backwards":      {Scope{ChapterTrackName: "Chapter 1", PickupRangeStart: &end, PickupRangeEnd: &start}, "after its start"},
		"range before zero":    {Scope{ChapterTrackName: "Chapter 1", PickupRangeStart: &negative, PickupRangeEnd: &end}, "zero or later"},
	} {
		err := ValidateScope(tc.scope)
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: ValidateScope = %v, want an error containing %q", name, err, tc.want)
		}
	}
}

func TestFindRepeatsArgsCarryTheProgressFileWhenGiven(t *testing.T) {
	args := findRepeatsArgs(SidecarRequest{ManifestPath: "m.txt", ManuscriptPath: "ms.json", TrackName: "Chapter 1", ProgressPath: "p.txt"}, "out.txt")
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "--progress p.txt") || !strings.Contains(joined, "--find-repeats --out out.txt") {
		t.Fatalf("args = %q, want --find-repeats, --out and --progress", joined)
	}
	without := strings.Join(findRepeatsArgs(SidecarRequest{ManifestPath: "m.txt", ManuscriptPath: "ms.json"}, "out.txt"), " ")
	if strings.Contains(without, "--progress") {
		t.Fatalf("args = %q, want no --progress when none was given", without)
	}
}
