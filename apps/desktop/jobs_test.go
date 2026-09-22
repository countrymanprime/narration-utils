package main

import (
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
)

// collectJobEnds routes every job:ended event of h to the returned channel, so a test waits for the one it expects.
func collectJobEnds(h *Host) chan jobEnded {
	events := make(chan jobEnded, 8)
	h.mu.Lock()
	h.jobEvents = func(event jobEnded) { events <- event }
	h.mu.Unlock()
	return events
}

func nextJobEnd(t *testing.T, events chan jobEnded) jobEnded {
	t.Helper()
	select {
	case event := <-events:
		return event
	case <-time.After(20 * time.Second):
		t.Fatal("no job:ended event arrived")
		return jobEnded{}
	}
}

func noMoreJobEnds(t *testing.T, events chan jobEnded) {
	t.Helper()
	select {
	case event := <-events:
		t.Fatalf("an extra job:ended event arrived: %+v", event)
	case <-time.After(150 * time.Millisecond):
	}
}

func TestEndedJobNamesHowTheJobEndedAndHowLongItTook(t *testing.T) {
	started := time.Now().Add(-3 * time.Second)
	cases := []struct {
		phase, outcome string
		ok             bool
	}{
		{"success", jobOutcomeSuccess, true},
		{updatePhaseReady, jobOutcomeSuccess, true},
		{"error", jobOutcomeError, true},
		{"cancelled", jobOutcomeCancelled, true},
		{"running", "", false},
		{"downloading", "", false},
		{"idle", "", false},
	}
	for _, c := range cases {
		event, ok := endedJob("job-1", jobKindStoryBible, c.phase, "Said so.", started)
		if ok != c.ok || event.Outcome != c.outcome {
			t.Fatalf("phase %q: got %+v, %v; want outcome %q, %v", c.phase, event, ok, c.outcome, c.ok)
		}
		if ok && (event.ID != "job-1" || event.Kind != jobKindStoryBible || event.Message != "Said so." || event.DurationMs < 2900 || event.DurationMs > 6000) {
			t.Fatalf("phase %q: event = %+v", c.phase, event)
		}
	}
	if event, _ := endedJob("x", jobKindStoryBible, "success", "", time.Time{}); event.DurationMs != 0 {
		t.Fatalf("a job with no start time reports no duration, got %d", event.DurationMs)
	}
}

func TestTranscriptRunEndsOnceWhateverHowItEnds(t *testing.T) {
	state := func(phase string) map[string]any {
		return map[string]any{"phase": phase, "runId": "run-7", "message": "Comparison complete."}
	}
	var watch transcriptWatch
	for _, phase := range []string{"idle", "preparing", "running", "running", "inspecting"} {
		if _, ended := watch.observe(state(phase)); ended {
			t.Fatalf("phase %q is not an end", phase)
		}
	}
	event, ended := watch.observe(state("success"))
	if !ended || event.Kind != jobKindTranscript || event.Outcome != jobOutcomeSuccess || event.ID != "run-7" || event.Message != "Comparison complete." {
		t.Fatalf("success = %+v, %v", event, ended)
	}
	// The marker export keeps the phase at success and changes other fields: none of that is a new end.
	if _, again := watch.observe(state("success")); again {
		t.Fatal("a second state in the same phase reported a second end")
	}
	// Discarding the results is not the end of a run either.
	if _, discarded := watch.observe(state("idle")); discarded {
		t.Fatal("a reset reported an end")
	}
	for _, c := range []struct{ phase, outcome string }{{"error", jobOutcomeError}, {"cancelled", jobOutcomeCancelled}} {
		watch.observe(state("preparing"))
		watch.observe(state("need_chapter"))
		event, ended := watch.observe(state(c.phase))
		if !ended || event.Outcome != c.outcome {
			t.Fatalf("%s = %+v, %v", c.phase, event, ended)
		}
	}
}

