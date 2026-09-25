package transcript

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/dawadapter"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

// fakeReview is a DAW that is not REAPER: it records what the review workflow asked of it and delivers the events a test queues,
// so these tests prove the service drives the review loop through dawadapter.Review alone (audacity-integration PRD, Phase 3).
type fakeReview struct {
	calls         []string
	colors        dawadapter.MarkerColors
	subscriptions []dawadapter.Subscription
	queued        []dawadapter.Event
	failWith      error
	projectFolder string
}

var _ dawadapter.Review = (*fakeReview)(nil)

func (f *fakeReview) Subscribe(sub dawadapter.Subscription) func() {
	f.subscriptions = append(f.subscriptions, sub)
	return func() {}
}

func (f *fakeReview) Dispatch() error {
	f.calls = append(f.calls, "dispatch")
	queued := f.queued
	f.queued = nil
	for _, event := range queued {
		for _, sub := range f.subscriptions {
			if (sub.Owns == nil || event.RunID == "" || sub.Owns(event.RunID)) && sub.Handle != nil {
				sub.Handle(event)
			}
		}
	}
	return nil
}

func (f *fakeReview) PrepareReview(runID, projectFolder string) error {
	f.calls = append(f.calls, "prepare")
	f.projectFolder = projectFolder
	return f.failWith
}

func (f *fakeReview) InspectFindings(runID, findingsPath string) error {
	f.calls = append(f.calls, "inspect "+runID+" "+filepath.Base(findingsPath))
	return f.failWith
}

func (f *fakeReview) NavigateToFinding(runID, findingID string) error {
	f.calls = append(f.calls, "navigate "+runID+" "+findingID)
	return f.failWith
}

func (f *fakeReview) ExportFindings(runID, findingsPath string, colors dawadapter.MarkerColors) error {
	f.calls = append(f.calls, "export "+runID+" "+filepath.Base(findingsPath))
	f.colors = colors
	return f.failWith
}

func (f *fakeReview) queue(fields ...string) {
	event := dawadapter.Event{Tag: fields[0], Fields: fields}
	if len(fields) > 1 {
		event.RunID = fields[1]
	}
	f.queued = append(f.queued, event)
}

func adapterService(t *testing.T) (*Service, *fakeReview) {
	t.Helper()
	project := t.TempDir()
	if err := os.MkdirAll(filepath.Join(project, "narration-utils", "manuscript"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(project, "narration-utils", "manuscript", "manuscript.json"), []byte(`{"version":1}`), 0o600); err != nil {
		t.Fatal(err)
	}
	fake := &fakeReview{}
	return NewWithReview(Config{Project: project}, fake, settings.New(t.TempDir(), project), nil, nil), fake
}

func TestTheServiceSubscribesToTheReviewEventsThroughTheAdapter(t *testing.T) {
	_, fake := adapterService(t)
	if len(fake.subscriptions) != 1 || !reflect.DeepEqual(fake.subscriptions[0].Tags, []string{"COMPARE_*", "ERROR"}) {
		t.Fatalf("subscriptions = %#v", fake.subscriptions)
	}
	if fake.subscriptions[0].Invalid == nil {
		t.Fatal("the review workflow must still be told about an event the DAW sent that failed its table")
	}
}

func TestTheReviewLoopRunsAgainstAnAdapterThatIsNotReaper(t *testing.T) {
	service, fake := adapterService(t)
	if err := service.Start(map[string]string{}); err != nil {
		t.Fatal(err)
	}
	runID, _ := service.Snapshot()["runId"].(string)

	service.mu.Lock()
	service.state["phase"] = "inspecting"
	service.mu.Unlock()
	fake.queue("COMPARE_MARKER", runID, "row-1", "MISREAD", "Alice", "alice", "Alyss", "3.5", "2", "Chapter 1", "4", "s", "a", "pending", "", "1.25")
	fake.queue("COMPARE_INSPECTED", runID, "1 discrepancy found.", "1", "0")
	fake.queue("COMPARE_INSPECTED", "someone-else", "ignored", "9", "9")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	state := service.Snapshot()
	if state["phase"] != "success" || len(state["rows"].([]any)) != 1 {
		t.Fatalf("events delivered by the adapter must drive the state, got %#v", state)
	}

	if err := service.Jump("row-1"); err != nil {
		t.Fatal(err)
	}
	service.mu.Lock()
	service.state["output"] = filepath.Join(t.TempDir(), "results.txt")
	service.mu.Unlock()
	if err := service.Export(); err != nil {
		t.Fatal(err)
	}

	want := []string{"prepare", "dispatch", "navigate " + runID + " row-1", "export " + runID + " results.txt"}
	if !reflect.DeepEqual(fake.calls, want) {
		t.Fatalf("calls = %v, want %v", fake.calls, want)
	}
	if want := (dawadapter.MarkerColors{Misread: "FF4040", Skipped: "FFC000", Extra: "40A0FF"}); fake.colors != want {
		t.Fatalf("export colours = %+v, want the resolved settings %+v", fake.colors, want)
	}
}

func TestJumpToAFindingTheRunDoesNotHaveNeverReachesTheAdapter(t *testing.T) {
	service, fake := adapterService(t)
	if err := service.Jump("row-9"); err == nil {
		t.Fatal("jumping to an unknown finding must fail")
	}
	if len(fake.calls) != 0 {
		t.Fatalf("calls = %v, want none", fake.calls)
	}
}

func TestAnAdapterThatCannotTakeTheRequestFailsTheRun(t *testing.T) {
	service, fake := adapterService(t)
	fake.failWith = errors.New("the DAW is not reachable")
	if err := service.Start(map[string]string{}); err == nil {
		t.Fatal("a request the adapter refused must be an error")
	}
	if state := service.Snapshot(); state["phase"] != "error" || state["message"] != "the DAW is not reachable" {
		t.Fatalf("state = %#v", state)
	}
}

func TestNoAdapterIsTheUnavailableBridgeError(t *testing.T) {
	service := NewWithReview(Config{Project: t.TempDir()}, nil, settings.New(t.TempDir(), t.TempDir()), nil, nil)
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	if err := service.Jump("row-1"); err == nil {
		t.Fatal("no adapter must be an error, not a panic")
	}
}

// The app's project folder, not the .rpp's, is where REAPER reads the manuscript and writes the diffs (project-workspace
// PRD Phase 5, W4): Start passes the folder it has just checked the manuscript in.
func TestStartPassesTheAppsProjectFolderToTheDAW(t *testing.T) {
	service, fake := adapterService(t)
	if err := service.Start(map[string]string{}); err != nil {
		t.Fatal(err)
	}
	if fake.projectFolder == "" || fake.projectFolder != service.config.Project {
		t.Fatalf("PrepareReview got folder %q, want the service's project %q", fake.projectFolder, service.config.Project)
	}
}
