package main

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

// scanReadyHost is a take-review host over a project whose "Chapter 1" track has two items (the fewest a scan runs
// the sidecar for) and whose "Pickups" track has one more, with a session folder for the scan's progress file.
func scanReadyHost(t *testing.T, runner *fakeTakeReviewRunner) (*Host, func() []jobEnded) {
	t.Helper()
	folder := t.TempDir()
	rpp := strings.TrimSuffix(twoItemRppFixture("Chapter 1", "media/a.wav", "media/b.wav"), ">\n") +
		"  <TRACK {AAAAAAAA-0000-0000-0000-000000000002}\n" +
		"    NAME \"Pickups\"\n" +
		"    TRACKID {AAAAAAAA-0000-0000-0000-000000000002}\n" +
		"    <ITEM\n" +
		"      POSITION 90\n" +
		"      LENGTH 1\n" +
		"      IGUID {AAAAAAAA-0000-0000-0000-000000000020}\n" +
		"      <SOURCE WAVE\n" +
		"        FILE \"media/pickup.wav\"\n" +
		"      >\n" +
		"    >\n" +
		"  >\n" +
		">\n"
	writeFile(t, filepath.Join(folder, "Book.rpp"), rpp)
	if err := os.MkdirAll(filepath.Join(folder, "media"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"a.wav", "b.wav", "pickup.wav"} {
		writeFile(t, filepath.Join(folder, "media", name), "RIFF")
	}
	host := newTestHostForTakeReview(t, folder)
	host.config.sessionDir = t.TempDir()
	host.takeReviewRunner = runner
	var mu sync.Mutex
	ended := []jobEnded{}
	host.jobEvents = func(event jobEnded) {
		mu.Lock()
		defer mu.Unlock()
		ended = append(ended, event)
	}
	// The end is announced just after the job says it ended, so the events are read once one has arrived.
	return host, func() []jobEnded {
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

// oneGroup is the sidecar's answer for one repeated read of the two Chapter 1 items.
func oneGroup(folder string) string {
	return "SPAN_GROUP|0|0|5|2\n" +
		"SPAN_MEMBER|0|0|{AAAAAAAA-0000-0000-0000-000000000010}|{}|" + filepath.Join(folder, "media", "a.wav") + "|0.000|1.000|0|5|1.000|0.500|\n" +
		"SPAN_MEMBER|0|1|{AAAAAAAA-0000-0000-0000-000000000011}|{}|" + filepath.Join(folder, "media", "b.wav") + "|0.000|1.000|0|5|1.000|0.520|\n"
}

// waitForScan polls the job the way the scan dialog does until it leaves "running".
func waitForScan(t *testing.T, host *Host) TakeReviewScanJob {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		state := bindingAnswer[TakeReviewScanJob](t)(host.TakeReviewScanState())
		if state.Phase != "running" {
			return state
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("the scan did not finish in time")
	return TakeReviewScanJob{}
}

func chapterOne() TakeReviewScanScope { return TakeReviewScanScope{ChapterTrackName: "Chapter 1"} }

func TestTakeReviewScanStartRefusesAScopeItCannotScan(t *testing.T) {
	host, _ := scanReadyHost(t, &fakeTakeReviewRunner{})
	for name, tc := range map[string]struct {
		scope TakeReviewScanScope
		want  string
	}{
		"no track":             {TakeReviewScanScope{}, "choose a track"},
		"track and range both": {TakeReviewScanScope{ChapterTrackName: "Chapter 1", PickupTrackName: "Pickups", PickupRangeStart: seconds(1), PickupRangeEnd: seconds(2)}, "not both"},
		"backwards range":      {TakeReviewScanScope{ChapterTrackName: "Chapter 1", PickupRangeStart: seconds(9), PickupRangeEnd: seconds(2)}, "after its start"},
		"unknown track":        {TakeReviewScanScope{ChapterTrackName: "Chapter 9"}, "Chapter 9"},
	} {
		if _, err := host.TakeReviewScanStart(tc.scope); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: err = %v, want one containing %q", name, err, tc.want)
		}
	}
	if state := bindingAnswer[TakeReviewScanJob](t)(host.TakeReviewScanState()); state.Phase != "idle" {
		t.Fatalf("a refused start left the job %q, want idle", state.Phase)
	}
}

func TestTakeReviewScanStartRequiresAnOpenProject(t *testing.T) {
	host := &Host{}
	if _, err := host.TakeReviewScanStart(chapterOne()); err == nil || !strings.Contains(err.Error(), "no project is open") {
		t.Fatalf("err = %v, want the no-project message", err)
	}
}

func TestTakeReviewScanRunsAsAJobAndItsFindingsAreListedForReview(t *testing.T) {
	runner := &fakeTakeReviewRunner{}
	host, ended := scanReadyHost(t, runner)
	runner.raw = oneGroup(host.config.projectFolder)

	started := bindingAnswer[TakeReviewScanJob](t)(host.TakeReviewScanStart(chapterOne()))
	if started.Kind != jobKindTakeReview || started.ID == nil || started.Scope.ChapterTrackName != "Chapter 1" {
		t.Fatalf("started = %+v", started)
	}

	done := waitForScan(t, host)
	if done.Phase != "success" || done.Found != 1 || done.Percent != 100 || !strings.Contains(done.Message, "1 group") {
		t.Fatalf("done = %+v, want success with one group found", done)
	}
	page := bindingAnswer[findings.Page](t)(host.FindingsList(FindingsQuery{Analyzer: "take-review"}))
	if page.Total != 1 || page.Findings[0].Category != findings.CategoryPickup {
		t.Fatalf("listed %+v, want the scan's one pickup on the Review page", page)
	}
	if len(ended()) != 1 || ended()[0].Kind != jobKindTakeReview || ended()[0].Outcome != jobOutcomeSuccess {
		t.Fatalf("job ends %+v, want one take_review success", ended())
	}
}

func TestTakeReviewScanSaysSoWhenItFindsNothing(t *testing.T) {
	runner := &fakeTakeReviewRunner{raw: "SUMMARY|Found 0 repeated-span group(s) across 2 segment(s)\n"}
	host, _ := scanReadyHost(t, runner)

	_, _ = host.TakeReviewScanStart(chapterOne())
	done := waitForScan(t, host)

	if done.Phase != "success" || done.Found != 0 || !strings.Contains(done.Message, "No repeated reads") {
		t.Fatalf("done = %+v, want a success that found nothing", done)
	}
}

func TestTakeReviewScanScansThePickupAdditionTheNarratorChose(t *testing.T) {
	runner := &fakeTakeReviewRunner{raw: "SUMMARY|nothing\n"}
	host, _ := scanReadyHost(t, runner)

	_, _ = host.TakeReviewScanStart(TakeReviewScanScope{ChapterTrackName: "Chapter 1", PickupTrackName: "Pickups"})
	waitForScan(t, host)

	if len(runner.manifests) != 1 || !strings.Contains(runner.manifests[0], "pickup.wav") {
		t.Fatalf("manifests %q, want the pickup track's item scanned too", runner.manifests)
	}
}

func TestTakeReviewScanReportsTheSidecarsOwnProgress(t *testing.T) {
	runner := &fakeTakeReviewRunner{progress: "TRANSCRIBE|47|Transcribing read 2/3", release: make(chan struct{}), started: make(chan struct{})}
	host, _ := scanReadyHost(t, runner)

	_, _ = host.TakeReviewScanStart(chapterOne())
	<-runner.started
	deadline := time.Now().Add(5 * time.Second)
	var state TakeReviewScanJob
	for time.Now().Before(deadline) {
		state = bindingAnswer[TakeReviewScanJob](t)(host.TakeReviewScanState())
		if state.Percent == 47 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	close(runner.release)

	if state.Phase != "running" || state.Percent != 47 || state.Message != "Transcribing read 2/3" {
		t.Fatalf("state = %+v, want the sidecar's own stage while running", state)
	}
	if len(state.Logs) == 0 || state.Logs[len(state.Logs)-1] != "Transcribing read 2/3" {
		t.Fatalf("logs = %q, want the stage in the live activity", state.Logs)
	}
	if runner.requests[0].ProgressPath == "" || !strings.HasPrefix(runner.requests[0].ProgressPath, host.config.sessionDir) {
		t.Fatalf("progress path %q, want one in the session folder", runner.requests[0].ProgressPath)
	}
	waitForScan(t, host)
}

func TestTakeReviewScanCancelStopsTheRunAndSavesNothing(t *testing.T) {
	runner := &fakeTakeReviewRunner{release: make(chan struct{}), started: make(chan struct{})}
	host, ended := scanReadyHost(t, runner)
	runner.raw = oneGroup(host.config.projectFolder)

	_, _ = host.TakeReviewScanStart(chapterOne())
	<-runner.started
	if _, err := host.TakeReviewScanCancel(); err != nil {
		t.Fatal(err)
	}
	done := waitForScan(t, host)

	if done.Phase != "cancelled" {
		t.Fatalf("done = %+v, want cancelled", done)
	}
	if !runner.cancelFileSeen {
		t.Fatal("no cancel file beside the progress file for the sidecar to stop on")
	}
	if _, err := os.Stat(runner.requests[0].ProgressPath + ".cancel"); !os.IsNotExist(err) {
		t.Fatalf("the cancel file was left behind: %v", err)
	}
	page := bindingAnswer[findings.Page](t)(host.FindingsList(FindingsQuery{Analyzer: "take-review"}))
	if page.Total != 0 {
		t.Fatalf("listed %+v, want nothing saved from a cancelled scan", page)
	}
	if len(ended()) != 1 || ended()[0].Outcome != jobOutcomeCancelled {
		t.Fatalf("job ends %+v, want one cancelled", ended())
	}
}

func TestTakeReviewScanRefusesASecondScanWhileOneRuns(t *testing.T) {
	runner := &fakeTakeReviewRunner{release: make(chan struct{}), started: make(chan struct{}), raw: "SUMMARY|nothing\n"}
	host, _ := scanReadyHost(t, runner)

	_, _ = host.TakeReviewScanStart(chapterOne())
	<-runner.started
	_, err := host.TakeReviewScanStart(chapterOne())
	close(runner.release)
	waitForScan(t, host)

	if err == nil || !strings.Contains(err.Error(), "already running") {
		t.Fatalf("err = %v, want a scan-already-running refusal", err)
	}
}

func TestTakeReviewScanFailureIsTheSidecarsReason(t *testing.T) {
	runner := &fakeTakeReviewRunner{err: os.ErrPermission}
	host, ended := scanReadyHost(t, runner)

	_, _ = host.TakeReviewScanStart(chapterOne())
	done := waitForScan(t, host)

	if done.Phase != "error" || !strings.Contains(done.Error, "permission") {
		t.Fatalf("done = %+v, want the failure", done)
	}
	if len(ended()) != 1 || ended()[0].Outcome != jobOutcomeError {
		t.Fatalf("job ends %+v, want one error", ended())
	}
}

func TestTakeReviewScanCancelWithNothingRunningChangesNothing(t *testing.T) {
	host, _ := scanReadyHost(t, &fakeTakeReviewRunner{})
	state := bindingAnswer[TakeReviewScanJob](t)(host.TakeReviewScanCancel())
	if state.Phase != "idle" {
		t.Fatalf("state = %+v, want idle", state)
	}
}

func TestTakeReviewScanIdleStateOffersTheProjectsPickupSetting(t *testing.T) {
	host, _ := scanReadyHost(t, &fakeTakeReviewRunner{})
	pickups := "Pickups"
	if err := host.settings.Save("TakeReview", "project", map[string]*string{"pickup_track_name": &pickups}); err != nil {
		t.Fatal(err)
	}

	state := bindingAnswer[TakeReviewScanJob](t)(host.TakeReviewScanState())

	if state.Phase != "idle" || state.Scope.PickupTrackName != "Pickups" || state.Scope.ChapterTrackName != "" {
		t.Fatalf("state = %+v, want idle with the project's pickup track offered", state)
	}
}