func TestAStoryBibleBuildEndsWithOneEventAndAFailureCarriesItsReason(t *testing.T) {
	for _, c := range []struct{ mode, outcome string }{{"ok", jobOutcomeSuccess}, {"fail", jobOutcomeError}} {
		fixture := newPreviewHost(t, c.mode)
		host := fixture.host
		host.config.sessionDir = t.TempDir()
		events := collectJobEnds(host)
		started, err := host.startGuideBuild(true)
		if err != nil {
			t.Fatal(err)
		}
		job, _ := started["job"].(map[string]any)
		event := nextJobEnd(t, events)
		if event.Kind != jobKindStoryBible || event.Outcome != c.outcome || event.ID != job["id"] {
			t.Fatalf("%s: event = %+v, started = %v", c.mode, event, job["id"])
		}
		// The rules-only choice says so when it ends (the model itself is covered by guidegate_test.go).
		if c.outcome == jobOutcomeSuccess && !strings.HasPrefix(event.Message, "Story Bible rebuild complete") {
			t.Fatalf("success message = %q", event.Message)
		}
		if c.outcome == jobOutcomeError && !strings.Contains(event.Message, "could not be spoken") {
			t.Fatalf("a failure names its reason, got %q", event.Message)
		}
		noMoreJobEnds(t, events)
	}
}

func TestAVoiceInstallEndsWithAJobEvent(t *testing.T) {
	fixture := newPreviewHost(t, "ok")
	host := fixture.host
	host.installJobs = map[string]*installJob{}
	events := collectJobEnds(host)
	started, err := host.startTtsInstall(previewVoiceID)
	if err != nil {
		t.Fatal(err)
	}
	event := nextJobEnd(t, events)
	if event.Kind != jobKindTtsInstall || event.Outcome != jobOutcomeSuccess || event.ID != started["id"] || event.Message != "Voice installed and verified." {
		t.Fatalf("event = %+v", event)
	}
	noMoreJobEnds(t, events)
}

func TestAnUpdateDownloadEndsWithAJobEventWhetherItWorksOrNot(t *testing.T) {
	fake := newReleaseFiles(t)
	host := downloadHost(t, fake)
	if _, err := host.UpdateCheck(); err != nil {
		t.Fatal(err)
	}
	events := collectJobEnds(host)
	started := startDownload(t, host)
	event := nextJobEnd(t, events)
	if event.Kind != jobKindAppUpdate || event.Outcome != jobOutcomeSuccess || event.ID != started.ID || !strings.Contains(event.Message, "0.2.7") {
		t.Fatalf("success event = %+v", event)
	}
	noMoreJobEnds(t, events)

	bad := newReleaseFiles(t)
	bad.checksum = func([]byte) string { return strings.Repeat("0", 64) + "  narration-utils-windows-x64.zip\n" }
	failing := downloadHost(t, bad)
	if _, err := failing.UpdateCheck(); err != nil {
		t.Fatal(err)
	}
	failures := collectJobEnds(failing)
	startDownload(t, failing)
	failed := nextJobEnd(t, failures)
	if failed.Kind != jobKindAppUpdate || failed.Outcome != jobOutcomeError || failed.Message == "" || strings.Contains(failed.Message, "127.0.0.1") {
		t.Fatalf("failure event = %+v", failed)
	}
}

// The job:ended event as the host sends it (ADR 0076); the UI schema is validated against these files.
func TestContractJobEnded(t *testing.T) {
	contractfile.Check(t, "job-ended-success", jobEnded{ID: "guide-1", Kind: jobKindStoryBible, Outcome: jobOutcomeSuccess, Message: "Story Bible rebuild complete.", DurationMs: 4200})
	contractfile.Check(t, "job-ended-error", jobEnded{ID: "run-7", Kind: jobKindTranscript, Outcome: jobOutcomeError, Message: "The comparison could not read the REAPER audio.", DurationMs: 31500})
}
