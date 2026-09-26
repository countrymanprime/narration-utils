package coverage

import (
	"sort"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
)

// Background recording checks (daw-chapter-track-auto-sync.prd.md Phase 7, S7, D27, ADR 0211). NextBackground decides,
// from what the host knows at one moment, whether a check of a changed chapter may start now and which one. It only
// decides: the host starts the check through the same Start as a narrator's press, so progress, the ledger record and
// job:ended are the same. It is pure, so every rule is a table test.

// BackgroundQuiet is how long nothing may have changed in REAPER, and in the chapter itself, before a background check
// starts (S7's proposed three minutes).
const BackgroundQuiet = 3 * time.Minute

// Power is whether the computer runs on mains power. Only PowerMains allows a background check (D27: never on
// battery); a power state the host cannot read counts as battery.
type Power string

const (
	PowerMains   Power = "mains"
	PowerBattery Power = "battery"
	PowerUnknown Power = "unknown"
)

// BackgroundWait is why no background check starts now, "" when one does.
type BackgroundWait string

const (
	// WaitOff: the narrator turned background checks off (RecordingCoverage.background_checks).
	WaitOff BackgroundWait = "off"
	// WaitBusy: a check or another job the narrator started is running.
	WaitBusy BackgroundWait = "busy"
	// WaitModel: the Whisper model is not installed; a background check never downloads one.
	WaitModel BackgroundWait = "model"
	// WaitBattery: the computer is on battery, or its power state cannot be read.
	WaitBattery BackgroundWait = "battery"
	// WaitRecording: REAPER is recording, or is running and cannot say whether it is.
	WaitRecording BackgroundWait = "recording"
	// WaitQuiet: REAPER, or the chapter to check, changed within BackgroundQuiet.
	WaitQuiet BackgroundWait = "quiet"
	// WaitNothing: no linked chapter has changed since its check.
	WaitNothing BackgroundWait = "nothing"
)

// BackgroundConditions is the moment the decision is made. ReaperRunning is a live heartbeat; RecordingKnown is
// whether that heartbeat says if REAPER is recording (Recording). LastActivity is the last change the host saw in
// REAPER: the saved project's modification or its edit counter moving.
type BackgroundConditions struct {
	Enabled        bool
	ModelReady     bool
	Busy           bool
	Power          Power
	ReaperRunning  bool
	RecordingKnown bool
	Recording      bool
	LastActivity   time.Time
	Now            time.Time
}

// BackgroundCandidate is a linked chapter the host may check: its check's freshness and when its track last changed.
type BackgroundCandidate struct {
	ChapterID   string
	Freshness   evidence.EvaluatorState
	LastChanged time.Time
}

// BackgroundDecision is the chapter to check now, or why none.
type BackgroundDecision struct {
	ChapterID string         `json:"chapterId"`
	Wait      BackgroundWait `json:"wait"`
}

// NextBackground applies the rules in order: turned on; nothing else running; the model installed; mains power;
// REAPER closed, or known not to be recording; quiet for BackgroundQuiet. Then it picks, among stale chapters first and
// never-checked ones second, the one whose change is oldest and at least BackgroundQuiet old. A current chapter is
// never picked.
func NextBackground(c BackgroundConditions, candidates []BackgroundCandidate) BackgroundDecision {
	switch {
	case !c.Enabled:
		return BackgroundDecision{Wait: WaitOff}
	case c.Busy:
		return BackgroundDecision{Wait: WaitBusy}
	case !c.ModelReady:
		return BackgroundDecision{Wait: WaitModel}
	case c.Power != PowerMains:
		return BackgroundDecision{Wait: WaitBattery}
	case c.ReaperRunning && (!c.RecordingKnown || c.Recording):
		return BackgroundDecision{Wait: WaitRecording}
	case !c.LastActivity.IsZero() && c.Now.Sub(c.LastActivity) < BackgroundQuiet:
		return BackgroundDecision{Wait: WaitQuiet}
	}
	eligible := []BackgroundCandidate{}
	waiting := false
	for _, candidate := range candidates {
		if candidate.Freshness != evidence.StateStale && candidate.Freshness != evidence.StateNever {
			continue
		}
		if c.Now.Sub(candidate.LastChanged) < BackgroundQuiet {
			waiting = true
			continue
		}
		eligible = append(eligible, candidate)
	}
	if len(eligible) == 0 {
		if waiting {
			return BackgroundDecision{Wait: WaitQuiet}
		}
		return BackgroundDecision{Wait: WaitNothing}
	}
	rank := func(state evidence.EvaluatorState) int {
		if state == evidence.StateStale {
			return 0
		}
		return 1
	}
	sort.SliceStable(eligible, func(i, j int) bool {
		if rank(eligible[i].Freshness) != rank(eligible[j].Freshness) {
			return rank(eligible[i].Freshness) < rank(eligible[j].Freshness)
		}
		return eligible[i].LastChanged.Before(eligible[j].LastChanged)
	})
	return BackgroundDecision{ChapterID: eligible[0].ChapterID}
}
