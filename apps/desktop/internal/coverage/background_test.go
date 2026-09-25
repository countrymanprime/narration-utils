package coverage

import (
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
)

// Background recording checks (daw-chapter-track-auto-sync PRD Phase 7, S7, D27): the scheduler's decision alone, with
// every condition spelled out.

var bgNow = time.Date(2026, 9, 25, 12, 0, 0, 0, time.UTC)

// readyConditions is a moment every condition allows a background check: on, the model installed, on mains power,
// REAPER closed, nothing running and nothing edited for an hour.
func readyConditions() BackgroundConditions {
	return BackgroundConditions{Enabled: true, ModelReady: true, Power: PowerMains, LastActivity: bgNow.Add(-time.Hour), Now: bgNow}
}

func changedAgo(chapterID string, state evidence.EvaluatorState, ago time.Duration) BackgroundCandidate {
	return BackgroundCandidate{ChapterID: chapterID, Freshness: state, LastChanged: bgNow.Add(-ago)}
}

func TestTheChapterChangedLongestAgoIsCheckedFirst(t *testing.T) {
	decision := NextBackground(readyConditions(), []BackgroundCandidate{
		changedAgo("c-2", evidence.StateStale, 10*time.Minute),
		changedAgo("c-1", evidence.StateStale, 40*time.Minute),
		changedAgo("c-3", evidence.StateNever, 50*time.Minute),
	})
	if decision.ChapterID != "c-1" || decision.Wait != "" {
		t.Fatalf("decision = %+v, want the stale chapter changed longest ago before a never-checked one", decision)
	}
}

func TestANeverCheckedChapterWhoseTrackChangedIsCheckedWhenNothingIsStale(t *testing.T) {
	decision := NextBackground(readyConditions(), []BackgroundCandidate{changedAgo("c-3", evidence.StateNever, 50*time.Minute)})
	if decision.ChapterID != "c-3" {
		t.Fatalf("decision = %+v", decision)
	}
}

func TestNothingStartsUnlessEveryConditionAllowsIt(t *testing.T) {
	candidates := []BackgroundCandidate{changedAgo("c-1", evidence.StateStale, time.Hour)}
	for name, tc := range map[string]struct {
		change func(*BackgroundConditions)
		wait   BackgroundWait
	}{
		"turned off":             {func(c *BackgroundConditions) { c.Enabled = false }, WaitOff},
		"a job runs":             {func(c *BackgroundConditions) { c.Busy = true }, WaitBusy},
		"no model":               {func(c *BackgroundConditions) { c.ModelReady = false }, WaitModel},
		"on battery":             {func(c *BackgroundConditions) { c.Power = PowerBattery }, WaitBattery},
		"power unknown":          {func(c *BackgroundConditions) { c.Power = PowerUnknown }, WaitBattery},
		"REAPER may record":      {func(c *BackgroundConditions) { c.ReaperRunning = true }, WaitRecording},
		"REAPER is recording":    {func(c *BackgroundConditions) { c.ReaperRunning, c.RecordingKnown, c.Recording = true, true, true }, WaitRecording},
		"REAPER edited just now": {func(c *BackgroundConditions) { c.LastActivity = bgNow.Add(-time.Minute) }, WaitQuiet},
	} {
		t.Run(name, func(t *testing.T) {
			conditions := readyConditions()
			tc.change(&conditions)
			decision := NextBackground(conditions, candidates)
			if decision.ChapterID != "" || decision.Wait != tc.wait {
				t.Fatalf("decision = %+v, want to wait for %q", decision, tc.wait)
			}
		})
	}
}

func TestREAPERIdleAndNotRecordingAllowsACheck(t *testing.T) {
	conditions := readyConditions()
	conditions.ReaperRunning, conditions.RecordingKnown = true, true
	if decision := NextBackground(conditions, []BackgroundCandidate{changedAgo("c-1", evidence.StateStale, time.Hour)}); decision.ChapterID != "c-1" {
		t.Fatalf("decision = %+v", decision)
	}
}

func TestAChapterChangedWithinTheQuietPeriodWaits(t *testing.T) {
	decision := NextBackground(readyConditions(), []BackgroundCandidate{changedAgo("c-1", evidence.StateStale, time.Minute)})
	if decision.ChapterID != "" || decision.Wait != WaitQuiet {
		t.Fatalf("decision = %+v", decision)
	}
}

func TestNothingToCheckSaysSo(t *testing.T) {
	decision := NextBackground(readyConditions(), []BackgroundCandidate{changedAgo("c-1", evidence.StateCurrent, time.Hour)})
	if decision.ChapterID != "" || decision.Wait != WaitNothing {
		t.Fatalf("decision = %+v", decision)
	}
}
